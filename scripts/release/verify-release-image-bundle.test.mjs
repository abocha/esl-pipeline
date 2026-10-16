import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sha = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const bashPath = (value) =>
  value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);

function verify(t, overrides = {}, args = []) {
  const dir = mkdtempSync(path.join(tmpdir(), 'esl-release-bundle-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const summary = path.join(dir, 'summary');
  const log = path.join(dir, 'commands');
  writeFileSync(summary, '');
  writeFileSync(log, '');
  const mocks = {
    git: `#!/usr/bin/env bash
set -euo pipefail
printf 'git %s\\n' "$*" >> "$COMMAND_LOG"
[[ "$*" == 'ls-remote --exit-code --tags origin refs/tags/v1.2.3 refs/tags/v1.2.3^{}' ]] || exit 90
[[ -n "$REMOTE_REFS" ]] || exit 2
printf '%s\\n' "$REMOTE_REFS"
`,
    docker: `#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\\n' "$*" >> "$COMMAND_LOG"
[[ "$*" == 'buildx imagetools inspect '* ]] || exit 91
[[ "$*" != *"$MISSING_IMAGE"* ]] || exit 1
value="$DIGEST"
if [[ "$*" == *"$DIFFERENT_IMAGE"* ]]; then value="$OTHER_DIGEST"; fi
printf 'Digest: %s\\n' "$value"
`,
  };
  for (const [name, content] of Object.entries(mocks)) {
    writeFileSync(path.join(dir, name), content);
    chmodSync(path.join(dir, name), 0o755);
  }
  const script = bashPath(
    fileURLToPath(new URL('./verify-release-image-bundle.sh', import.meta.url)),
  );
  const result = spawnSync(
    bash,
    ['-c', 'export PATH="$FAKE_BIN:$PATH"; bash "$@"', 'verify', script, ...args],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        FAKE_BIN: bashPath(dir),
        COMMAND_LOG: bashPath(log),
        GITHUB_STEP_SUMMARY: bashPath(summary),
        RELEASE_SHA: sha,
        RELEASE_TAG: 'v1.2.3',
        IMAGE_PREFIX: 'ghcr.io/example/app',
        REMOTE_REFS: `${'c'.repeat(40)}\trefs/tags/v1.2.3\n${sha}\trefs/tags/v1.2.3^{}`,
        DIGEST: digest,
        OTHER_DIGEST: `sha256:${'d'.repeat(64)}`,
        MISSING_IMAGE: 'never-match',
        DIFFERENT_IMAGE: 'never-match',
        ...overrides,
      },
    },
  );
  assert.ifError(result.error);
  return { ...result, summary: readFileSync(summary, 'utf8'), commands: readFileSync(log, 'utf8') };
}

test('complete bundle receipt records the published SHA and all three checked digests', (t) => {
  const result = verify(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.summary, new RegExp(`Published release SHA: ${sha}`));
  for (const name of ['batch-backend', 'batch-frontend', 'telegram-ops-bot']) {
    assert.ok(result.summary.includes(`| ${name} | ${digest} |`));
  }
  assert.equal(result.stdout.trim(), result.summary.trim());
  assert.equal(result.commands.split('\n').filter((line) => line.startsWith('docker ')).length, 6);
});

test('refs-only accepts lightweight tags without accessing the registry or writing a receipt', (t) => {
  const result = verify(t, { REMOTE_REFS: `${sha}\trefs/tags/v1.2.3` }, ['--refs-only']);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.commands, /docker/);
  assert.equal(result.summary, '');
});

test('rewritten remote tag fails before registry access even when its tag object equals the requested SHA', (t) => {
  const result = verify(t, {
    REMOTE_REFS: `${sha}\trefs/tags/v1.2.3\n${'e'.repeat(40)}\trefs/tags/v1.2.3^{}`,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Release identity mismatch/);
  assert.doesNotMatch(result.commands, /docker/);
  assert.equal(result.summary, '');
});

for (const [name, overrides] of [
  ['absent remote tag', { REMOTE_REFS: '' }],
  ['missing final image', { MISSING_IMAGE: `telegram-ops-bot:${sha}` }],
  ['version digest mismatch', { DIFFERENT_IMAGE: 'batch-frontend:v1.2.3' }],
  ['empty digest', { DIGEST: '' }],
  ['malformed digest', { DIGEST: 'sha256:invalid' }],
  ['invalid SHA', { RELEASE_SHA: 'main' }],
]) {
  test(`${name} fails without a success receipt`, (t) => {
    const result = verify(t, overrides);
    assert.notEqual(result.status, 0);
    assert.equal(result.summary, '');
    assert.doesNotMatch(result.stdout, /Verified deployment image bundle/);
  });
}
