# Replacement-host recovery

## Meta

- Audience: maintainers and agents rehearsing disaster recovery.
- Authority Level: operations runbook.
- Last Verified Against: 2026-10-02 current production topology; full recovery rehearsal pending.
- Owner: operations maintainers.
- Review Cadence: after durable-state, deployment, bootstrap or migration changes.
- Status: `runbook`.

Execution owner: [GitHub #328 / ESL-15](https://github.com/abocha/esl-pipeline/issues/328).
[ABO-10](https://linear.app/abocha/issue/ABO-10/production-maturity-roadmap-observable-recoverable-replaceable-single)
remains the broader production-maturity roadmap. This procedure models the original host being gone:
only the repository, a pinned application revision, external operator inputs and verified recovery
artifacts remain. It grants no production access.

## Durable-state contract

Inventory derived from `docker-compose.prod.yml`, the host bootstrap, backend storage and worker
entrypoints. A volume's existence alone does not make it a recovery requirement.

| State                                                                                                                         | Classification                                                                              | Recovery requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `postgres18_data`                                                                                                             | **Must restore**                                                                            | Restore a verified logical dump using repository tooling. Users, workspace membership, students/profile revisions, lessons, sessions, recordings/transcripts, prompt packages, drafts and migration ledger are durable product state. Do not transplant PostgreSQL files across versions.                                                                                                                                                                                                  |
| `redis_data`                                                                                                                  | **Must restore when preserving queued/event work**                                          | Production Redis uses AOF, `appendfsync everysec`, and `noeviction`. BullMQ queues/events are durable infrastructure, not just cache. Transcription/upload and some student-memory intent have DB reconciliation; the batch worker has no general DB-to-queue reconstruction. A fresh Redis can serve restored reads but does not prove preservation of all pending work. This rehearsal restores a stopped, quiet AOF archive plus a nonempty marker, then proves healthy idle consumers. |
| `uploads/`, including `drafts/` and recording/transcript/prompt artifacts                                                     | **Must restore for local storage URIs**                                                     | Shared by backend and all workers. Preserve bytes and `1000:1000` ownership before starting writers. Local URI paths and content hashes must agree with the restored DB. Rehearsal restores real repository-written audio, transcript, prompt and draft artifacts and reads audio/draft through authenticated API routes.                                                                                                                                                                  |
| Remote S3 publication/media objects referenced by DB                                                                          | **External durable dependency; must not be copied into rehearsal**                          | Host loss does not erase external objects. Independently validate real bucket/object access in an authorized exercise. Rehearsal uses only local S3 emulation, synthetic credentials and newly created smoke/backup objects.                                                                                                                                                                                                                                                               |
| `tts_cache`, image `/app/tmp`                                                                                                 | **Safe to recreate**                                                                        | Derived provider/runtime cache. Not authoritative student/product state. Regeneration may require provider access and incur cost; no provider regeneration is tested here.                                                                                                                                                                                                                                                                                                                 |
| `/var/lib/esl-pipeline/deploy/current-images.env`                                                                             | **Safe to reconstruct from external pinned revision/digests**                               | The normal deploy recreates this file only after verification. An old state file alone neither restores services nor proves schema compatibility. Do not fabricate prior runtime state to bypass initial-deploy checks.                                                                                                                                                                                                                                                                    |
| Deploy previous/known-good image refs, deployment log, rollback compatibility records and pre-deploy backups                  | **Optional historical/operational state**                                                   | Useful for investigation/rollback decisions. Recalculate compatibility against the recovered DB/image. Preserve any specific recovery backup required across an incompatible schema boundary off-host; it is then a required recovery artifact, not optional history.                                                                                                                                                                                                                      |
| `/var/lib/esl-pipeline/ops/{logs,reports,run,state}`, backup/drill/alert history                                              | **Optional historical/operational state**                                                   | Locks and monitor baselines are safe to recreate. Missing alert/queue history starts a new observation baseline and loses continuity. Reinstall repository units; keep timers inactive until their real destinations and authorization are established. The sole available DB backup must survive outside this lost host.                                                                                                                                                                  |
| Prompt assets, SQL migrations, generated schema, runtime-compatibility metadata                                               | **Safe to reproduce from pinned repository/image**                                          | Restore DB-held template/profile revisions and historical hashes from the dump. Do not blindly overwrite operator-edited revisions with fresh asset bootstrap. The rehearsal bootstraps assets only on its source host.                                                                                                                                                                                                                                                                    |
| Caddyfile and nginx config                                                                                                    | **Safe to reproduce from pinned repository/image**                                          | Preserve browser → Caddy → frontend nginx → backend routing. Supply hostname/email externally.                                                                                                                                                                                                                                                                                                                                                                                             |
| `caddy_data`, `caddy_config`                                                                                                  | **Safe to recreate; optional operational state**                                            | Config is repository-owned; Caddy can reacquire certificates with authorized DNS/ACME connectivity. Certificate/account state is sensitive operational material and is not imported into rehearsal. Rehearsal starts fresh volumes and tests HTTP routing only.                                                                                                                                                                                                                            |
| Host `.env`, `.secrets/google-service-account.json`, AWS/GHCR credentials, JWT keys, provider/bot/mail credentials            | **External operator input; production values must not be copied into rehearsal**            | Securely provision required configuration/identities per the production checklist. Bootstrap creates directory permissions, never these values. Synthetic JWT and local S3 inputs suffice here; provider keys are invalid presence-only placeholders, and application networking has no Internet egress. Optional Google/bot capabilities remain disabled.                                                                                                                                 |
| Backend/frontend/bot images                                                                                                   | **Safe to pull/reproduce from known immutable revision; registry access is external input** | Prefer the published complete GHCR SHA/digest bundle. Rehearsal builds exact production Dockerfiles from a Git archive of the full application SHA, labels that revision, records image IDs, then pushes/pulls through a guest-local registry. Backend/worker code uses one image. Optional Telegram bot is disabled.                                                                                                                                                                      |
| Ubuntu packages, Docker logging, journald retention, systemd units, SSH/firewall policy                                       | **Safe to reproduce plus external operator decisions**                                      | Reuse ESL-14 bootstrap on Ubuntu 24.04. Actual SSH port, UFW policy, public reachability and external firewall remain operator-owned evidence. Bootstrap verification reports unresolved operator checks separately.                                                                                                                                                                                                                                                                       |
| Docker/containerd image/runtime snapshots under `/var/lib/docker` and `/var/lib/containerd` (excluding durable volumes above) | **Safe to recreate**                                                                        | Image layers and writable container runtime layers are reproducible or ephemeral. Restore PostgreSQL/Redis through their classified artifacts and uploads separately. Fresh Ubuntu Docker may use containerd’s image store; both engine roots require suitable storage, but copying their old image/runtime metadata is not recovery.                                                                                                                                                      |
| Development dependency volumes in `docker-compose.yml`                                                                        | **Safe to recreate; outside production topology**                                           | No development dependencies or source mounts are needed for production recovery.                                                                                                                                                                                                                                                                                                                                                                                                           |

A quiet Redis archive and DB/uploads bundle taken with writers stopped is useful consistency
evidence. This does not establish crash-consistent snapshots of a running production system, rescue
of already active provider jobs, or a bounded data-loss/RPO guarantee. Lost Redis delivery requires
an explicit reconciliation decision; do not silently classify it as disposable.

## One disposable command

Requires Git, Bash, Python 3, a Linux local Docker daemon with Buildx, privileged container support,
and a volume backing filesystem that supports the guest Docker image store (normally ext4/XFS),
enough disk for production
image builds and two sequential nested daemons, and Internet access for pinned dependencies.
The clean supported host is a Ubuntu 24.04 Docker guest with a real systemd manager and its own
Docker daemon. It shares the disposable runner's Linux kernel; it is not a VPS or a full VM.
Docker and containerd each receive a fresh disposable data volume. Containerd's image store must
not fall back to the guest root's outer OverlayFS layer. Some Cloud containers themselves store
Docker volumes on OverlayFS; those environments cannot support this normal nested image store
without a suitable backing filesystem. The hosted Ubuntu runner provides that filesystem.

```bash
bash scripts/recovery/run-replacement-host-rehearsal.sh --dry-run
ESL_REHEARSAL_REVISION="$(git rev-parse origin/main)" \
ESL_REHEARSAL_EVIDENCE_DIR=/tmp/esl-recovery-evidence-new \
  bash scripts/recovery/run-replacement-host-rehearsal.sh
node --test scripts/recovery/recovery-preflight.test.mjs
```

The revision must be a locally available full Git SHA; default is the current fetched `origin/main`.
Fetch it first. Application code always comes from `git archive` of that revision; the rehearsal
scripts under review are supplied separately. No ambient checkout `.env`, untracked product data,
credential directory or real backup is read or copied. The evidence directory must be new.
Each guest initializes a root-owned, clean Git snapshot of the archived source and reviewed
rehearsal scripts so normal deployment checkout checks remain effective. Generated Compose and
synthetic `/etc/esl-pipeline/production.env` live outside that snapshot; runtime secret directories
retain the bootstrap's normal ownership and permissions.

No target host, SSH address, Docker endpoint, cloud account, bucket or DNS override is accepted.
The runner forces the local Unix Docker socket and allocates isolated resource names. No Docker
socket is mounted in a guest. Host recovery refuses to run without its disposable-container marker,
root and Docker container identity. All guest ports are isolated from the outer host; production
Compose bindings are replaced only in a generated guest-only overlay. The overlay also disables
Caddy automatic HTTPS globally, including for the fixed marketing hostname, while preserving the
repository routing rules. The API, frontend, workers,
PostgreSQL, Redis and Caddy retain their production images, commands, dependencies and mounts.
A guest-local registry and S3 emulator supply synthetic external dependencies. A guest-only `DOCKER-USER` rule rejects forwarded container traffic through the guest external
interface; IPv6 on the application network is disabled. Normal bridge networking preserves
loopback port publication. No paid providers are called.

Cloud builds mount the public proxy CA as a BuildKit secret and enable Node's environment proxy
support for the entire networked build step. TLS verification remains enabled. The CA/proxy do not
become committed assets or application image layers.

## Recovery order and evidence

1. Build the pinned production backend/frontend images outside the recovery host. Record revision,
   image IDs and build output; transfer them to each guest's disposable registry.
2. Start a pristine Ubuntu guest with no application inputs, uploads, database, image state, Docker,
   Node or AWS CLI. Run `bootstrap-prod-host.sh apply` and `verify`. Exit 2 must report complete
   bootstrap and unresolved operator inputs, never application readiness.
3. On the source only, use production Compose, migrator and prompt bootstrap, invite-only account
   registration and student APIs, and image-packaged domain/storage code to create synthetic
   lesson/session/recording/transcript/prompt/draft lineage. Synthetic calendar grant, connection
   and association rows stand in for OAuth; the real calendar projection creates the lesson from a
   controlled observation, then normal lesson completion and session code applies. Google Calendar
   stays disabled and no provider is contacted. Fresh drafts use a repository AssignmentV1 fixture
   with the matching pinned prompt envelope. The media handoff is an explicit JSON file, validated
   before API reads; `source-media.json` retains only identifiers and hashes. It cannot select an
   application log line as its payload.
4. Stop application writers, create the real four-artifact PostgreSQL backup with
   `postgres-backup-restore.sh backup`, stop Redis and archive its quiet volume, and archive uploads.
   Keep checksums, full application revision and synthetic expected IDs/password in the bundle.
5. Destroy the source guest and its entire Docker/containerd volumes, verify all are absent and record their
   identities in `source-destroyed.json`; failure blocks replacement. Create another pristine Ubuntu host and
   run the same repository host bootstrap. Reconstruct synthetic configuration and local bucket.
6. Check required operator inputs, bundle checksums, required uploads/Redis artifacts and pinned
   revision. Start only PostgreSQL, Redis and the local S3 dependency. Verify and restore the dump
   through `postgres-backup-restore.sh restore --clean`; failure blocks all application startup.
7. Restore uploads and Redis before writers start. Check the marker and image-packaged migration
   verification. The normal deploy's schema-compatibility preflight must reject checksum drift.
8. Run `deploy-prod-images.sh <SHA>` against the guest-local registry: actual pulls, digest state,
   compatibility plan, pre-migration backup/upload, migration, Compose startup, S3 storage smoke,
   backend/frontend health, and all three current-instance worker readiness checks remain intact.
9. Start Caddy with repository routing, automatic HTTPS disabled, and a local HTTP hostname. Verify `/` and
   `/api/health`, then log in with the recovered account and read the original student, lesson,
   assignment session, recording bytes and draft text without recreating them. Query restored DB
   anchor tables and collect the repository runtime queue monitor; all three queues must be idle
   with consumers. Installed backup/monitor units must match the repository and never have run.

The runner retains build/bootstrap/restore/deploy logs, full image metadata/digests, JSON DB/product,
health, readiness and queue evidence, negative-case logs, and `recovery-result.json` at the printed
absolute evidence path. Synthetic credentials/tokens and the backup/media bundle are staging data;
only sanitized verification evidence is retained. It removes its allocated guests, Docker volumes,
application image tags and staging archives on success or failure. Its dedicated native-snapshot
BuildKit builder/cache is removed before starting either guest, so VFS build snapshots do not
compete with recovery storage. Ubuntu Docker selects its normal supported guest storage driver;
the observed driver is retained in evidence. Hosts that only support VFS need substantially more
disk because it duplicates image layers. Downloaded base images can remain in the development
daemon. It never prunes unrelated resources. `cleanup.json` records whether its allocated resources
were removed, and cleanup failure makes the command fail. Failure logs remain available.

Focused hazards: missing external input, missing uploads artifact, corrupt dump restore,
incompatible schema ledger, and a current worker instance without readiness evidence. Preflight
unit tests protect checksums, path confinement and pinned-revision validation. These supplement the
actual service-backed recovery, not replace it.

## Evidence boundary

**Current evidence:** work stopped at the user's request after the final hosted attempt established
source-host bootstrap, healthy dependencies/application, 60 applied migrations, and synthetic
account/student/lesson/session creation. Source verification then failed because the media handoff
lacked `recordingId`. No database backup or replacement recovery completed, and there is no
successful `recovery-result.json`. See the
[2026-10-02 evidence and failure report](replacement-host-recovery-evidence-2026-10-02.md) for
the observed results, earlier network/storage failures, CI status, and remaining work. This runbook
describes the implemented procedure and acceptance criteria, not end-to-end recovery success.

The [hosted rehearsal workflow](../../.github/workflows/replacement-host-rehearsal.yml) executes the
same command on disposable Ubuntu 24.04 compute for relevant pull requests and manual dispatches.
It has read-only repository access, no production environment or credentials, and retains
`replacement-host-recovery-evidence` for 14 days even on failure. Pull requests recover the pinned
base revision; manual runs accept a full SHA or default to `origin/main`.
The public repository's standard GitHub-hosted Ubuntu runner supplies disposable compute without
requiring a new Google Cloud allocation. If that runner is unavailable or unsuitable, the recorded
Compute Engine alternative on ESL-15 still requires current cost/credit verification, an authorized
budget, automatic VM/disk deletion and exported evidence before allocation.

**Proven by disposable rehearsal, only after a successful run:** repository bootstrap plus synthetic durable-state restore and
pinned application pull/deployment can reconstruct the current production-shaped topology, with
persisted authenticated reads, restored host media, migration compatibility, worker readiness,
healthy idle queues and inactive installed operations units.

**Still requires separately authorized real replacement-host evidence:** retrieving and restoring
an actual production backup, complete production local/remote durable-artifact coverage and
consistency, real Redis pending/in-flight work recovery, compatible production revision/digest
availability, real operator credentials/IAM/KMS/providers, supported VPS/kernel/storage behavior,
SSH/UFW/external firewall access, DNS/ACME/public TLS, off-host reachability, measured RTO/RPO and
safe timer/alert activation. Synthetic success does not establish replaceable-host posture or prove
real production recovery. Do not close ABO-10 on this evidence.

Related: [deployment](../backend-frontend/DEPLOYMENT.md),
[PostgreSQL backup/restore](postgres-backup-restore.md),
[remote backup operations](postgres-backup-s3.md), [runtime monitoring](host-runtime-health.md).
