# Postgres Backup to S3 (Automated + Restorable)

## Meta

- Audience: maintainers and AI agents operating backup archival.
- Authority Level: operations runbook.
- Last Verified Against: 2026-06-11 repo state.
- Owner: ops maintainer + automation agents.
- Review Cadence: monthly or after scheduler/env changes.
- Status: `runbook`.

This runbook adds remote backup archival on top of the local Docker backup routine.

For alerting/status/key-rotation operational checks, see:
`docs/operations/postgres-ops-health.md`.

## TL;DR (Copy/Paste)

Local one-off sanity checks:

```bash
pnpm docker:db:backup:s3 -- manual_checkpoint
pnpm docker:db:list:s3
pnpm docker:db:restore:s3 -- <key-or-s3-uri-to-.dump> --download-only
```

Daily scheduled task (WSL/Windows Task Scheduler):

- Program/script:

```text
C:\Windows\System32\wsl.exe
```

- Add arguments:

```text
-d Ubuntu-24.04 -- /bin/bash -lc "/home/abocha/code/esl-pipeline/scripts/docker/run-postgres-backup-s3.sh"
```

Monthly reminder/drill task:

- Reminder only:

```text
-d Ubuntu-24.04 -- /bin/bash -lc "/home/abocha/code/esl-pipeline/scripts/docker/run-postgres-restore-drill-reminder.sh"
```

- Auto drill (`--download-only`):

```text
-d Ubuntu-24.04 -- /bin/bash -lc "PG_BACKUP_RESTORE_DRILL_AUTO=true /home/abocha/code/esl-pipeline/scripts/docker/run-postgres-restore-drill-reminder.sh"
```

## Scripts and Commands

- Local backup source of truth: `scripts/docker/postgres-backup-restore.sh`
- S3 wrapper: `scripts/docker/postgres-backup-s3.sh`
- Production Compose targeting wrapper: `scripts/docker/postgres-prod-backup-s3.sh`
- Scheduler wrapper: `scripts/docker/run-postgres-backup-s3.sh`
- Monthly drill reminder wrapper: `scripts/docker/run-postgres-restore-drill-reminder.sh`
- Ops status helper: `scripts/docker/postgres-ops-status.sh`
- Ops alert wrapper: `scripts/docker/run-postgres-ops-alert.sh`
- Key-rotation reminder wrapper: `scripts/docker/run-aws-key-rotation-reminder.sh`

Wrapper commands:

- `pnpm docker:db:backup:s3` (create local backup set + upload all artifacts)
- `pnpm docker:db:backup:s3:scheduled` (scheduler wrapper; loads env + logs)
- `pnpm docker:db:upload:s3` (upload latest local backup set)
- `pnpm docker:db:list:s3` (list remote backup objects)
- `pnpm docker:db:restore:s3 -- <s3://bucket/key.dump|key.dump> [--clean]`
- `pnpm docker:prod:db:backup:s3` (same operation, targeting `docker-compose.prod.yml`)
- `pnpm docker:prod:db:upload:s3` (upload latest local prod-targeted set)
- `pnpm docker:prod:db:list:s3` (list remote backup objects for prod/alpha env)
- `pnpm docker:prod:db:restore:s3 -- <s3://bucket/key.dump|key.dump> [--download-only|--clean]`
- `pnpm docker:db:restore-drill:reminder` (monthly reminder with latest remote key)
- `pnpm docker:db:restore-drill:auto` (monthly reminder + auto `--download-only` drill)
- `pnpm ops:status` (table) / `pnpm ops:status:json` (machine-readable)
- `pnpm ops:alert:check` (Telegram failure/recovery alerts + cooldown state)
- `pnpm ops:key-rotation:check` (weekly IAM access key-age reminder)

## Required Environment

Set these in `.env` (or shell env):

```bash
PG_BACKUP_S3_BUCKET=esl-pipeline-db-backups
PG_BACKUP_S3_PREFIX=backups/postgres
PG_BACKUP_S3_REGION=ap-southeast-1
PG_BACKUP_S3_SSE=aws:kms
PG_BACKUP_S3_KMS_KEY_ID=arn:aws:kms:ap-southeast-1:123456789012:key/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
PG_BACKUP_S3_ENV=dev
# Optional profile override:
# PG_BACKUP_S3_PROFILE=default
```

Use `PG_BACKUP_S3_ENV=alpha` on the private hosted Lightsail deployment so hosted rehearsal backups
do not blend into the local/dev prefix.

By default, `postgres-backup-s3.sh` auto-loads `.env` when present.
Override with `PG_BACKUP_ENV_FILE=/path/to/env`.

Defaults:

- `PG_BACKUP_S3_PREFIX=backups/postgres`
- `PG_BACKUP_S3_SSE=aws:kms`
- `PG_BACKUP_S3_ENV=dev`
- Backup source dir is still `tmp/backups/postgres`
- Scheduled maintenance defaults:
  - `PG_BACKUP_LOCAL_RETENTION_DAYS=30`
  - `PG_BACKUP_REMOTE_RESTORE_RETENTION_DAYS=14`
  - `PG_BACKUP_LOG_RETENTION_DAYS=30`
  - `PG_BACKUP_RESTORE_DRILL_AUTO=false`

