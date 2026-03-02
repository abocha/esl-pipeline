# Postgres Backup & Restore (Docker Routine)

This runbook standardizes safe Postgres backups/restores for the local Docker stack.

## Script

- Path: `scripts/docker/postgres-backup-restore.sh`
- Wrapper commands:
  - `pnpm docker:db:backup`
  - `pnpm docker:db:backups`
  - `pnpm docker:db:verify-backup -- <backup-file>`
  - `pnpm docker:db:restore -- <backup-file> [--clean]`

## Defaults

- Container: `esl-backend-postgres`
- Database: `esl_batch`
- User: `esl`
- Backup directory: `tmp/backups/postgres`

Override any default with env vars:

```bash
PG_CONTAINER_NAME=esl-backend-postgres \
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

## Suggested Routine

1. Before migrations or risky DB changes:
   - `pnpm docker:db:backup -- pre_change`
2. Verify backup:
   - `pnpm docker:db:verify-backup -- <dump-file>`
3. Apply changes.
4. If rollback needed:
   - `pnpm docker:db:restore -- <dump-file> --clean`
