import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
    writeFileSync(
      join(directory, 'bin/curl'),
      `#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
const directory = process.env.DEPLOY_TEST_DIR;
const scenario = JSON.parse(readFileSync(directory + '/scenario.json', 'utf8'));
appendFileSync(directory + '/events.jsonl', JSON.stringify(['curl', ...process.argv.slice(2)]) + '\\n');
const attempts = readFileSync(directory + '/events.jsonl', 'utf8').split('"curl"').length - 1;
if (scenario.healthFail || (scenario.healthRetry && attempts === 1)) {
  console.error('curl: (56) fixture connection reset');
  process.exit(56);
}
`,
      { mode: 0o755 },
    );
    // Failed-probe scenarios exercise every attempt without spending time sleeping.
    if (scenario.healthFail || scenario.healthRetry)
      writeFileSync(join(directory, 'bin/sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(directory, 'bin/aws'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    // cpSync preserves the executable fixture's mode.
    const applicationEnv = scenario.edge
      ? 'CADDY_PUBLIC_HOSTNAME=app.eslpipeline.com\nCADDY_ACME_EMAIL=ops@example.com\nCADDY_TRANSITION_HOSTNAME=esl-pipeline.run.place\nCADDY_TRANSITION_MODE=serve\n'
      : '';
    writeFileSync(join(directory, '.env'), applicationEnv);
    writeFileSync(join(directory, 'docker-compose.prod.yml'), 'services: {}\n');
    writeFileSync(
      join(directory, 'scripts/deploy/production-paths.mjs'),
      '// Deployment flow fixture only; real permission guard has its own Linux behavioral tests.\n',
    );
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
      JSON.stringify({
        migrations:
          scenario.aliasOnly && !scenario.stalePreviousInventory ? [old, boundary] : [old],
        metadata: null,
      }),
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
        ...(scenario.verbose ? ['--verbose'] : []),
      ],
      {
        encoding: 'utf8',
        timeout: 20_000,
        env: {
          ...process.env,
          PATH: `${directory}/bin:${process.env.PATH}`,
          DEPLOY_TEST_DIR: directory,
          DEPLOY_STATE_DIR: join(directory, 'state'),
          ESL_PRODUCTION_ENV_FILE: join(directory, '.env'),
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
    const logDirectories = readdirSync(join(directory, 'state')).filter((name) =>
      name.startsWith('run-'),
    );
    const logs = logDirectories
      .flatMap((name) => {
        const path = join(directory, 'state', name);
        assert.equal(statSync(path).mode & 0o777, 0o700);
        return readdirSync(path).map((file) => {
          assert.equal(statSync(join(path, file)).mode & 0o777, 0o600);
          return readFileSync(join(path, file), 'utf8');
        });
      })
      .join('\n');
    return { ...result, events, record, state, logs, output: result.stdout + result.stderr };
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
    /Pending migrations: none[\s\S]*Incompatible schema boundaries: none[\s\S]*Previous runtime is schema-compatible/,
  );
  for (const predicate of [migration, recreate, (e) => e[0] === 'stop', (e) => e[0] === 'backup'])
    assert.equal(index(result, predicate), -1);
  assert.match(result.output, /OK\s+Verify readiness of all three workers/);
  assert.match(result.logs, /deployment_workers_ready/);
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
  assert.match(result.output, /Incompatible schema boundaries: 0060_boundary/);
  assert.ok(result.output.indexOf('Deployment actions') < result.output.indexOf('Quiescing'));
  assert.match(result.output, /Recreate telegram-ops-bot: restore stopped writer/);
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
  assert.match(result.output, /OK\s+Verify readiness of all three workers/);
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
    assert.equal(result.output.split('\nFAILED ').length - 1, 1);
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
  assert.equal(result.output.split('\nFAILED ').length - 1, 1);
  assert.equal(
    index(result, (e) => e[0] === 'stop'),
    -1,
  );
  assert.equal(index(result, migration), -1);
});

test('plan-only exposes boundary and rollback decision without service or schema mutations', () => {
  const result = deploy({ plan: true });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Incompatible schema boundaries: 0060_boundary/);
  assert.match(result.output, /Plan only/);
  for (const predicate of [migration, recreate, (e) => e[0] === 'stop', (e) => e[0] === 'backup'])
    assert.equal(index(result, predicate), -1);
});