### Environment Checklist

Make sure these are present in `.env`:

```bash
PG_BACKUP_S3_BUCKET=...
PG_BACKUP_S3_PREFIX=backups/postgres
PG_BACKUP_S3_REGION=ap-southeast-1
PG_BACKUP_S3_SSE=aws:kms
PG_BACKUP_S3_KMS_KEY_ID=arn:aws:kms:...
PG_BACKUP_S3_ENV=dev # use alpha on the hosted Lightsail deployment
```

Optional maintenance knobs:

```bash
PG_BACKUP_ALLOW_EMPTY_SOURCE=false
PG_BACKUP_LOCAL_RETENTION_DAYS=30
PG_BACKUP_REMOTE_RESTORE_RETENTION_DAYS=14
PG_BACKUP_LOG_RETENTION_DAYS=30
PG_BACKUP_RESTORE_DRILL_AUTO=false
```

## Upload Workflow

Create and upload a fresh set:

```bash
pnpm docker:db:backup:s3 -- nightly
```

For the production Compose project used by the closed-alpha Lightsail rehearsal:

```bash
pnpm docker:prod:db:backup:s3 -- alpha_manual_check
```

`backup-upload` inherits empty-source protection from `postgres-backup-restore.sh` during local backup creation:

- default behavior blocks backup/upload when `users`, `jobs`, and `transcripts` are all empty.
- override only when intentional: `PG_BACKUP_ALLOW_EMPTY_SOURCE=true`.

Upload latest existing set only:

```bash
pnpm docker:db:upload:s3
pnpm docker:prod:db:upload:s3
```

`upload-latest` does not perform source-db guard checks because it reuses an already-created local dump set.

List remote objects:

```bash
pnpm docker:db:list:s3
pnpm docker:prod:db:list:s3
```

Object layout:

```text
s3://<bucket>/<prefix>/<env>/<db>/<YYYY>/<MM>/<DD>/<set-prefix>/
```

Each set uploads:

- `<prefix>.dump`
- `<prefix>.sql.gz`
- `<prefix>_schema.sql`
- `<prefix>.sha256`

## Restore Drill from S3

Restore from a remote dump object:

```bash
pnpm docker:db:restore:s3 -- s3://esl-pipeline-db-backups/backups/postgres/dev/esl_batch/2026/03/03/esl_batch_20260303_024204_pre-cleanup-20260303-024203/esl_batch_20260303_024204_pre-cleanup-20260303-024203.dump --clean
```

Or using key-only input (uses `PG_BACKUP_S3_BUCKET`):

```bash
pnpm docker:db:restore:s3 -- backups/postgres/dev/esl_batch/2026/03/03/<set>/<set>.dump --clean
```

What happens:

1. Downloads `.dump` and matching `.sha256` to `tmp/backups/postgres/remote-restore/`.
2. Verifies dump digest before restore.
3. Delegates restore to `postgres-backup-restore.sh`.
4. If restored snapshot is older than current backend schema, run:
   `docker compose exec -T batch-backend pnpm --filter @esl-pipeline/batch-backend db:migrate`
   before serving normal API traffic.

To validate download + digest only (no restore side effects):

```bash
pnpm docker:db:restore:s3 -- backups/postgres/dev/esl_batch/2026/03/03/<set>/<set>.dump --download-only
pnpm docker:prod:db:restore:s3 -- backups/postgres/alpha/esl_batch/2026/06/10/<set>/<set>.dump --download-only
```

## Completion Telegram Notifications

Completion notifications are sent for:

- `backup-upload` (success/failure)
- `restore-remote` (success/failure, including `--download-only`)

Notification delivery uses the same env vars as ops alerts:

- `PG_BACKUP_ALERT_TELEGRAM_BOT_TOKEN`
- `PG_BACKUP_ALERT_TELEGRAM_CHAT_ID`
- optional `PG_BACKUP_ALERT_TELEGRAM_THREAD_ID`
- `PG_BACKUP_ALERT_TELEGRAM_DISABLE`

These notification variables are separate from the optional `TELEGRAM_OPS_BOT_*` runtime. During
manual deployment or restore work, set `PG_BACKUP_ALERT_TELEGRAM_DISABLE=true` unless the bot token,
chat id, and optional forum thread id are known-good. A stale
`PG_BACKUP_ALERT_TELEGRAM_THREAD_ID` can make Telegram reject an otherwise successful backup/restore
completion message.

When `postgres-backup-s3.sh` calls `postgres-backup-restore.sh`, nested completion notifications are internally suppressed to avoid duplicate Telegram messages.

## Daily Automation (Host systemd)

Recommended host timer setup:

`/etc/systemd/system/esl-postgres-backup.service`

