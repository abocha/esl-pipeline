import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { recoveryPreflight } from './recovery-preflight.mjs';

const revision = 'a'.repeat(40);
function fixture() {
  const bundle = mkdtempSync(path.join(tmpdir(), 'recovery-preflight-'));
  mkdirSync(path.join(bundle, 'postgres'));
  const manifest = (directory, files, target) => {
    const rows = files.map(([name, contents]) => {
      writeFileSync(path.join(directory, name), contents);
      return `${createHash('sha256').update(contents).digest('hex')}  ${name}`;
    });
    writeFileSync(path.join(directory, target), `${rows.join('\n')}\n`);
  };
  manifest(
    bundle,
    ['uploads.tar', 'redis.tar', 'product.json', 'media.json'].map((name) => [name, 'synthetic']),
    'state.sha256',
  );
  manifest(
    path.join(bundle, 'postgres'),
    [
      ['recovery.dump', 'PGDMP-synthetic'],
      ['recovery.sql.gz', 'synthetic'],
      ['recovery_schema.sql', 'synthetic'],
    ],
    'recovery.sha256',
  );
  writeFileSync(path.join(bundle, 'application-revision'), revision);
  const envFile = path.join(bundle, 'operator.env');
  writeFileSync(
    envFile,
    'PG_HOST=postgres\nPG_DATABASE=esl_batch\nPG_AUTO_MIGRATE_ON_BOOT=false\nREDIS_HOST=redis\nS3_ENDPOINT=http://rehearsal-s3:5000\nAWS_ENDPOINT_URL_S3=http://127.0.0.1:15001\nAWS_ACCESS_KEY_ID=synthetic-rehearsal\nAWS_SECRET_ACCESS_KEY=synthetic-rehearsal\nPG_BACKUP_ALERT_TELEGRAM_DISABLE=true\nJWT_SECRET=synthetic\n',
  );
  return { bundle, envFile };
}
for (const [name, mutate, expected] of [
  [
    'rejects corrupt DB dump',
    (dir) => writeFileSync(path.join(dir, 'postgres/recovery.dump'), 'corrupt'),
    /Checksum mismatch/u,
  ],
  ['rejects missing required uploads', (dir) => rmSync(path.join(dir, 'uploads.tar')), /ENOENT/u],
  [
    'rejects mismatched pinned revision',
    (dir) => writeFileSync(path.join(dir, 'application-revision'), 'b'.repeat(40)),
    /revision mismatch/u,
  ],
  ['rejects absent external inputs', (_, env) => rmSync(env), /ENOENT/u],
  [
    'rejects nonlocal external input',
    (_, env) => writeFileSync(env, 'PG_HOST=production'),
    /operator input/u,
  ],
  [
    'rejects unsafe checksum paths',
    (dir) => writeFileSync(path.join(dir, 'state.sha256'), `${'a'.repeat(64)}  ../../uploads.tar`),
    /outside bundle/u,
  ],
]) {
  test(name, () => {
    const { bundle, envFile } = fixture();
    try {
      mutate(bundle, envFile);
      assert.throws(() => recoveryPreflight(bundle, revision, envFile), expected);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });
}

test('accepts intact synthetic bundle', () => {
  const { bundle, envFile } = fixture();
  try {
    assert.equal(recoveryPreflight(bundle, revision, envFile).ok, true);
  } finally {
    rmSync(bundle, { recursive: true, force: true });
  }
});

test('private recovery entrypoint rejects the ordinary execution host before mutations', () => {
  const script = fileURLToPath(new URL('./rehearse-host.sh', import.meta.url));
  const result = spawnSync('bash', [script, 'replacement', revision, 'esl-recovery.invalid'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Disposable guest marker\/root required/u);
});
test('outer runner rejects external target arguments', () => {
  const script = fileURLToPath(new URL('./run-replacement-host-rehearsal.sh', import.meta.url));
  const result = spawnSync('bash', [script, '--host=production.invalid'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/u);
});
