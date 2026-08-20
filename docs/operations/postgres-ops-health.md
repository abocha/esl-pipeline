# Postgres Ops Health Alerts (Status + Telegram)

## Meta

- Audience: maintainers and AI agents operating backup health automation.
- Authority Level: operations runbook.
- Last Verified Against: 2026-08-20 repo state.
- Owner: ops maintainer + automation agents.
- Review Cadence: monthly or after alerting logic changes.
- Status: `runbook`.

This runbook covers operational health checks layered on top of the backup + restore-drill flow.
Backup/restore completion notifications are handled by the backup scripts themselves and are separate from transition-based ops alerts in this runbook.

## Sources of Truth

- Command wiring: [`package.json`](../../package.json).
- Health and alert behavior: `scripts/docker/postgres-ops-status.sh` and
  `scripts/docker/run-postgres-ops-alert.sh`.
- Key-rotation behavior: `scripts/docker/run-aws-key-rotation-reminder.sh`.
- Restore-drill reporting: `scripts/docker/run-postgres-restore-drill-reminder.sh`.
- Compose database and service settings: [`docker-compose.yml`](../../docker-compose.yml) and
  [`docker-compose.prod.yml`](../../docker-compose.prod.yml).
- Canonical environment ownership: [`docs/reference/env.md`](../reference/env.md).

This runbook summarizes those tracked sources; when a default or path changes, update the source
first and then refresh this summary.

## Commands

- `pnpm ops:status` — human-readable health summary table.
- `pnpm ops:status:json` — machine-readable health JSON.
- `pnpm ops:alert:check` — evaluate health + send Telegram on failure, recovery, escalation, and
  cooldown-repeat transitions; writes alert state and exits non-zero while the status is not healthy.
- `pnpm ops:key-rotation:check` — weekly AWS key-age reminder check.

## Health Rules (Defaults)

- Backup freshness threshold: `PG_BACKUP_HEALTH_MAX_BACKUP_AGE_HOURS=26`
- Restore-drill freshness threshold: `PG_BACKUP_HEALTH_MAX_DRILL_AGE_DAYS=35`
- Key-rotation threshold: `PG_BACKUP_KEY_ROTATION_MAX_AGE_DAYS=80`
- Alert cooldown: `PG_BACKUP_ALERT_COOLDOWN_MINUTES=360`
- Production storage policy: [`production-env-checklist.md`](production-env-checklist.md) requires
  `STORAGE_PROVIDER=s3`; `.env.example` retains `filesystem` as a supported local/development
  configuration. These four health commands do not inspect `uploaded_files` storage rows.

Backup and restore-drill age checks become critical when age is greater than the configured
threshold; key rotation becomes critical when the oldest active key age is greater than or equal to
its threshold. Missing configuration, reports, or AWS responses are classified by the status script
as degraded or critical rather than being treated as healthy.

## Utilization Diagnostics

Compose-managed Postgres runs with `pg_stat_statements` preloaded, `track_io_timing=on`,
`log_lock_waits=on`, and `idle_in_transaction_session_timeout=60s`. The migration chain and fresh
schema baseline try to create the extension when the server supports it, then skip with a notice if a
managed database role cannot install it.

Neither Compose file sets PostgreSQL `transaction_timeout` or `statement_timeout`; the configured
`idle_in_transaction_session_timeout=60s` only terminates sessions that remain idle while a
transaction is open.

Both Compose files set per-service `PG_APPLICATION_NAME` and `PG_POOL_MAX` overrides: API (`8`),
batch worker (`6`), student-memory worker (`4`), Telegram ops bot (`2`), and transcribe worker (`4`).
These values let API and worker connection usage be attributed and capped independently instead of
multiplying the shared environment default across every process.

Useful live checks:

```sql
SELECT application_name, state, count(*)
FROM pg_stat_activity
GROUP BY application_name, state
ORDER BY application_name, state NULLS FIRST;

SELECT query, calls, mean_exec_time, rows, shared_blks_read, shared_blks_hit
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;
```

If `pg_stat_user_tables.n_live_tup` looks wrong after a restore, import, or long local session, run
`ANALYZE;` before using table statistics for sizing or query-plan decisions.

## Local Migration Checksum Recovery

Historical migrations are append-only after merge, but an unlanded local branch may still rewrite
its latest migration while the Docker dev database has already applied the earlier draft. Startup
then fails with:

```text
Migration status is invalid (checksum mismatch or missing migration files); resolve before startup.
```

