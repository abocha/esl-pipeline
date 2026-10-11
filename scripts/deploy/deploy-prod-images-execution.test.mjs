import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const sha = 'b'.repeat(40);
const previousImage = `ghcr.io/abocha/esl-pipeline/batch-backend:${'a'.repeat(40)}`;
const old = { id: '0059_old', checksum: 'a'.repeat(64) };
const boundary = { id: '0060_boundary', checksum: 'b'.repeat(64) };

function deploy(scenario = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'esl-deploy-test-'));
  try {
    for (const subdir of ['scripts/deploy', 'scripts/docker', 'deploy/caddy', 'bin', 'state'])
      mkdirSync(join(directory, subdir), { recursive: true });
    for (const file of [
      'deploy-prod-images.sh',
      'deploy-prod-images-plan.sh',
      'schema-compatibility.mjs',
      'verify-workers-ready.mjs',
    ])
      cpSync(new URL(file, import.meta.url), join(directory, 'scripts/deploy', file));
    cpSync(
      new URL('../docker/validate-edge-env.mjs', import.meta.url),
      join(directory, 'scripts/docker/validate-edge-env.mjs'),
    );
    cpSync(new URL('fixtures/docker.mjs', import.meta.url), join(directory, 'bin/docker'));
    writeFileSync(join(directory, 'bin/curl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(directory, 'bin/aws'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    // cpSync preserves the executable fixture's mode.
    const applicationEnv = scenario.edge
      ? 'CADDY_PUBLIC_HOSTNAME=app.eslpipeline.com\nCADDY_ACME_EMAIL=ops@example.com\nCADDY_TRANSITION_HOSTNAME=esl-pipeline.run.place\nCADDY_TRANSITION_MODE=serve\n'
      : '';
    writeFileSync(join(directory, '.env'), applicationEnv);
    writeFileSync(join(directory, 'docker-compose.prod.yml'), 'services: {}\n');
    writeFileSync(join(directory, 'deploy/caddy/Caddyfile'), 'reverse_proxy batch-frontend:8080\n');
    const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
    const caddyDigest = digest(
      'reverse_proxy batch-frontend:8080\n' +
        '\0' +
        (scenario.edge
          ? 'app.eslpipeline.com\0ops@example.com\0esl-pipeline.run.place\0serve'
          : '\0\0disabled'),
    );
    const applicationDigest = digest(
      [
        createHash('sha256').update(applicationEnv).digest('hex'),
        createHash('sha256').update('services: {}\n').digest('hex'),
      ].join('\n') + '\n',
    );
    writeFileSync(
      join(directory, 'state/current-images.env'),
      `BATCH_BACKEND_IMAGE=${previousImage}\nBATCH_BACKEND_DIGEST=${scenario.aliasOnly ? `ghcr.io/abocha/esl-pipeline/batch-backend@sha256:${'b'.repeat(64)}` : 'old'}\nBATCH_FRONTEND_IMAGE=frontend-old\nBATCH_FRONTEND_DIGEST=${scenario.aliasOnly ? `ghcr.io/abocha/esl-pipeline/batch-frontend@sha256:${'b'.repeat(64)}` : 'old'}\nTELEGRAM_OPS_BOT_IMAGE=bot-old\nTELEGRAM_OPS_BOT_DIGEST=ghcr.io/abocha/esl-pipeline/telegram-ops-bot@sha256:${'b'.repeat(64)}\nCADDY_CONFIG_DIGEST=${scenario.caddyEnvChanged ? 'previous-edge-config' : caddyDigest}\nAPPLICATION_CONFIG_DIGEST=${scenario.applicationEnvChanged ? 'previous-application-config' : applicationDigest}\n`,
    );
    writeFileSync(join(directory, 'scenario.json'), JSON.stringify({ ...scenario, previousImage }));
    writeFileSync(
      join(directory, 'previous.json'),
      JSON.stringify({ migrations: scenario.aliasOnly ? [old, boundary] : [old], metadata: null }),
    );
    writeFileSync(
      join(directory, 'requested.json'),
      JSON.stringify({
        migrations: [old, boundary],
        metadata: scenario.missingMetadata
          ? null
          : {
              formatVersion: 1,
              migrations: {
                [old.id]: 'legacy-unclassified',
                [boundary.id]: scenario.compatible ? 'compatible' : 'incompatible',
              },
            },
      }),
    );
    writeFileSync(
      join(directory, 'applied.json'),
      JSON.stringify(scenario.applied || (scenario.aliasOnly ? [old, boundary] : [old])),
    );
    writeFileSync(
      join(directory, 'running.json'),
      JSON.stringify([
        'postgres',
        'redis',
        'batch-backend',
        'batch-worker',
        'transcribe-worker',
        'student-memory-worker',
        'batch-frontend',
        ...(scenario.bot ? ['telegram-ops-bot'] : []),
        ...(scenario.unknownService ? ['unknown-writer'] : []),
      ]),
    );
    writeFileSync(
      join(directory, 'scripts/docker/postgres-prod-backup-s3.sh'),
      `#!/bin/bash
set -e
echo '["backup"]' >> "$DEPLOY_TEST_DIR/events.jsonl"
[[ "\${BACKUP_FAIL:-}" != true ]] || exit 1
prefix="$PG_BACKUP_DIR/test"
echo dump > "$prefix.dump"
echo sql > "$prefix.sql.gz"
echo schema > "\${prefix}_schema.sql"
(cd "$PG_BACKUP_DIR" && sha256sum test.dump test.sql.gz test_schema.sql > test.sha256)
[[ "\${BACKUP_INTEGRITY_FAIL:-}" != true ]] || echo corrupt >> "$prefix.dump"
`,
    );
    writeFileSync(
      join(directory, 'scripts/docker/postgres-backup-restore.sh'),
      '#!/bin/bash\necho \'["backup-verify"]\' >> "$DEPLOY_TEST_DIR/events.jsonl"\n',
    );
    const result = spawnSync(
      'bash',
      [
        join(directory, 'scripts/deploy/deploy-prod-images.sh'),
        sha,
        ...(scenario.plan ? ['--plan'] : []),
      ],
      {
        encoding: 'utf8',
        timeout: 20_000,
        env: {
          ...process.env,
          PATH: `${directory}/bin:${process.env.PATH}`,
          DEPLOY_TEST_DIR: directory,
          DEPLOY_STATE_DIR: join(directory, 'state'),
          DEPLOY_MIN_FREE_MB: '0',
          DEPLOY_INCLUDE_EDGE: String(Boolean(scenario.edge)),
          DEPLOY_INCLUDE_OPS_BOT: 'false',
          COMPOSE_PROFILES: '',
          CADDY_PUBLIC_HOSTNAME: '',
          CADDY_ACME_EMAIL: '',
          CADDY_TRANSITION_HOSTNAME: scenario.edge ? 'esl-pipeline.run.place' : '',
          CADDY_TRANSITION_MODE: scenario.edge ? 'serve' : 'disabled',
          BACKUP_FAIL: String(Boolean(scenario.backupFail)),
          BACKUP_INTEGRITY_FAIL: String(Boolean(scenario.backupIntegrityFail)),
        },
      },
    );
    const events = readFileSync(join(directory, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    let record;
    try {
      record = JSON.parse(
        readFileSync(join(directory, 'state/rollback-compatibility.json'), 'utf8'),
      );
    } catch {}
    const state = readFileSync(join(directory, 'state/current-images.env'), 'utf8');
    return { ...result, events, record, state, output: result.stdout + result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const index = (result, predicate) => result.events.findIndex(predicate);
const migration = (event) => event[0] === 'compose' && event.includes('migrate');
const recreate = (event) => event[0] === 'compose' && event.includes('up');

test('compatible migration follows backup, migrate, recreate, verify without stopping', () => {
  const result = deploy({ compatible: true, verifyFail: true });
  assert.equal(result.status, 1, result.output);
  assert.equal(
    index(result, (e) => e[0] === 'stop'),
    -1,
  );
  assert.ok(index(result, (e) => e[0] === 'backup-verify') < index(result, migration));
  assert.ok(index(result, migration) < index(result, recreate));
  assert.match(result.output, /Application rollback instructions:/);
  assert.match(result.output, /previous-images.env/);
});

test('compatible deployment preserves an omitted live bot profile', () => {
  const result = deploy({ compatible: true, bot: true });
  assert.equal(result.status, 0, result.output);
  assert.equal(
    index(result, (e) => e[0] === 'stop'),
    -1,
  );
  assert.equal(result.events.find(recreate).includes('telegram-ops-bot'), false);
});

test('alias-only deploy performs compatibility and existing verification without backup or restart', () => {
  const result = deploy({ aliasOnly: true });
  assert.equal(result.status, 0, result.output);
  assert.match(
    result.output,
    /pending=none boundaries=none quiesce=false image_rollback_safe=true/,
  );
  for (const predicate of [migration, recreate, (e) => e[0] === 'stop', (e) => e[0] === 'backup'])
    assert.equal(index(result, predicate), -1);
  assert.match(result.output, /deployment_workers_ready/);
});

test('environment-only domain cutover with unchanged images recreates runtime and persists config state', () => {
  const result = deploy({
    aliasOnly: true,
    edge: true,
    applicationEnvChanged: true,
    caddyEnvChanged: true,
  });
  assert.equal(result.status, 0, result.output);
  assert.equal(index(result, migration), -1);
  assert.equal(
    index(result, (e) => e[0] === 'backup'),
    -1,
  );
  const updates = result.events.filter(recreate);
  assert.equal(updates.length, 2);
  for (const service of [
    'batch-backend',
    'batch-worker',
    'transcribe-worker',
    'student-memory-worker',
    'batch-frontend',
  ])
    assert.ok(updates[0].includes(service));
  assert.ok(updates[1].includes('caddy-edge'));
  assert.match(result.state, /APPLICATION_CONFIG_DIGEST=sha256:[a-f0-9]{64}/);
  assert.doesNotMatch(result.state, /app\.eslpipeline\.com|ops@example\.com/);
});

test('Caddy environment-only change recreates edge even when image and application digests match', () => {
  const result = deploy({ aliasOnly: true, edge: true, caddyEnvChanged: true });
  assert.equal(result.status, 0, result.output);
  assert.equal(result.events.filter(recreate).length, 1);
  assert.ok(result.events.find(recreate).includes('caddy-edge'));
  assert.equal(index(result, migration), -1);
});

test('failed production environment preflight leaves the old runtime and state intact', () => {
  const result = deploy({ aliasOnly: true, applicationEnvChanged: true, environmentFail: true });
  assert.equal(result.status, 1, result.output);
  assert.equal(index(result, recreate), -1);
  assert.equal(index(result, migration), -1);
  assert.equal(
    index(result, (e) => e[0] === 'stop'),
    -1,
  );
  assert.match(result.state, /APPLICATION_CONFIG_DIGEST=previous-application-config/);
});

test('failed Caddy validation leaves the old runtime and state intact', () => {
  const result = deploy({
    aliasOnly: true,
    edge: true,
    caddyEnvChanged: true,
    caddyValidationFail: true,
  });
  assert.equal(result.status, 1, result.output);
  assert.equal(index(result, recreate), -1);
  assert.equal(index(result, migration), -1);
  assert.equal(
    index(result, (e) => e[0] === 'stop'),
    -1,
  );
});

test('matching edge and application environment digests do not restart unchanged images', () => {
  const result = deploy({ aliasOnly: true, edge: true });
  assert.equal(result.status, 0, result.output);
  assert.equal(index(result, recreate), -1);
  assert.equal(index(result, migration), -1);
});

test('incompatible deploy plans before stopping every writer, backup, and migrate; restarts unchanged live bot', () => {
  const result = deploy({ bot: true });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /boundaries=0060_boundary quiesce=true image_rollback_safe=false/);
  assert.ok(result.output.indexOf('Schema compatibility:') < result.output.indexOf('Quiescing'));
  assert.ok(index(result, (e) => e[0] === 'stop') < index(result, (e) => e[0] === 'backup'));
  assert.ok(index(result, (e) => e[0] === 'backup-verify') < index(result, migration));
  const stop = result.events.find((e) => e[0] === 'stop');
  for (const service of [
    'batch-backend',
    'batch-worker',
    'transcribe-worker',
    'student-memory-worker',
    'batch-frontend',
    'telegram-ops-bot',
  ])
    assert.ok(stop.includes(service));
  assert.ok(result.events.find(recreate).includes('telegram-ops-bot'));
  assert.match(result.output, /deployment_workers_ready/);
  assert.match(result.output, /Image-only rollback.*BLOCKED/);
  assert.doesNotMatch(result.output, /Application rollback instructions:/);
  assert.equal(result.record.imageRollbackSafe, false);
});

test('backup failures while quiesced never run migrations or restart services', () => {
  for (const scenario of [{ backupFail: true }, { backupIntegrityFail: true }]) {
    const result = deploy(scenario);
    assert.equal(result.status, 1, result.output);
    assert.ok(index(result, (e) => e[0] === 'stop') >= 0);
    assert.equal(index(result, migration), -1);
    assert.equal(index(result, recreate), -1);
    assert.match(result.output, /migrations were not invoked/);
  }
});

test('failed writer inventory, unknown writers, stop failure, or surviving writers prevent migration', () => {
  for (const scenario of [
    { stopFail: true },
    { stillRunning: true },
    { psFail: true },
    { psFailAfterStop: true },
    { inspectFail: true },
    { unknownService: true },
  ]) {
    const result = deploy(scenario);
    assert.equal(result.status, 1, result.output);
    assert.equal(
      index(result, (e) => e[0] === 'backup'),
      -1,
    );
    assert.equal(index(result, migration), -1);
  }
});

test('migration failure, recreate failure, and verification failure block unsafe rollback', () => {
  for (const scenario of [{ migrationFail: true }, { upFail: true }, { verifyFail: true }]) {
    const result = deploy(scenario);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /Image-only rollback.*BLOCKED/);
    assert.doesNotMatch(result.output, /Application rollback instructions:/);
    assert.equal(result.record.imageRollbackSafe, false);
    assert.equal(index(result, recreate) === -1, Boolean(scenario.migrationFail));
  }
});

test('missing metadata fails before stop, backup, or migration', () => {
  const result = deploy({ missingMetadata: true });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Missing or unsupported runtime compatibility metadata/);
  assert.equal(
    index(result, (e) => e[0] === 'stop'),
    -1,
  );
  assert.equal(index(result, migration), -1);
  assert.equal(index(result, recreate), -1);
});

test('resolved migration directory override fails before stop, backup, or migration', () => {
  const result = deploy({ migrationsDir: '/app/uploads/unreviewed' });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /PG_MIGRATIONS_DIR overrides are unsupported/);
  assert.equal(
    index(result, (e) => e[0] === 'stop'),
    -1,
  );
  assert.equal(index(result, migration), -1);
});

test('plan-only exposes boundary and rollback decision without service or schema mutations', () => {
  const result = deploy({ plan: true });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /boundaries=0060_boundary/);
  assert.match(result.output, /Plan only/);
  for (const predicate of [migration, recreate, (e) => e[0] === 'stop', (e) => e[0] === 'backup'])
    assert.equal(index(result, predicate), -1);
});

test('retry after incompatible commit still blocks old rollback and quiesces old writers', () => {
  const result = deploy({ applied: [old, boundary], verifyFail: true });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /pending=none boundaries=none quiesce=true/);
  assert.ok(index(result, (e) => e[0] === 'stop') < index(result, migration));
  assert.match(result.output, /Image-only rollback.*BLOCKED/);
  assert.match(result.output, /backup from BEFORE the blocked boundary/);
  assert.match(result.output, /later deploy retry may already contain/);
});
