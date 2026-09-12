# PostgreSQL Ops Health

## Meta

- Audience: maintainers and operators of PostgreSQL backup automation.
- Authority Level: operations runbook.
- Last Verified Against: 2026-09-13 repo state.
- Owner: ops maintainer + automation agents.
- Review Cadence: monthly or after backup, restore-drill, or alerting changes.
- Status: `runbook`.

This runbook defines the health signals above the PostgreSQL backup path. Backup freshness, remote
artifact integrity, and disposable restore evidence are separate guarantees. IAM access-key age is
not an application health invariant and is not queried by this subsystem.

## Sources of Truth

- Status: `scripts/docker/postgres-ops-status.sh`
- Transition alerts: `scripts/docker/run-postgres-ops-alert.sh`
- Artifact integrity: `scripts/docker/run-postgres-artifact-integrity-check.sh`
- Disposable restore: `scripts/docker/run-postgres-restore-drill.sh`
- S3 and local backup behavior: `scripts/docker/postgres-backup-s3.sh` and
  `scripts/docker/postgres-backup-restore.sh`
- Command wiring: [`package.json`](../../package.json)
- Environment policy: [`docs/reference/env.md`](../reference/env.md)

## Ownership Boundary

Backup, AWS, Docker, report, and restore-drill commands run on the host. The long-running backend
container does not own the Docker socket, AWS CLI, or host operations state. Do not place `/app/...`
paths in host backup configuration.

All mutable host operations state derives from `PG_BACKUP_HOST_STATE_DIR`. The generic local default
is `${XDG_STATE_HOME:-$HOME/.local/state}/esl-pipeline/ops`. Production must use:

```bash
PG_BACKUP_HOST_STATE_DIR=/var/lib/esl-pipeline/ops
```

Create that directory during host provisioning and grant the production operator account read/write
access. The production S3 wrapper defaults to this location. `PG_BACKUP_DIR`, `PG_BACKUP_LOG_DIR`, and
`PG_BACKUP_ALERT_STATE_FILE` remain optional host-path overrides for their narrower existing uses.

The resulting layout is:

```text
/var/lib/esl-pipeline/ops/
├── backups/postgres/
├── logs/
├── reports/
│   ├── artifact-integrity-report-latest.json
│   └── restore-drill-report-latest.json
├── run/
└── state/postgres-ops-alert-state.json
```

## Commands

```bash
pnpm docker:db:artifact-integrity -- [dump-key-or-s3-uri]
pnpm docker:db:restore-drill -- [dump-key-or-s3-uri]
pnpm docker:prod:db:artifact-integrity -- [dump-key-or-s3-uri]
pnpm docker:prod:db:restore-drill -- [dump-key-or-s3-uri]
pnpm ops:status
pnpm ops:status:json
pnpm ops:alert:check
```

Omitting the dump key selects the latest `.dump` under the configured
`<prefix>/<environment>/<database>/` namespace. Empty or mistargeted prefixes return a normal
`no_remote_dump_found` result; they do not fail inside the AWS CLI `sort_by` query.

## Health Model

`ops:status` reports:

- `backup`: newest S3 `.dump` age; default maximum
  `PG_BACKUP_HEALTH_MAX_BACKUP_AGE_HOURS=26`.
- `artifactIntegrity`: freshness and success of an actual remote `.dump` + matching `.sha256`
  download; default maximum `PG_BACKUP_HEALTH_MAX_INTEGRITY_AGE_DAYS=8`.
- `restoreDrill`: freshness and success of an isolated restore, schema/read probes, and disposable
  cleanup; default maximum `PG_BACKUP_HEALTH_MAX_DRILL_AGE_DAYS=35`.

An empty S3 namespace, a stale report, a failed checksum, a failed restore/read probe, or incomplete
disposable cleanup is critical. Missing configuration or a missing/malformed report is degraded.
`ops:alert:check` aggregates only these three states and retains the existing Telegram transition,
escalation, recovery, cooldown, and non-zero-exit behavior.

## What the Evidence Proves

The artifact integrity check proves that the selected remote dump and checksum are downloadable and
that the dump bytes match the recorded SHA-256 value. It does not prove restoreability.

The restore drill first performs that integrity check, then:

1. creates unique Docker container and volume names;
2. starts `postgres:18.6-alpine3.24` with no published ports and `--network none`;
3. restores with `pg_restore --exit-on-error --no-owner --no-privileges`;
4. verifies PostgreSQL `18.6`, public-table and migration counts, and count-only reads from `users`,
   `jobs`, and `transcripts`;
5. writes structured JSON evidence; and
6. forcibly removes the disposable container and volume on success or failure.

The image and expected server version are selectable with `PG_BACKUP_RESTORE_DRILL_IMAGE` and
`PG_BACKUP_RESTORE_DRILL_EXPECTED_VERSION`. Production should retain the production minor/version
pair unless a reviewed PostgreSQL rollout changes it. The script never references the Compose
project's `postgres18_data` volume.

Reports contain object keys, version/verification metadata, count-only probes, and cleanup status.
They do not contain table rows, credentials, URLs with credentials, or application payloads.

## Recommended Production Cadence

- Daily: `scripts/docker/run-postgres-backup-s3.sh`
- Every 6 hours: `pnpm ops:alert:check`
- Weekly in production: `pnpm docker:prod:db:artifact-integrity`
- Monthly in production: `pnpm docker:prod:db:restore-drill`

Use a host service account that can write `PG_BACKUP_HOST_STATE_DIR`, talk to Docker, and read the
configured S3/KMS objects. A real production artifact/drill run is an operator action and is not
performed by repository validation or the backend container.

## PostgreSQL Utilization Diagnostics

Compose-managed PostgreSQL runs with `pg_stat_statements` preloaded, `track_io_timing=on`,
`log_lock_waits=on`, and `idle_in_transaction_session_timeout=60s`.

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

If `pg_stat_user_tables.n_live_tup` looks wrong after a restore or import, run `ANALYZE;` before
using table statistics for sizing or query-plan decisions.
