import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const readRepoFile = (relativePath) => readFileSync(new URL(relativePath, root), 'utf8');

test('production wrappers share host state and selectable prod namespace defaults', () => {
  const common = readRepoFile('scripts/docker/postgres-ops-common.sh');
  assert.match(
    common,
    /PG_BACKUP_HOST_STATE_DIR="\$\{PG_BACKUP_HOST_STATE_DIR:-\/var\/lib\/esl-pipeline\/ops\}"/u,
  );
  assert.match(common, /PG_BACKUP_S3_ENV="\$\{PG_BACKUP_S3_ENV:-prod\}"/u);

  for (const file of [
    'scripts/docker/postgres-prod-backup-s3.sh',
    'scripts/docker/postgres-prod-artifact-integrity.sh',
    'scripts/docker/postgres-prod-restore-drill.sh',
  ]) {
    assert.match(readRepoFile(file), /pg_backup_set_production_defaults/u, file);
  }
});

test('production evidence wrappers invoke non-executable runners through Bash', () => {
  for (const [wrapper, runner] of [
    [
      'scripts/docker/postgres-prod-artifact-integrity.sh',
      'run-postgres-artifact-integrity-check.sh',
    ],
    ['scripts/docker/postgres-prod-restore-drill.sh', 'run-postgres-restore-drill.sh'],
  ]) {
    assert.match(
      readRepoFile(wrapper),
      new RegExp(`exec bash "\\$\\{ROOT_DIR\\}/scripts/docker/${runner}" "\\$@"`, 'u'),
      wrapper,
    );
  }
});

test('restore drill invokes its integrity runner through Bash and preserves pipeline status', () => {
  const drill = readRepoFile('scripts/docker/run-postgres-restore-drill.sh');

  assert.match(drill, /if \[\[ ! -f "\$INTEGRITY_SCRIPT" \]\]; then/u);
  assert.doesNotMatch(drill, /\[\[ ! -x "\$INTEGRITY_SCRIPT" \]\]/u);
  assert.match(
    drill,
    /PG_BACKUP_ARTIFACT_RESULT_FILE="\$integrity_result_file" \\\r?\n  bash "\$INTEGRITY_SCRIPT" "\$\{integrity_args\[@\]\}" 2>&1 \| tee -a "\$log_file"\r?\n/u,
  );
  assert.match(drill, /integrity_rc=\$\{PIPESTATUS\[0\]\}/u);
});

test('latest remote dump discovery coalesces empty S3 Contents to an empty array', () => {
  const common = readRepoFile('scripts/docker/postgres-ops-common.sh');
  assert.match(
    common,
    /sort_by\(\(Contents \|\| `\[\]`\)\[\?ends_with\(Key, `\.dump`\)\], &LastModified\)/u,
  );

  for (const file of [
    'scripts/docker/postgres-ops-status.sh',
    'scripts/docker/run-postgres-artifact-integrity-check.sh',
  ]) {
    assert.match(readRepoFile(file), /pg_backup_latest_remote_dump/u, file);
  }
});

test('artifact integrity and restore drill are separate evidence paths', () => {
  const s3 = readRepoFile('scripts/docker/postgres-backup-s3.sh');
  const integrity = readRepoFile('scripts/docker/run-postgres-artifact-integrity-check.sh');
  const drill = readRepoFile('scripts/docker/run-postgres-restore-drill.sh');

  assert.match(s3, /verify-remote <s3:\/\/bucket\/key\.dump\|key\.dump>/u);
  assert.doesNotMatch(s3, /--download-only/u);
  assert.match(integrity, /"checksum_verified": \$\{checksum_verified\}/u);
  assert.match(drill, /"restore_verified": \$\{restore_verified\}/u);
  assert.match(drill, /pg_restore[\s\S]*--exit-on-error --no-owner --no-privileges/u);
});

test('restore drill targets disposable PostgreSQL 18.6 state and always removes it', () => {
  const drill = readRepoFile('scripts/docker/run-postgres-restore-drill.sh');
  assert.match(drill, /postgres:18\.6-alpine3\.24/u);
  assert.match(drill, /--network none/u);
  assert.match(drill, /target=\/var\/lib\/postgresql/u);
  assert.match(drill, /public\.schema_migrations/u);
  assert.match(drill, /public\.users/u);
  assert.match(drill, /public\.jobs/u);
  assert.match(drill, /public\.transcripts/u);
  assert.match(drill, /docker rm -f "\$container_name"/u);
  assert.match(drill, /docker volume rm "\$volume_name"/u);
  assert.doesNotMatch(drill, /postgres18_data/u);
});

test('active ops scripts contain no IAM key-age health plumbing or container report path', () => {
  const active = [
    'package.json',
    '.env.example',
    'docker-compose.yml',
    'docker-compose.prod.yml',
    'scripts/docker/postgres-ops-status.sh',
    'scripts/docker/run-postgres-ops-alert.sh',
  ]
    .map(readRepoFile)
    .join('\n');

  assert.doesNotMatch(active, /keyRotation|KEY_ROTATION|PG_BACKUP_IAM_USER/u);
  assert.doesNotMatch(active, /PG_BACKUP_RESTORE_DRILL_REPORT_LATEST/u);
});
