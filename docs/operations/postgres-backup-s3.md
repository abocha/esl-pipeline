# PostgreSQL Backup to S3

## Meta

- Audience: maintainers and operators of backup archival.
- Authority Level: operations runbook.
- Last Verified Against: 2026-09-13 repo state.
- Owner: ops maintainer + automation agents.
- Review Cadence: monthly or after scheduler/environment changes.
- Status: `runbook`.

This runbook covers host-owned PostgreSQL backup creation, encrypted S3 archival, remote artifact
integrity checks, and isolated restore drills. For health/alert semantics, see
[`postgres-ops-health.md`](postgres-ops-health.md).

## Configuration

The namespace remains environment-selectable:

```bash
PG_BACKUP_S3_BUCKET=esl-pipeline-db-backups
PG_BACKUP_S3_PREFIX=backups/postgres
PG_BACKUP_S3_REGION=ap-southeast-1
PG_BACKUP_S3_SSE=aws:kms
PG_BACKUP_S3_KMS_KEY_ID=arn:aws:kms:ap-southeast-1:123456789012:key/...
PG_BACKUP_S3_ENV=dev
```

Production uses `PG_BACKUP_S3_ENV=prod`. The production wrapper defaults to `prod` while preserving
an explicit `PG_BACKUP_S3_ENV` override. Do not use the retired `alpha` namespace for production.

Host operations state must not live under the checkout or use container `/app/...` paths:

```bash
PG_BACKUP_HOST_STATE_DIR=/var/lib/esl-pipeline/ops
```

The generic local default is `${XDG_STATE_HOME:-$HOME/.local/state}/esl-pipeline/ops`. See
[`postgres-ops-health.md`](postgres-ops-health.md) for the directory layout and ownership boundary.
Scripts load `<repo>/.env` by default; use `PG_BACKUP_ENV_FILE=/absolute/host/path` to select another
host environment file.

## Commands

Create and upload a complete backup set:

```bash
pnpm docker:db:backup:s3 -- manual_checkpoint
pnpm docker:prod:db:backup:s3 -- pre_change
```

The production wrapper targets `docker-compose.prod.yml`, defaults the Compose project to
`esl-pipeline-prod`, the host state root to `/var/lib/esl-pipeline/ops`, and the S3 namespace to
`prod`. Each setting remains explicitly overrideable.

List remote objects:

```bash
pnpm docker:db:list:s3
pnpm docker:prod:db:list:s3
```

Upload the latest complete local set without creating a new snapshot:

```bash
pnpm docker:db:upload:s3
pnpm docker:prod:db:upload:s3
```

Object layout:

```text
s3://<bucket>/<prefix>/<environment>/<database>/<YYYY>/<MM>/<DD>/<set-prefix>/
```

Each set contains `.dump`, `.sql.gz`, `_schema.sql`, and `.sha256` artifacts. Backup creation retains
the empty-source guard over `users`, `jobs`, and `transcripts`; set
`PG_BACKUP_ALLOW_EMPTY_SOURCE=true` only for an intentional empty database snapshot.

## Remote Artifact Integrity

Check the latest configured dump, or select one explicitly:

```bash
pnpm docker:db:artifact-integrity
pnpm docker:db:artifact-integrity -- backups/postgres/prod/esl_batch/.../backup.dump
pnpm docker:prod:db:artifact-integrity -- [dump-key-or-s3-uri]
```

This downloads the `.dump` and matching `.sha256`, verifies SHA-256, and writes an artifact-integrity
report. It does not restore a database. The low-level equivalent for a selected key is:

```bash
bash scripts/docker/postgres-backup-s3.sh verify-remote <key-or-s3-uri>
```

`restore-remote --download-only` has been retired because it described an integrity check as a
restore drill. Use `verify-remote` or `docker:db:artifact-integrity` instead.

An empty or mistargeted prefix produces `no_remote_dump_found` cleanly. S3 discovery coalesces
`Contents=null` to an empty array before sorting.

## Disposable Restore Drill

Restore the latest configured dump, or a selected dump, into isolated PostgreSQL 18.6:

```bash
pnpm docker:db:restore-drill
pnpm docker:db:restore-drill -- backups/postgres/prod/esl_batch/.../backup.dump
pnpm docker:prod:db:restore-drill -- [dump-key-or-s3-uri]
```

The drill creates unique disposable Docker resources, publishes no port, uses `--network none`,
restores and reads only the disposable database, records structured evidence, and removes the
container and volume through an exit trap. It does not reference or attach production
`postgres18_data`.

The default drill image is `postgres:18.6-alpine3.24`. Override it only as part of a reviewed runtime
change:

```bash
PG_BACKUP_RESTORE_DRILL_IMAGE=postgres:18.6-alpine3.24
PG_BACKUP_RESTORE_DRILL_EXPECTED_VERSION=18.6
```

## Intentional Restore into a Configured Database

The existing explicit restore command remains available for an operator-selected target:

```bash
pnpm docker:db:restore:s3 -- <key-or-s3-uri> [--clean]
pnpm docker:prod:db:restore:s3 -- <key-or-s3-uri> [--clean]
```

This is destructive to the configured database target and is not the restore drill. Verify the
container/Compose target and backup before running it. Repository tests and scheduled drills never
invoke this production-targeted path.

## Scheduling and Retention

Recommended production host jobs:

- daily: `scripts/docker/run-postgres-backup-s3.sh`
- weekly: `pnpm docker:prod:db:artifact-integrity`
- monthly: `pnpm docker:prod:db:restore-drill`
- every 6 hours: `pnpm ops:alert:check`

For a systemd service, use the deployed checkout as `WorkingDirectory`, load the host `.env`, and set
`PG_BACKUP_HOST_STATE_DIR=/var/lib/esl-pipeline/ops`. The service user needs write access to that
directory, Docker access for backup/drill operations, and least-privilege access to the configured
S3/KMS objects.

Retention knobs:

```bash
PG_BACKUP_LOCAL_RETENTION_DAYS=30
PG_BACKUP_REMOTE_RESTORE_RETENTION_DAYS=14
PG_BACKUP_LOG_RETENTION_DAYS=30
```

The scheduler prunes only files under the resolved host backup/log directories. S3 object lifecycle
and versioning remain AWS-owned configuration and are not changed by these scripts.

## Completion Notifications

Backup upload, remote restore, and selected remote artifact verification reuse:

- `PG_BACKUP_ALERT_TELEGRAM_BOT_TOKEN`
- `PG_BACKUP_ALERT_TELEGRAM_CHAT_ID`
- optional `PG_BACKUP_ALERT_TELEGRAM_THREAD_ID`
- `PG_BACKUP_ALERT_TELEGRAM_DISABLE`

Set `PG_BACKUP_ALERT_TELEGRAM_DISABLE=true` during manual maintenance unless the target is known-good.
Nested local backup/restore notifications remain suppressed so one operation does not send duplicate
messages.