test('retry after incompatible commit still blocks old rollback and quiesces old writers', () => {
  const result = deploy({ applied: [old, boundary], verifyFail: true });
  assert.equal(result.status, 1, result.output);
  assert.match(
    result.output,
    /Pending migrations: none[\s\S]*Incompatible schema boundaries: none/,
  );
  assert.match(result.output, /Stop application writers before schema work/);
  assert.ok(index(result, (e) => e[0] === 'stop') < index(result, migration));
  assert.match(result.output, /Image-only rollback.*BLOCKED/);
  assert.match(result.output, /backup from BEFORE the blocked boundary/);
  assert.match(result.output, /later deploy retry may already contain/);
});

test('plan and apply both reject incompatible current state before changing runtime or recovery state', () => {
  for (const plan of [true, false]) {
    const result = deploy({ plan, aliasOnly: true, stalePreviousInventory: true });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /current image state is incompatible with the database/);
    assert.doesNotMatch(result.output, /line unknown|PLAN COMPLETE|DEPLOYMENT COMPLETE/);
    assert.equal(result.record, undefined);
    for (const predicate of [migration, recreate, (e) => e[0] === 'stop', (e) => e[0] === 'backup'])
      assert.equal(index(result, predicate), -1);
  }
});

test('final plan includes the unchanged bot that schema quiescence will stop', () => {
  const result = deploy({ plan: true, bot: true });
  assert.equal(result.status, 0, result.output);
  assert.equal(result.output.split('Deployment actions').length - 1, 1);
  assert.match(result.output, /Recreate telegram-ops-bot: restore stopped writer/);
  assert.match(result.output, /WARN\s+Image-only rollback[\s\S]*PLAN COMPLETE/);
  assert.equal(
    index(result, (e) => e[0] === 'stop'),
    -1,
  );
});

test('concise output retains warnings and diagnostics, while verbose output exposes routine details', () => {
  for (const verbose of [false, true]) {
    const result = deploy({ plan: true, edge: true, caddyWarning: true, verbose });
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /WARN caddyfile fixture nonfatal warning/);
    assert.match(result.output, /PLAN COMPLETE - preflight passed \(2 warnings\)/);
    assert.match(result.logs, /fixture layer: Pull complete/);
    assert.match(result.logs, /fixture Caddy routine lifecycle chatter/);
    assert.equal(result.output.includes('fixture layer: Pull complete'), verbose);
    assert.equal(result.output.includes('fixture Caddy routine lifecycle chatter'), verbose);
  }
});

test('failed step preserves exit code, shows diagnostics and phase, and never reports completion', () => {
  const result = deploy({ plan: true, pullFail: true });
  assert.equal(result.status, 17, result.output);
  assert.match(result.output, /FAILED\s+Release images \/ Pull batch-backend image/);
  assert.match(result.output, /fixture registry unavailable/);
  assert.match(
    result.output,
    /writer_stop_attempted=false migrations_invoked=false services_update_attempted=false/,
  );
  assert.doesNotMatch(result.output, /PLAN COMPLETE|DEPLOYMENT COMPLETE|line unknown/);
  assert.equal(index(result, migration), -1);
});

test('health checks hide recoverable failures and bound each request; exhaustion reports the final error', () => {
  const recovered = deploy({ aliasOnly: true, healthRetry: true });
  assert.equal(recovered.status, 0, recovered.output);
  assert.match(recovered.output, /attempt 2\/30/);
  assert.doesNotMatch(recovered.output, /fixture connection reset/);
  assert.match(recovered.logs, /fixture connection reset/);

  const failed = deploy({ aliasOnly: true, healthFail: true });
  assert.equal(failed.status, 1, failed.output);
  assert.match(failed.output, /FAILED\s+Verification \/ Wait for http/);
  assert.match(failed.output, /Health check exhausted 30 attempts/);
  assert.match(failed.output, /fixture connection reset/);
  assert.doesNotMatch(failed.output, /DEPLOYMENT COMPLETE/);
  const requests = failed.events.filter((event) => event[0] === 'curl');
  assert.equal(requests.length, 30);
  for (const request of requests) {
    assert.deepEqual(request.slice(1, 5), ['--connect-timeout', '3', '--max-time', '5']);
  }
});
