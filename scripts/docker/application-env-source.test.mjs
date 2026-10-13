import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const readRepoFile = (relativePath) => readFileSync(new URL(relativePath, root), 'utf8');

test('Compose services use only the canonical application env file', () => {
  for (const file of ['docker-compose.yml']) {
    const contents = readRepoFile(file);
    assert.match(contents, /env_file:\s*\n\s*- \.env\b/u);
    assert.doesNotMatch(contents, /\.env\.batch-backend/u);
  }
});

test('host backup and operations scripts default to the canonical application env file', () => {
  const scripts = [
    'scripts/docker/postgres-backup-s3.sh',
    'scripts/docker/postgres-backup-restore.sh',
    'scripts/docker/postgres-ops-status.sh',
    'scripts/docker/run-postgres-artifact-integrity-check.sh',
    'scripts/docker/run-postgres-backup-s3.sh',
    'scripts/docker/run-postgres-ops-alert.sh',
    'scripts/docker/run-postgres-restore-drill.sh',
  ];

  for (const file of scripts) {
    const contents = readRepoFile(file);
    assert.match(contents, /DEFAULT_ENV_FILE="\$\{ROOT_DIR\}\/\.env"/u, file);
    assert.doesNotMatch(contents, /\.env\.batch-backend/u, file);
  }
});

test('production Compose defaults to protected config and host loaders select before sourcing', () => {
  assert.match(
    readRepoFile('docker-compose.prod.yml'),
    /ESL_PRODUCTION_ENV_FILE:-\/etc\/esl-pipeline\/production\.env/u,
  );
  assert.match(
    readRepoFile('scripts/docker/postgres-ops-common.sh'),
    /production-paths\.mjs.*env/u,
  );
  for (const file of [
    'postgres-backup-s3',
    'postgres-backup-restore',
    'postgres-ops-status',
    'run-postgres-artifact-integrity-check',
    'run-postgres-backup-s3',
    'run-postgres-ops-alert',
    'run-postgres-restore-drill',
    'run-host-runtime-health-alert',
  ]) {
    const content = readRepoFile(`scripts/docker/${file}.sh`);
    assert.ok(
      content.indexOf('pg_backup_select_env_file') < content.indexOf('. "$ENV_FILE"'),
      file,
    );
  }
});
