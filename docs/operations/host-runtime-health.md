# Host and Runtime Health

## Meta

- Audience: production maintainers and operators.
- Authority Level: operations runbook.
- Last Verified Against: 2026-10-01 repository and read-only production inspection.
- Owner: operations maintainers.
- Review Cadence: after Compose, systemd, threshold, or alert-delivery changes.
- Status: `runbook`.

This host-owned check supplements [`postgres-ops-health.md`](postgres-ops-health.md). It uses the
existing single-host Docker Compose and Telegram setup; it does not add an external monitoring
service.

## Signals and boundaries

Every five minutes, `scripts/docker/host-runtime-health-alert.mjs` reports machine-readable status
for:

- **Compose runtime:** PostgreSQL, Redis, backend, frontend, and all three production workers must
  have running containers. Caddy is required when `CADDY_PUBLIC_HOSTNAME` or the `edge` profile is
  configured. The optional Telegram bot is required when the `ops-bot` profile is configured. A
  stopped/missing required container or an unhealthy Docker healthcheck is critical; a healthcheck
  still starting is degraded. Each Docker CLI operation has a 10-second deadline; timeout or
  command failure reports Docker unavailable while the remaining checks continue.
- **Container restarts:** an increased Docker restart count on the same container ID since the last
  successful observation is degraded for 30 minutes by default. Recreated container IDs seed a new
  baseline, so normal deploys do not look like crash loops. The first successful check records the
  baseline and cannot report restarts that happened before it. This is restart-change detection,
  not a crash-loop heuristic.
- **Disk:** the mounted filesystems containing `/opt/esl-pipeline`, Docker's data root, and
  `/var/lib/esl-pipeline/ops` are checked once each. Less than 4 GiB available is degraded; less
  than 2 GiB is critical, reusing the existing deploy script's 2 GiB minimum-free-space guard. Free
  inode space below 10% is degraded and below 5% is critical. Missing or unreadable configured
  paths are reported as filesystem observation errors; the monitor does not substitute a parent
  filesystem.
- **Memory and CPU contention:** `MemAvailable` below 15% is degraded and below 8% is critical.
  Linux PSI over the preceding 60 seconds degrades at 10% memory `some` stalls or 40% CPU `some`
  stalls; memory `full` stalls at 1% or CPU `some` stalls at 70% are critical. PSI measures time
  tasks actually wait under resource pressure; swap occupancy alone is not treated as an incident.
- **Public application route:** bounded GET checks (10 seconds each) request `/` and `/api/health`
  over HTTPS using `CADDY_PUBLIC_HOSTNAME`. Both must return 2xx, and `/api/health` must report
  `ok: true`. This exercises the public Caddy/frontend/backend path from the VPS.

The public-route request runs on the VPS. It cannot detect total host loss, and its timer cannot run
when the host is down. It also cannot cover network failures specific to outside clients. A separate
off-host synthetic monitor would be needed for those cases.

All three workers have Compose restart policies but no Docker healthchecks. Their code logs startup
and worker errors, but exposes no durable worker heartbeat, last-success timestamp, or trustworthy
queue-progress signal. This check confirms that worker containers are running only; it does not
claim they are consuming or completing jobs. Add worker-progress monitoring in a separate pass if a
small, durable signal can be designed around the existing queue contracts.

## Alert and state behavior

The service reads the same `PG_BACKUP_ALERT_TELEGRAM_*` destination settings as PostgreSQL ops
alerts. It keeps its transition state separately at
`/var/lib/esl-pipeline/ops/state/host-runtime-health-alert-state.json` and writes dated logs under
`/var/lib/esl-pipeline/ops/logs/`, pruning its own logs after 30 days by default. Tokens and chat
identifiers stay in the host `.env`; systemd unit files contain no credentials. Thresholds can be
overridden in that host-only `.env`; documented defaults are in [`.env.example`](../../.env.example).

Failure, severity escalation, recovery, and cooldown-repeat alerts follow the PostgreSQL alert
transition rules. Delivery failures leave the transition pending for retry. The service exit status
reflects host/application health, independently of Telegram delivery: an unhealthy observation
exits non-zero even when the alert was sent; a healthy recovery observation exits zero even if its
Telegram notification failed. Inspect the JSON journal line and alert log to separate the two.

The check does not report Lightsail CPU burst balance or host metrics when the VPS is unreachable.
It does not change PostgreSQL schedules or the PostgreSQL alert's health model.

## Repository-owned systemd units

`deploy/systemd/esl-host-runtime-health.service` runs the monitor as a oneshot ordered after
`docker.service` when both units are being started. It does not require or start Docker, allowing it
to report when the Docker daemon is unavailable. The timer checks every five minutes and catches a
missed calendar activation after the host returns. Install/update all repository-owned PostgreSQL
and host/runtime units from the deployed checkout:

```bash
cd /opt/esl-pipeline
sudo bash scripts/deploy/install-postgres-ops-systemd.sh
```

The installer copies changed unit files and runs `systemctl daemon-reload` on every successful
pass. Installation does not enable or start timers. For a separately authorized host/runtime
rollout:

```bash
sudo systemctl enable --now esl-host-runtime-health.timer
sudo systemctl is-enabled esl-host-runtime-health.timer
sudo systemctl is-active esl-host-runtime-health.timer
sudo systemctl list-timers --all esl-host-runtime-health.timer --no-pager
sudo systemctl start esl-host-runtime-health.service
sudo systemctl show esl-host-runtime-health.service \
  -p Result -p ExecMainStatus -p ExecMainExitTimestamp
sudo journalctl -u esl-host-runtime-health.service --since "today" --no-pager
sudo cat /var/lib/esl-pipeline/ops/state/host-runtime-health-alert-state.json
```

The first successful run establishes the restart-count baseline. A healthy run does not send a
Telegram message, so it verifies monitoring and delivery configuration only through logs/state; it
does not act as a Telegram test. Do not create synthetic failures on production to test transitions.