```ini
[Unit]
Description=ESL Postgres backup to S3
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=/home/abocha/code/esl-pipeline
ExecStart=/usr/bin/bash /home/abocha/code/esl-pipeline/scripts/docker/run-postgres-backup-s3.sh
```

`/etc/systemd/system/esl-postgres-backup.timer`

```ini
[Unit]
Description=Daily ESL Postgres backup to S3

[Timer]
OnCalendar=*-*-* 03:15:00
RandomizedDelaySec=10m
Persistent=true

[Install]
WantedBy=timers.target
```

Enable timer:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now esl-postgres-backup.timer
systemctl list-timers --all | rg esl-postgres-backup
```

If you are on WSL and see:

```text
System has not been booted with systemd as init system (PID 1)
```

use Windows Task Scheduler instead (see TL;DR above).

Logs:

- `tmp/logs/backup/postgres-backup-s3-*.log`
- Default log retention: 30 days (`PG_BACKUP_LOG_RETENTION_DAYS`)
- Local backup artifact pruning:
  - `tmp/backups/postgres/*.dump|*.sql.gz|*_schema.sql|*.sha256` pruned by `PG_BACKUP_LOCAL_RETENTION_DAYS`
  - `tmp/backups/postgres/remote-restore/*` pruned by `PG_BACKUP_REMOTE_RESTORE_RETENTION_DAYS`

## Monthly Restore Drill Reminder

Run reminder manually:

```bash
pnpm docker:db:restore-drill:reminder
```

This logs the latest remote dump key and a ready-to-run drill command.

Auto-run a safe monthly drill (`--download-only`):

```bash
pnpm docker:db:restore-drill:auto
```

On Windows Task Scheduler (WSL), use:

- Program/script:

```text
C:\Windows\System32\wsl.exe
```

- Add arguments (monthly reminder only):

```text
-d Ubuntu-24.04 -- /bin/bash -lc "/home/abocha/code/esl-pipeline/scripts/docker/run-postgres-restore-drill-reminder.sh"
```

- Add arguments (monthly auto drill):

```text
-d Ubuntu-24.04 -- /bin/bash -lc "PG_BACKUP_RESTORE_DRILL_AUTO=true /home/abocha/code/esl-pipeline/scripts/docker/run-postgres-restore-drill-reminder.sh"
```

## Logs and Where to Look

Primary logs:

- `tmp/logs/backup/postgres-backup-s3-*.log`
- `tmp/logs/backup/restore-drill-reminder-*.log`

In WSL shell:

```bash
ls -lt /home/abocha/code/esl-pipeline/tmp/logs/backup
tail -n 80 /home/abocha/code/esl-pipeline/tmp/logs/backup/<latest-log-file>
```

In Windows Explorer:

```text
\\wsl$\Ubuntu-24.04\home\abocha\code\esl-pipeline\tmp\logs\backup
```

If Task Scheduler flashes a black window and no log is created, the usual cause is
wrong Program path. Use `C:\\Windows\\System32\\wsl.exe` exactly.

## One-Time AWS Bootstrap (Admin Principal)

Use an elevated IAM principal for bucket/KMS/lifecycle configuration.

Create dedicated bucket:

```bash
aws s3api create-bucket \
  --bucket esl-pipeline-db-backups \
  --region ap-southeast-1 \
  --create-bucket-configuration LocationConstraint=ap-southeast-1
```

Enable versioning:

```bash
aws s3api put-bucket-versioning \
  --bucket esl-pipeline-db-backups \
  --versioning-configuration Status=Enabled
```

Block public access:

```bash
aws s3api put-public-access-block \
  --bucket esl-pipeline-db-backups \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

Set lifecycle (90 days current, 30 days noncurrent):

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket esl-pipeline-db-backups \
  --lifecycle-configuration '{
    "Rules": [
      {
        "ID": "postgres-backups-retention",
        "Status": "Enabled",
        "Filter": {"Prefix": "backups/postgres/"},
        "Expiration": {"Days": 90},
        "NoncurrentVersionExpiration": {"NoncurrentDays": 30}
      }
    ]
  }'
```

Create a KMS key + alias (if you do not already have one):

```bash
aws kms create-key \
  --description "esl-pipeline postgres backup encryption key" \
  --region ap-southeast-1

aws kms create-alias \
  --alias-name alias/esl-pipeline-postgres-backup \
  --target-key-id <kms-key-id-or-arn> \
  --region ap-southeast-1
```

If your uploader IAM user cannot run bucket-level read APIs (for example `GetBucketVersioning`), that is expected under strict least privilege.
Likewise, if object tagging permissions are not granted, uploads still succeed and log a warning.

## Suggested Routine

1. Daily scheduler runs `run-postgres-backup-s3.sh`.
2. Monthly scheduler runs `run-postgres-restore-drill-reminder.sh` (or `AUTO=true` variant).
3. Before risky DB changes, run manual checkpoint:

```bash
pnpm docker:db:backup:s3 -- pre_change
```

4. Keep periodic restore drills in non-prod to verify end-to-end recovery.