Confirm the mismatch first:

```bash
pnpm --filter @esl-pipeline/batch-backend db:status
```

For a rewritten latest local migration only, make that migration pending again and re-apply it
against the dev database:

```bash
docker compose -p esl-pipeline -f docker-compose.yml exec -T postgres \
  psql -U esl -d esl_batch \
  -c "DELETE FROM schema_migrations WHERE id = '<latest_local_migration_id>';"
pnpm --filter @esl-pipeline/batch-backend db:migrate
```

Use this only for unmerged local migration rewrites. For merged or shared migration history,
preserve append-only history and add a new migration instead.

## Required Env (Telegram + IAM)

For host-invoked checks, configure the canonical repository `.env` file. The scripts load
`PG_BACKUP_ENV_FILE` when explicitly set and otherwise default to `<repo>/.env`; `.env.example` is
only the tracked template. See [`docs/reference/env.md`](../reference/env.md) for the repository-wide
environment contract.

Set the following in `.env`:

```bash
PG_BACKUP_ALERT_TELEGRAM_BOT_TOKEN=123456789:token
PG_BACKUP_ALERT_TELEGRAM_CHAT_ID=-1001234567890
# Optional thread in forum-enabled chats:
# PG_BACKUP_ALERT_TELEGRAM_THREAD_ID=42
PG_BACKUP_ALERT_TELEGRAM_DISABLE=false
```

These Telegram variables are shared by:

- completion notifications from backup/restore scripts
- transition-based ops alerts (`run-postgres-ops-alert.sh`)
- key-rotation reminders (`run-aws-key-rotation-reminder.sh`)

Optional IAM user override:

```bash
# If omitted, scripts auto-derive from STS caller ARN.
# PG_BACKUP_IAM_USER=esl-backup-uploader
```

If `PG_BACKUP_IAM_USER` is omitted, the scripts call `sts:GetCallerIdentity` and auto-derive only an
IAM user ARN. Assumed-role or other caller ARNs require the explicit override.

Required IAM read permissions for key checks:

- `sts:GetCallerIdentity` when relying on automatic IAM-user discovery
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
-d Ubuntu-24.04 -- /bin/bash -lc "cd /path/to/esl-pipeline && ./scripts/docker/run-postgres-ops-alert.sh"
```

Add arguments (weekly key reminder):

```text
-d Ubuntu-24.04 -- /bin/bash -lc "cd /path/to/esl-pipeline && ./scripts/docker/run-aws-key-rotation-reminder.sh"
```

Replace `/path/to/esl-pipeline` with the checkout path visible inside the selected WSL
distribution. The repository does not prescribe a machine-specific WSL mount or checkout path.

## Output Paths

- Alert logs (default): `tmp/logs/backup/postgres-ops-alert-*.log`
- Key reminder logs (default): `tmp/logs/backup/aws-key-rotation-reminder-*.log`
- Alert state (default, for cooldown/recovery): `tmp/state/postgres-ops-alert-state.json`
- Latest drill report pointer (default, consumed by status checks):
  - `tmp/logs/backup/restore-drill-report-latest.json`

`PG_BACKUP_LOG_DIR`, `PG_BACKUP_ALERT_STATE_FILE`, and
`PG_BACKUP_RESTORE_DRILL_REPORT_LATEST` override these paths when an operator needs a different
location.

## Restore Drill JSON Reporting

`run-postgres-restore-drill-reminder.sh` writes:

- Per-run report: `restore-drill-report-<timestamp>.json`
- Latest pointer: `restore-drill-report-latest.json`
- Report fields: `timestamp_utc`, `mode`, `status`, `latest_remote_dump_key`, `suggested_command`,
  `auto_run_enabled`, `drill_executed`, and `drill_result`.
- `mode` is `reminder` by default or `auto_download_only` when
  `PG_BACKUP_RESTORE_DRILL_AUTO=true`.
- A successful report uses `status=ok`; missing remote dumps use
  `status=warn_missing_remote_dump`; configuration, AWS, or auto-drill failures use
  `status=error`.

`pnpm ops:status` and `pnpm ops:status:json` read the latest pointer to track monthly drill
freshness. A missing or malformed pointer is degraded; a stale report, `error` status, or
`warn_missing_remote_dump` status is critical. `pnpm ops:alert:check` consumes the same JSON status,
persists cooldown/recovery state, and sends Telegram only when a configured transition warrants it.
