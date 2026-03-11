# Postgres Backup & Restore (Docker Routine)

## Meta

- Audience: maintainers and AI agents operating backup/restore locally.
- Authority Level: operations runbook.
- Last Verified Against: 2026-03-04 repo state.
- Owner: ops maintainer + automation agents.
- Review Cadence: monthly or after backup script changes.
- Status: `runbook`.

This runbook standardizes safe Postgres backups/restores for the local Docker stack.
For S3 archival + automated scheduling, see
`docs/operations/postgres-backup-s3.md`.

## Script

- Path: `scripts/docker/postgres-backup-restore.sh`
- Wrapper commands:
  - `pnpm docker:db:backup`
  - `pnpm docker:db:backups`
  - `pnpm docker:db:verify-backup -- <backup-file>`
  - `pnpm docker:db:restore -- <backup-file> [--clean]`
  - Optional remote archive wrappers:
    - `pnpm docker:db:backup:s3`
    - `pnpm docker:db:upload:s3`
    - `pnpm docker:db:list:s3`
    - `pnpm docker:db:restore:s3 -- <s3://bucket/key.dump|key.dump> [--clean]`

## Defaults

- Compose project: `esl-pipeline`
- Compose file: `docker-compose.yml`
- Service: `postgres`
- Database: `esl_batch`
- User: `esl`
- Backup directory: `tmp/backups/postgres`

Override any default with env vars:

```bash
PG_COMPOSE_PROJECT=esl-pipeline \
PG_COMPOSE_FILE=docker-compose.yml \
PG_SERVICE_NAME=postgres \
# Optional explicit fallback:
PG_CONTAINER_NAME=esl-pipeline-postgres-1 \
PG_DATABASE=esl_batch \
PG_USER=esl \
PG_BACKUP_DIR=tmp/backups/postgres \
pnpm docker:db:backup
```

## Backup

Create a timestamped backup set:

```bash
pnpm docker:db:backup
```

Optional label:

```bash
pnpm docker:db:backup -- pre_migration
```

Each backup creates:

- `<prefix>.sql.gz` (plain SQL, compressed)
- `<prefix>.dump` (custom pg_dump format)
- `<prefix>_schema.sql` (schema only)
- `<prefix>.sha256` (checksums)

### Empty-Source Guard

`backup` now blocks empty-source snapshots by default using anchor-table probes:

- `users`
- `jobs`
- `transcripts`

If all anchor tables are empty, backup exits non-zero and does not emit a successful backup set.

To intentionally allow an empty-source snapshot:

```bash
PG_BACKUP_ALLOW_EMPTY_SOURCE=true pnpm docker:db:backup -- intentional-empty
```

The script logs a guard summary and decision for each backup run.

### Completion Telegram Notifications

`backup` and `restore` send completion Telegram messages (success/failure) when:

- `PG_BACKUP_ALERT_TELEGRAM_BOT_TOKEN` is set
- `PG_BACKUP_ALERT_TELEGRAM_CHAT_ID` is set
- `PG_BACKUP_ALERT_TELEGRAM_DISABLE` is not `true`

Messages include operation, status, UTC timestamp, duration, db name, source/target, and failure context (when applicable).

## Verify

Verify checksum and, for `.dump`, verify TOC readability with `pg_restore -l`:

```bash
pnpm docker:db:verify-backup -- tmp/backups/postgres/esl_batch_YYYYMMDD_HHMMSS.dump
```

## Restore

Restore from custom dump (recommended):

```bash
pnpm docker:db:restore -- tmp/backups/postgres/esl_batch_YYYYMMDD_HHMMSS.dump
```

Clean restore from custom dump (drops existing objects first):

```bash
pnpm docker:db:restore -- tmp/backups/postgres/esl_batch_YYYYMMDD_HHMMSS.dump --clean
```

Restore from plain SQL:

```bash
pnpm docker:db:restore -- tmp/backups/postgres/esl_batch_YYYYMMDD_HHMMSS.sql.gz
```

Notes:

- `--clean` is supported only for `.dump` restore.
- Always verify a backup before a destructive restore.
- Restoring older snapshots can leave schema behind current app code. After restore, run:
  `docker compose exec -T batch-backend pnpm --filter @esl-pipeline/batch-backend db:migrate`
  before starting normal API usage.

## Suggested Routine

1. Before migrations or risky DB changes:
   - `pnpm docker:db:backup -- pre_change`
2. Verify backup:
   - `pnpm docker:db:verify-backup -- <dump-file>`
3. Apply changes.
4. If rollback needed:
   - `pnpm docker:db:restore -- <dump-file> --clean`
