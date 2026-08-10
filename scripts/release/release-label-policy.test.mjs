import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  classifyReleaseImpact,
  flattenChangedFilePayload,
  resolveReleaseSelection,
} from './release-label-policy.mjs';

const root = new URL('../../', import.meta.url);
const resolver = fileURLToPath(new URL('resolve-release-bump-from-pr.mjs', import.meta.url));

function changed(...files) {
  return { expectedFileCount: files.length, files };
}

function file(filename, previousFilename) {
  return previousFilename ? { filename, previous_filename: previousFilename } : { filename };
}

function runResolver({ labels, payload, json = false }) {
  const directory = mkdtempSync(join(tmpdir(), 'release-label-policy-'));
  const eventPath = join(directory, 'event.json');
  writeFileSync(
    eventPath,
    JSON.stringify({ pull_request: { labels: labels.map((name) => ({ name })) } }),
  );
  const args = [resolver, '--event', eventPath];
  if (payload !== undefined) {
    const changedFilesPath = join(directory, 'changed-files.json');
    writeFileSync(changedFilesPath, JSON.stringify(payload));
    args.push('--changed-files', changedFilesPath);
  }
  if (json) args.push('--json');
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
}

test('normal release labels resolve without changed-file data', () => {
  assert.deepEqual(resolveReleaseSelection(['release:patch']), {
    label: 'release:patch',
    bump: 'patch',
    releaseRequired: true,
  });
  assert.deepEqual(resolveReleaseSelection([{ name: 'release:minor' }]), {
    label: 'release:minor',
    bump: 'minor',
    releaseRequired: true,
  });
});

test('exactly one recognized release label is required', () => {
  assert.throws(() => resolveReleaseSelection([]), /Expected exactly one release label/u);
  assert.throws(
    () => resolveReleaseSelection(['release:none', 'release:patch'], changed(file('docs/a.md'))),
    /Expected exactly one release label/u,
  );
});

test('maintenance-only paths accept release:none', () => {
  const allowedRootFiles = [
    '.dclintrc.json',
    '.editorconfig',
    '.gitattributes',
    '.gitignore',
    '.hadolint.yaml',
    '.prettierignore',
    '.prettierrc.json',
    'biome.json',
    'knip.json',
  ];
  const paths = [
    '.github/workflows/ci.yml',
    '.impeccable/critique/local.md',
    '.codex/ORCHESTRATION.md',
    '.codex/agents/terra_explorer.toml',
    'AGENTS.md',
    'docs/reference/VERSIONING_MODEL.md',
    'scripts/check/ci-workflow-structure.test.mjs',
    'scripts/docs/check-core-docs.mjs',
    'scripts/test/run-agent-vitest-lane.mjs',
    'scripts/docker/run-hadolint.mjs',
    'scripts/docker/run-hadolint.test.mjs',
    ...allowedRootFiles,
  ];

  assert.deepEqual(classifyReleaseImpact(paths), { releaseRequired: false, reasons: [] });
  assert.deepEqual(
    resolveReleaseSelection(['release:none'], changed(...paths.map((path) => file(path)))),
    {
      label: 'release:none',
      bump: null,
      releaseRequired: false,
    },
  );
});

test('runtime, dependency, deployment, prompt, and unknown paths require a release', () => {
  for (const path of [
    'docs/prompt-gallery/assignment.md',
    'packages/batch-frontend/src/main.tsx',
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.base.json',
    '.dockerignore',
    '.env.example',
    '.nvmrc',
    'packages/batch-backend/Dockerfile',
    'docker-compose.prod.yml',
    'scripts/deploy/deploy-prod-images.sh',
    'scripts/docker/prod-compose.mjs',
    'unknown-root-file.txt',
  ]) {
    const result = classifyReleaseImpact([path]);
    assert.equal(result.releaseRequired, true, path);
    assert.match(result.reasons[0], new RegExp(path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    assert.throws(
      () => resolveReleaseSelection(['release:none'], changed(file(path))),
      /release:none is not allowed/u,
      path,
    );
  }
});

test('mixed changes require a release', () => {
  const result = classifyReleaseImpact(['docs/README.md', 'packages/contracts/src/index.ts']);
  assert.equal(result.releaseRequired, true);
  assert.deepEqual(result.reasons, ['release-worthy path: packages/contracts/src/index.ts']);
});

test('changed-file payload validates count, cap, records, and both rename paths', () => {
  assert.throws(() => flattenChangedFilePayload(undefined), /changed-file payload/u);
  assert.throws(
    () => flattenChangedFilePayload({ expectedFileCount: 0, files: [] }),
    /positive integer/u,
  );
  assert.throws(
    () => flattenChangedFilePayload({ expectedFileCount: 2, files: [file('docs/a.md')] }),
    /does not match/u,
  );
  assert.throws(
    () =>
      flattenChangedFilePayload({
        expectedFileCount: 3000,
        files: Array.from({ length: 3000 }, (_, index) => file(`docs/${index}.md`)),
      }),
    /3,000-file API limit/u,
  );
  assert.throws(
    () => flattenChangedFilePayload({ expectedFileCount: 1, files: [{}] }),
    /filename/u,
  );
  assert.deepEqual(flattenChangedFilePayload(changed(file('docs/new.md', 'packages/old.ts'))), [
    'docs/new.md',
    'packages/old.ts',
  ]);
  assert.throws(
    () =>
      resolveReleaseSelection(['release:none'], changed(file('docs/new.md', 'packages/old.ts'))),
    /packages\/old\.ts/u,
  );
});

test('release:none CLI requires changed files and has stable plain and JSON output', () => {
  const missing = runResolver({ labels: ['release:none'] });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Missing --changed-files/u);

  const payload = changed(file('docs/README.md'));
  const plain = runResolver({ labels: ['release:none'], payload });
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stdout, 'none\n');

  const json = runResolver({ labels: ['release:none'], payload, json: true });
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), {
    label: 'release:none',
    bump: null,
    releaseRequired: false,
  });
});
