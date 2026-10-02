# Host and Runtime Health

## Meta

- Audience: production maintainers and operators.
- Authority Level: operations runbook.
- Last Verified Against: 2026-10-02 repository and disposable Redis validation.
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

## Worker readiness and queue observation

Deployment and runtime observation have separate contracts (`SPLIT_READINESS_AND_PROGRESS`,
[ABO-14](https://linear.app/abocha/issue/ABO-14/implement-worker-readiness-and-queue-progress-monitoring-v1)).
Each worker awaits BullMQ `waitUntilReady()` after its existing startup work, with a 30-second
deadline, checks running/unpaused state, and emits JSON `worker_ready` evidence. The record includes
service, actual queue name, hostname, process ID, unique startup ID, and UTC timestamp. Deployment
verification requires records for **all three current instances**, including selective deploys:

| Service                 | Default queue          |
| ----------------------- | ---------------------- |
| `batch-worker`          | `esl-jobs`             |
| `transcribe-worker`     | `transcribe-queue`     |
| `student-memory-worker` | `student-memory-queue` |

The verifier reads each container's actual queue configuration and hostname, rejects records older
than its current Docker start time, and rechecks container start/running state after reading logs.
Its polling deadline is 60 seconds. Readiness proves consumer initialization at that moment; it
makes no claim about future liveness or application-level business success. Log retention must
retain the current boot's readiness record; missing evidence fails deployment verification.

Every host-monitor run also reads Redis consumer names and BullMQ queue state/events through
`scripts/docker/worker-queue-observation.mjs`. It reports:

| Observation                   | Meaning and alert policy                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idle`                        | Connected consumer, no runnable/active work and no newly observed processing event. Healthy regardless of completion age.                                                                     |
| `processing_observed`         | New claim (`active`), `completed`, or `failed` event in a continuous observed stream, or an active job in the current snapshot. The JSON separates event activity from retained active state. |
| `consumer_connection_missing` | No matching BullMQ consumer connection. Critical after ten continuous minutes observed missing, even if idle.                                                                                 |
| `runnable_work_not_claimed`   | Waiting, prioritized, or overdue delayed work without active work or newly observed processing events. Critical after ten minutes without observed claims/attempt outcomes.                   |
| `paused`                      | Queue metadata marks consumption paused. Immediately degraded; JSON still includes connections/backlog, and persistent missing connections can escalate.                                      |
| `observation_unavailable`     | Redis/Docker read failure, unsupported topology, or collector timeout. Immediately degraded; previous history is retained.                                                                    |

Ten minutes allows two five-minute cadence intervals for reconnect/backlog grace. Clocks and grace
are keyed by queue in the existing host state file, independently of worker/container identity and
Telegram delivery. Recreation never reseeds them. Runnable backlog age is retained while active
work exists, but v1 does not alert on backlog waiting behind active work: no legitimate execution-
duration policy exists yet. Reconsider this ceiling when per-worker duration policies are approved.
A reconnect clears missing-connection history; observed backlog clearance clears backlog age.
Confirmed new processing events reset the queue's progress grace. Producer activity, lock renewals,
reconciliation timers, and custom `progress` events do not count. Completion/failure is an attempt
outcome, not proof of business success.

Future delayed jobs are not runnable. Delayed jobs whose encoded due time has passed are runnable,
because absent consumers can prevent promotion. Queue pause and delayed due-time interpretation use
the installed BullMQ 6.3.4 layout. The collector reads at most 1001 new events per queue. Cursor loss,
event-count discontinuity, stream reset, or more than 1000 new events creates a degraded
`observationGap`, never inferred progress; it establishes a new cursor while retaining grace clocks.
The first observation establishes a baseline and does not count historical events as new progress.
Monitor state loss/corruption requires a new baseline; preserve the host state file during rollouts.

The collector constructs no BullMQ `Queue`, `QueueEvents`, or `Worker`. It uses only `CLIENT LIST`
and a fixed Redis [`EVAL_RO`](https://redis.io/docs/latest/commands/eval_ro/) script containing
`TIME`, `EXISTS`, `XINFO STREAM`, `XRANGE`, `LLEN`, `ZCARD`, `ZCOUNT`, and `HEXISTS`. Redis enforces
non-writing script execution. Disposable integration tests run collection with an ACL allowing only
these reads and compare every queue key's serialized value before/after. The same tests show Redis
rejecting writes through `EVAL_RO`. The host uses the Redis service's bundled `redis-cli`; no host
npm dependency install is required. Authentication travels through stdin, never command arguments.
The complete queue collection has a ten-second deadline and bounded output. This supports the
current local Compose Redis on port 6379 and configured queue-name variables; an external Redis
host/port reports unavailable rather than observing a different server.

There is no periodic worker heartbeat, active-job duration alarm, business-result monitor, or new
application milestone instrumentation in v1.

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

For the separately authorized worker-monitoring rollout, deploy the immutable backend release
containing all three readiness records before using the updated verifier. Update the deployed
checkout's monitor scripts and preserve the existing host state directory. Run the normal deploy
verification and the host/runtime oneshot above; inspect `components.workerQueues` and persisted
`queueHistory`. A healthy idle queue requires a consumer connection, not a recent completion.
Use disposable infrastructure for failure/recovery tests, never synthetic production jobs or pauses.
