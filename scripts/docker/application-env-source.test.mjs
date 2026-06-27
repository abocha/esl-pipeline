import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const readRepoFile = (relativePath) => readFileSync(new URL(relativePath, root), 'utf8');

test('Compose services use only the canonical application env file', () => {
  for (const file of ['docker-compose.yml', 'docker-compose.prod.yml']) {
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
    'scripts/docker/run-aws-key-rotation-reminder.sh',
    'scripts/docker/run-postgres-backup-s3.sh',
    'scripts/docker/run-postgres-ops-alert.sh',
    'scripts/docker/run-postgres-restore-drill-reminder.sh',
  ];

  for (const file of scripts) {
    const contents = readRepoFile(file);
    assert.match(contents, /DEFAULT_ENV_FILE="\$\{ROOT_DIR\}\/\.env"/u, file);
    assert.doesNotMatch(contents, /\.env\.batch-backend/u, file);
  }
});
