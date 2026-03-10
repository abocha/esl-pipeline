# Postgres Ops Health Alerts (Status + Telegram)

## Meta

- Audience: maintainers and AI agents operating backup health automation.
- Authority Level: operations runbook.
- Last Verified Against: 2026-03-04 repo state.
- Owner: ops maintainer + automation agents.
- Review Cadence: monthly or after alerting logic changes.
- Status: `runbook`.

This runbook covers operational health checks layered on top of the backup + restore-drill flow.

## Commands

- `pnpm ops:status` — human-readable health summary table.
- `pnpm ops:status:json` — machine-readable health JSON.
- `pnpm ops:alert:check` — evaluate health + send Telegram on failure/recovery transitions.
- `pnpm ops:key-rotation:check` — weekly AWS key-age reminder check.

## Health Rules (Defaults)

- Backup freshness threshold: `PG_BACKUP_HEALTH_MAX_BACKUP_AGE_HOURS=26`
- Restore-drill freshness threshold: `PG_BACKUP_HEALTH_MAX_DRILL_AGE_DAYS=35`
- Key-rotation threshold: `PG_BACKUP_KEY_ROTATION_MAX_AGE_DAYS=80`
- Alert cooldown: `PG_BACKUP_ALERT_COOLDOWN_MINUTES=360`
- LR-010 storage-retirement invariant: `uploaded_files` rows with `storage_provider='filesystem'` should remain `0` in active environments.

## Required Env (Telegram + IAM)

Set in `.env.batch-backend`:

```bash
PG_BACKUP_ALERT_TELEGRAM_BOT_TOKEN=123456789:token
PG_BACKUP_ALERT_TELEGRAM_CHAT_ID=-1001234567890
# Optional thread in forum-enabled chats:
# PG_BACKUP_ALERT_TELEGRAM_THREAD_ID=42
PG_BACKUP_ALERT_TELEGRAM_DISABLE=false
```

Optional IAM user override:

```bash
# If omitted, scripts auto-derive from STS caller ARN.
# PG_BACKUP_IAM_USER=esl-backup-uploader
```

Required IAM read permissions for key checks:

- `iam:ListAccessKeys`
- `iam:GetAccessKeyLastUsed`

## Scheduler Cadence (WSL + Task Scheduler)

Recommended jobs:

1. Every 6 hours: ops health check and Telegram alerting.
2. Weekly: key-rotation reminder check.

Program/script:

```text
C:\Windows\System32\wsl.exe
```

Add arguments (6-hour ops alert check):

```text
-d Ubuntu-24.04 -- /bin/bash -lc "/home/abocha/code/esl-pipeline/scripts/docker/run-postgres-ops-alert.sh"
```

Add arguments (weekly key reminder):

```text
-d Ubuntu-24.04 -- /bin/bash -lc "/home/abocha/code/esl-pipeline/scripts/docker/run-aws-key-rotation-reminder.sh"
```

## Output Paths

- Alert logs: `tmp/logs/backup/postgres-ops-alert-*.log`
- Key reminder logs: `tmp/logs/backup/aws-key-rotation-reminder-*.log`
- Alert state (for cooldown/recovery): `tmp/state/postgres-ops-alert-state.json`
- Latest drill report pointer consumed by status checks:
  - `tmp/logs/backup/restore-drill-report-latest.json`

## Restore Drill JSON Reporting

`run-postgres-restore-drill-reminder.sh` now writes:

- Per-run report: `restore-drill-report-<timestamp>.json`
- Latest pointer: `restore-drill-report-latest.json`

This is used by `pnpm ops:status` and `pnpm ops:alert:check` to track monthly drill freshness.
