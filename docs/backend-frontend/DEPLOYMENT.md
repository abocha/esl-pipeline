# Batch Backend Deployment Guide (Current)

## Meta

- Audience: maintainers/operators deploying batch services.
- Read Time: 12 minutes.
- Authority Level: Deployment runbook.
- Last Verified Against: 2026-10-02 repo and disposable Ubuntu host bootstrap.
- Owner: backend/frontend maintainers + automation agents.
- Review Cadence: monthly or after deployment workflow changes.
- Status: `runbook`.

## Purpose

- Provide a practical deployment path for the batch stack.
- Route operators to canonical operations runbooks.

## Canonical Sources

1. [`docs/reference/env.md`](../reference/env.md)
2. [`docs/backend-frontend/batch-backend-ssot.md`](batch-backend-ssot.md)
3. [`docs/operations/docker-host-paths.md`](../operations/docker-host-paths.md)
4. [`docs/operations/postgres-backup-s3.md`](../operations/postgres-backup-s3.md)

## Baseline Requirements

- Node `24.15.0+`
- Docker + Docker Compose
- Postgres 18+
- Redis 8.10.1
- ffmpeg available in backend runtime

## Fresh Ubuntu Production Host Bootstrap

GitHub [#326 / ESL-14](https://github.com/abocha/esl-pipeline/issues/326) owns this v1 execution
slice of [ABO-10](https://linear.app/abocha/issue/ABO-10). It prepares the current single-host
Compose baseline. [GitHub #328 / ESL-15](https://github.com/abocha/esl-pipeline/issues/328) owns the
[disposable replacement-host recovery rehearsal](../operations/replacement-host-recovery.md),
including its durable-state inventory and synthetic recovery evidence boundary.
Bootstrap completion does **not** mean a working production database or permission to receive traffic.

### Prerequisites and command

Use Ubuntu **24.04 LTS**, amd64 or arm64, with a running systemd manager, root/sudo access,
working apt repositories (including `universe`), outbound HTTPS, and sufficient disk space. The
existing deploy guard requires at least 2 GiB free on both checkout and Docker filesystems; capacity
planning for real data remains operator-owned. First establish and test key-based SSH access and
record its actual TCP port. Bootstrap does not change SSH authentication or listen configuration.
Obtain a reviewed repository checkout at `/opt/esl-pipeline` using operator-provisioned GitHub access.
Install `git` with apt if needed. The checkout directory must belong to root; do not repurpose an
unknown existing directory or recursively change ownership of an existing deployment.

Run against that checkout (absolute paths also work from an unprivileged sudo account), replacing `<SSH-port>` with the actual approved numeric port:

```bash
sudo bash /opt/esl-pipeline/scripts/deploy/bootstrap-prod-host.sh apply <SSH-port>
sudo bash /opt/esl-pipeline/scripts/deploy/bootstrap-prod-host.sh verify <SSH-port>
```

`apply` ends with the same read-only JSON verification as `verify`. Exit **0** means bootstrap
invariants and the limited external-file/firewall checks pass; **2** means bootstrap is complete but
operator inputs remain; **1** means a failed host invariant or unsafe/unsupported state. Inspect
`bootstrapComplete`, `externalInputsPresent`, and each check's requirement. Missing `production.env` and an
unconfigured firewall on a fresh host are expected exit-2 results, never fabricated configuration.
`productionReadiness` always says `not-assessed`; even exit 0 does not validate secret values,
provider/IAM access, DNS, a database, backups, or application health. No image-state file is invented.

### Repository-controlled state and safe reruns

The shell path uses apt and the existing systemd installer, with no provisioning framework:

- Installs Ubuntu `docker.io` and `docker-compose-v2`, plus CA certificates, curl, git, jq,
  xz-utils, unzip, GnuPG, UFW, OpenSSH server, and logrotate. It enables/starts the local Docker
  daemon. Other Docker distributions are verification failures requiring explicit reconciliation;
  bootstrap never removes conflicting packages or changes a remote Docker daemon.
- Installs Node from the exact `.nvmrc` version when absent, checking its upstream SHA-256 archive
  checksum. An existing Node 24.15+ on the Node 24 line is accepted. Node lives under
  `/opt/esl-pipeline-host`, linked as `/usr/local/bin/node`. Host operations use standalone Bash/Node
  scripts; no host application dependency or pnpm installation is needed for bootstrap/deployment.
- Installs AWS CLI v2 when absent, verifying the upstream archive signature with
  [`aws-cli-signing-key.asc`](../../deploy/host/aws-cli-signing-key.asc), obtained from
  [AWS's installation documentation](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html).
  Existing v2 installations are retained. No AWS command contacts account resources during bootstrap.
- Creates root:root `0750` checkout, `/var/lib/esl-pipeline`, `deploy/`, and `ops/` directories,
  including `ops/backups/postgres/remote-restore`, `logs`, `reports`, `run`, and `state`.
  These are the existing deploy and backup/monitoring contracts, not alternate state locations.
- Creates `uploads/` and `uploads/drafts/` as `1000:1000`, mode `0750`, for the backend image's
  `node` user. Creates `.secrets/` as `root:1000`, mode `0750`, so that runtime can traverse its
  read-only mount. Only the Google credential belongs there; operator env snapshots are never mounted. Root owns tracked checkout files and Git metadata without group/other write permission.
  Root runs deployment and the existing systemd jobs; no host Docker-group user
  is created (Docker access would grant root-equivalent privileges).
- Sets Docker daemon defaults to `json-file`, `max-size=10m`, `max-file=5`, preserving unrelated
  daemon settings. Malformed/conflicting configuration fails. If changing settings requires restarting
  an already active daemon, bootstrap fails for explicit operator reconciliation rather than restarting
  workloads. Existing containers retain their original logging configuration until a reviewed
  recreation; this path establishes defaults for future containers.
- Writes `/etc/systemd/journald.conf.d/esl-pipeline.conf` with persistent storage, `256M` maximum
  usage and one-month retention, restarting/flushing journald only when that file changes. Existing
  backup and monitoring scripts retain/prune their own dated logs under `ops/logs`; logrotate remains
  available for Ubuntu's host logs. No new wildcard rotation/deletion of application state is added.
- Calls `install-postgres-ops-systemd.sh` for all ten existing service/timer files and enables the
  five timers: backup, integrity, restore drill, PostgreSQL alerts, and host/runtime health.
  **It does not start those timers or any operations service.** Separately authorized deployment
  activates them as described in the owning health runbooks. Enabled timers can run on the next
  boot; keep real external inputs absent until deployment/recovery is authorized. Already active
  timers are left running on a matching deployed host.

Rerun the same reviewed checkout and command to converge. Matching packages/configuration/units are
retained, directory metadata is repaired only on the named known directories, and systemd reload is
retried through the existing installer. Existing files, secret values, uploads, databases, images,
users, and unknown packages are never deleted. Symlinks and mismatched directory ownership fail for
operator inspection; child files are never recursively chowned. Partial unsupported installations
also fail explicitly rather than being guessed away.

### External inputs and verification-only assumptions

Provision `/etc/esl-pipeline/production.env` securely as a nonempty **root:root `0600`** file, outside Git.
Do not copy `.env.example` unchanged onto a production host. Use it as a variable catalog alongside
[`production-env-checklist.md`](../operations/production-env-checklist.md) and
[`env.md`](../reference/env.md); supply actual operator-controlled values through a secure channel.
The existing host wrappers **source `production.env` as shell code**: only trusted operators may write it,
and assignments must also be valid for Compose. Bootstrap never sources or prints it.

Set the existing host contract `PG_BACKUP_HOST_STATE_DIR=/var/lib/esl-pipeline/ops` and production
backup namespace/Compose targeting per [`postgres-ops-health.md`](../operations/postgres-ops-health.md).
Provide backup S3 region/bucket/prefix, the selected encryption/KMS settings, and Telegram alert
settings (enabled for production). AWS authentication must be available to root's noninteractive
systemd context through the approved environment/profile/role mechanism. For file-backed profiles,
protect `/root/.aws` as root:root `0700` and its credential/config files as `0600`; bootstrap creates
no AWS credentials and does not test them remotely. GHCR access, if required, is also provisioned
for the root deployment context. No secret belongs in systemd unit files or generated deploy state.

If Google STT/TTS service-account auth is enabled, securely provide
`/opt/esl-pipeline/.secrets/google-service-account.json` as **root:1000 `0640`**; the Compose path
is `/app/secrets/google-service-account.json`. Absence is an explicit provider-dependent operator
requirement, not a fabricated empty JSON file. Verification checks permissions of any present file;
the existing environment/provider validation remains required before deployment.

The documented network baseline allows only the approved SSH TCP port and HTTP/HTTPS TCP 80/443.
The repo does not specify SSH source networks or a safe replacement for arbitrary host firewall
policy. Bootstrap therefore installs UFW but **never edits, resets, or enables firewall policy**.
An operator must test SSH access, configure UFW default deny incoming/allow outgoing with routed
traffic denied (UFW reports `deny` or `disabled`) and no forwarding allow rules, and allow the approved
SSH TCP port and TCP 80/443 (optionally source-restricted).
Preflight fails if UFW is inactive or has additional inbound allows/unsupported rule shapes; reconcile
custom policy explicitly. Check IPv4 and IPv6 and keep a recovery console available when changing
firewall policy. Provider firewalls, DNS, and cloud resources are outside this command.

Docker published ports can bypass UFW. Preserve the production Compose loopback bindings for
PostgreSQL, Redis, backend, and frontend; only Caddy publishes public TCP 80/443. Validate the
production environment and Compose configuration before deployment, including no frontend bind
address override. Bootstrap does not deploy Caddy or prove external port reachability.

### Disposable rehearsal

On a development/Cloud Linux environment with a local Docker daemon and privileged container support:

```bash
ESL_BOOTSTRAP_EVIDENCE_DIR=/tmp/esl-bootstrap-evidence \
  bash scripts/deploy/test-bootstrap-prod-host.sh
node --test scripts/deploy/verify-prod-host.test.mjs
```

The rehearsal builds a fresh Ubuntu 24.04 systemd baseline, then exercises actual package/CLI
installation, first apply, second apply, directory/runtime permissions, installed units and inactive
enabled timers, effective Docker log defaults, missing inputs, malformed/unsupported state, and
existing Compose/deploy entrypoints. It uses no production access or credentials and removes its
own container/image on exit; evidence can be retained outside the checkout. The ESL-53 fixture also
reconciles synthetic config/key ownership, rejects mounted env backups and alternate env paths,
starts a real UID-1000 container with the protected env and read-only Google mount, verifies removal
of the old env path, and restores the config snapshot. Nested probes have stdin disabled and a final
completion marker prevents a prematurely consumed script from reporting success. Docker data gets tmpfs
backing in the disposable container so nested overlay snapshotting does not depend on Cloud's outer
filesystem. No production application is started. The UFW check runs in the disposable network
namespace; if the Cloud kernel cannot execute its IPv6/netfilter operations, the runner retains that
failure as an explicit environment limitation, while the focused policy tests validate safe/unsafe
IPv4/IPv6 status parsing. This cannot prove VPS SSH reachability or an external/provider firewall;
those remain operator evidence, not waived preflight checks.

### Handoff to separately authorized deployment/recovery

After bootstrap, resolve external checks, validate the production environment and optional edge
configuration through the existing procedures, and obtain separate deployment/recovery authorization.
Use `sudo bash /opt/esl-pipeline/scripts/deploy/deploy-prod-images.sh <40-char-git-sha>` with the existing immutable
release bundle and root-owned state directory. The current deploy script requires a healthy existing
PostgreSQL/schema baseline even on its initial image-state path; **bootstrap does not create that
database or make that command sufficient for a fresh installation**. Initial database establishment
or deliberate verified recovery, Docker volumes/data, and subsequent application deployment remain
operator-controlled work. The [disposable recovery path](../operations/replacement-host-recovery.md)
composes bootstrap, verified restore and pinned deployment with synthetic state; #326 does not claim
completed disaster recovery, and synthetic success does not prove production recovery. Activate the ops timers only as part of
that separately authorized rollout and retain the runbooks' runtime/backup verification requirements.

## Operating Model

The intended workflow is:

```text
local development -> PR CI validation -> merge -> release bot image publish -> reviewed deployment -> VPS runtime and smoke checks
```

Use the developer laptop for normal development: code edits, dependency installs, dev servers, hot
reload, debugging, lint/type/test lanes, integration tests, migration tests, and local or synthetic
data. The local Compose stack should reproduce production services where practical while keeping
development affordances such as source mounts, exposed loopback ports, debug logging, and fast
resets.

Use GitHub Actions as the clean validation authority on pull requests: install dependencies from
scratch, lint, type-check, validate docs and contracts, run automated tests, and test database
migrations. The blocking CI lanes are listed below in [CI Expectations](#ci-expectations). After a
PR merges, the release bot commits the version bump, pushes a `vX.Y.Z` tag, and then publishes a
complete production image bundle from that bot-authored release commit. Changed images are built;
unchanged image manifests are retagged server-side in GHCR. Every bundle still has all three images
under the release commit SHA and release tag, and deployments use explicit SHA-tagged refs, not
mutable tags such as `latest`.

Use the AWS Lightsail VPS as production runtime, not as the normal coding machine. SSH is for
deployment, container/service status, logs, CPU/RAM/disk checks, reviewed migrations, backup/restore
operations, production-only diagnosis, and emergency recovery. Avoid routine server-side code
editing, full test suites, hot-reload servers, repeated Docker builds, experiments against the
production database, uncommitted server checkout changes, and manual edits inside running
containers.

Production Compose is pull-based for app services. Backend, frontend, worker, transcribe-worker,
student-memory-worker, and optional Telegram bot images come from GHCR image refs supplied by
environment/state files. Do not use the VPS for routine image builds, and do not restore production
`build:`, `:local`, `pull_policy: never`, or `up --build` paths for app services.

The generic `batch-worker` mounts the Docker named volume `tts_cache` at `/app/tmp/tts-cache`, so
ordinary container recreation and deployment retain reusable speech artifacts. This cache remains
disposable, age/size governed, separate from `uploads/`, and outside backup-critical data; see
[`docs/operations/docker-host-paths.md`](../operations/docker-host-paths.md) for its ownership and
maintenance contract.

## Local Development Stack (Compose)

Prepare and start:

```bash
pnpm docker:prepare
pnpm docker:up
```

Build + start:

```bash
pnpm docker:up:build
```

Stop:

```bash
pnpm docker:dev:down
```

If backend host port `8080` is occupied:

```bash
BATCH_BACKEND_HOST_PORT=8081 pnpm docker:up
```

Troubleshooting guide:
[`docs/operations/docker-host-paths.md`](../operations/docker-host-paths.md)

The dev stack bind-mounts the active checkout for live editing and keeps Docker dependencies in
named volumes separate from host `node_modules`.

## Production Compose Image Inputs

Production Compose requires SHA-tagged app image refs. The manual deployment script writes these to
`/var/lib/esl-pipeline/deploy/current-images.env`; ad hoc Compose commands may export them directly:

```bash
export BATCH_BACKEND_IMAGE=ghcr.io/abocha/esl-pipeline/batch-backend:<40-char-git-sha>
export BATCH_FRONTEND_IMAGE=ghcr.io/abocha/esl-pipeline/batch-frontend:<40-char-git-sha>

# Required only when the ops-bot profile is intentionally enabled.
export TELEGRAM_OPS_BOT_IMAGE=ghcr.io/abocha/esl-pipeline/telegram-ops-bot:<40-char-git-sha>
```

Validate production Compose with placeholder image refs:

```bash
pnpm docker:prod:config
pnpm docker:prod:edge:config
pnpm docker:prod:ops-bot:config
```

The production frontend host binding is private by default:
`${BATCH_FRONTEND_BIND_ADDR:-127.0.0.1}:${BATCH_FRONTEND_HOST_PORT:-5173}:8080`.
Set `BATCH_FRONTEND_BIND_ADDR=0.0.0.0` only for explicit private founder rehearsal over plain HTTP.
Do not use that override for real tutor signup/login or lesson data.

Production app images are not built by these commands. For local production-image validation, build
or pull explicit image refs first, export the image variables above, then run `pnpm docker:prod` or
`pnpm docker:prod:edge`.

### Production image bases

The backend, frontend builder, and Telegram bot Node stages use `node:24-trixie-slim`. Build and
runtime stages stay on the same Debian/glibc family so native dependencies are never compiled
against musl and run against glibc. The frontend runtime remains rootless nginx on the controlled
Alpine-slim line; Caddy, PostgreSQL, and Redis remain on controlled official Alpine variants. See
the three production Dockerfiles and [`docker-compose.prod.yml`](../../docker-compose.prod.yml) for
the current lines.

The frontend runtime is pinned to `nginx:1.31.8-alpine3.24-slim`; the edge uses
`caddy:2.11.7-alpine`. These patch versions include the upstream Nginx fixes through 1.31.7
and Caddy's 2.11.6 security fixes plus 2.11.7 proxy regression fixes. See the
[Nginx advisories](https://nginx.org/en/security_advisories.html) and
[Caddy release notes](https://github.com/caddyserver/caddy/releases/tag/v2.11.7).
The current Nginx configuration terminates no TLS/HTTP/3 and enables no AIO, alias, slice or SSI;
version-based CVE matches alone do not establish exploitability. Keep patch selection current
without treating this dated selection as a permanent security guarantee.

Residual upstream limitation verified on 2026-10-22: the official Caddy 2.11.7 image contains
Go 1.26.8 and `golang.org/x/net` 0.59.0. Its refreshed Alpine CA bundle addresses the eMudhra
trust-store issue, but does not replace its compiled HTTP/2 implementation. October Go HTTP/2
fixes require Go 1.26.9+ and the corresponding fixed `x/net` release; for example,
[CVE-2026-78669](https://pkg.go.dev/vuln/GO-2026-6611). This upgrade does not claim to fix that
remaining dependency gap.

The public Caddy servers temporarily allow only `h1` (HTTP/1.1 over HTTPS), disabling HTTP/2,
cleartext HTTP/2 and HTTP/3 while retaining certificates, redirects, compression and proxy routes.
This mitigates the reachable HTTP/2 paths without changing the compiled binary. Browser SSE
connections now share HTTP/1.1 connection limits across tabs; keep concurrent streaming tabs modest.
Before rollout, validate all transition modes and exercise TLS ALPN, upload, SSE and MCP-style POST
traffic locally. After rollout, confirm both public hosts negotiate `http/1.1` when offered
`h2,http/1.1`, and recheck public routes and worker readiness.

Restore HTTP/2 only after inspecting the official image digest and actual `caddy build-info`:
the embedded Go toolchain and `golang.org/x/net` must address the relevant advisories at that time.
The known CVE-2026-78669 floors are Go 1.26.9 and `x/net` 0.60.0, but these are not a substitute for
checking newer advisories and actual binary vulnerability evidence. Refreshing Alpine packages or
changing the Caddy version string alone is insufficient. Remove the `servers { protocols h1 }`
restriction through a reviewed PR and the normal release/deployment flow, then verify ALPN and
upload/SSE/MCP compatibility. Until then, retain HTTP/1.1-only operation; a custom edge image needs
its own reviewed design. Roll back this mitigation by reverting its Caddyfile change and deploying
through the same guarded flow. The normal planner should recreate only the edge when image and
application configuration digests match; review the actual plan before apply.
The edge recreation command uses `--no-deps`: Compose must not follow the frontend/backend
dependency graph when new release-SHA aliases point to unchanged images. Planned application
recreation and initial startup remain owned by their existing deployment steps.

**Refreshing the Caddy image.**

Caddy is an upstream image outside the three SHA-tagged application images. Before deploying a
release that upgrades its reference, record the running edge image ID and repository digest in
protected operator evidence, retain that image locally, and explicitly acquire the reviewed image:

```bash
docker inspect --format '{{.Image}}' esl-pipeline-prod-caddy-edge-1
docker image inspect caddy:2.11-alpine --format '{{json .RepoDigests}}'
docker pull caddy:2.11.7-alpine
docker run --rm --network none caddy:2.11.7-alpine caddy version
```

The old floating tag above describes the pre-upgrade baseline; on later upgrades inspect the
actual running image reference. Never infer freshness from that tag or its build date. The exact
new patch reference prevents reusing the old 2.11.4 image behind `caddy:2.11-alpine`. Follow the
normal deployment plan/apply flow below: the Compose change selects runtime/edge recreation.
Afterward verify `nginx -v` in the published frontend container and `caddy version` in the edge,
then check HTTPS landing/app, SPA/assets, API health and OAuth/MCP discovery/auth routing.

`previous-images.env` records application images, not the old Caddy image. For edge rollback,
use the recorded old repository digest in a protected Compose override for `caddy-edge`, with
the intended checkout, production environment and application image state, and recreate only
that service with `--no-deps --no-build --force-recreate`. Recheck routes and the deployed
Caddyfile. Preserve Caddy data/config volumes and previous application images; do not prune them
until verification is complete. Application rollback still follows the compatibility-gated
procedure below; do not patch a running container or rebuild production images on the VPS.

All three production builders copy `pnpm-workspace.yaml`, root `package.json`, `pnpm-lock.yaml`,
`tsconfig.base.json`, and the `packages` tree filtered by `.dockerignore`. The root files own pnpm
resolution/install policy and shared TypeScript compilation; filtered workspace builds select each
target and its dependencies. `.env.example` is repository-policy validation input, excluded from
the Docker context and no longer copied by the orchestrator postbuild step.

Backend and Telegram runtime stages copy their `pnpm deploy --prod` output. The backend deployment
includes `dist`, `migrations`, and `schema.sql`, with prompt assets copied separately to
`/app/packages/batch-backend/prompt-assets`. Frontend runtime copies the built `dist` tree plus
`nginx-rootless.conf` and `nginx.conf`. The broad package-tree copy is intentional; production-image
scope follows semantic workspace dependencies rather than every file in that build context.
`scripts/release/production-image-scope.mjs` unions changed-package transitive dependents into the
backend, frontend and Telegram targets. Each package's Dockerfile and runtime assets select its
own image through that same ownership. `.dockerignore` and the four shared root inputs above select
all three images. `.env.example`, `.nvmrc`, Compose, docs and known repository/release tooling select
no images: deployment importance does not imply image build ownership. Named release/host utilities
are explicit non-image inputs; arbitrary new scripts are not exempt. Unknown paths or incomplete,
malformed changed-file/workspace metadata fail closed to all images. The release summary retains
every contributing reason, including mixed package/shared/unknown impacts. Unaffected images still
reuse/retag the previous version.

Changed-image release builds use `pull: true`, commit-pinned Docker actions, persistent per-image GHA
build caches, and controlled major/minor plus distribution tags. GHA cache export is best-effort
because it is only a build acceleration; image pushes and unchanged-image reuse remain fatal.
Infrastructure-only releases reuse the prior image manifests without downloading and re-uploading
their layers. Do not build production images on the Lightsail VPS, introduce a second worker image,
or change the PostgreSQL base family without a separate data/collation migration design.

## Production HTTPS Edge Profile

For the Ubuntu 24.04 VPS closed-alpha path, use the optional Caddy edge profile after DNS can point
to the host:

```bash
# Export these in the same shell where you run local edge validation commands; Compose reads
# `/etc/esl-pipeline/production.env`, but the Node validator invoked by the pnpm scripts reads the current process environment.
export CADDY_PUBLIC_HOSTNAME=alpha.example.com
export CADDY_ACME_EMAIL=ops@example.com
pnpm docker:prod:edge:config
pnpm docker:caddy:validate
pnpm docker:prod:edge
pnpm docker:prod:ps
```

TODO for the next deployment tooling rollout: remove this validator/export mismatch by making the
edge validation commands load the canonical production `/etc/esl-pipeline/production.env` with the same precedence as
`scripts/deploy/deploy-prod-images.sh`, or by adding a wrapper that does so. Until then, export
`CADDY_PUBLIC_HOSTNAME` and `CADDY_ACME_EMAIL` in the shell before running `pnpm docker:prod:edge:*`
or `pnpm docker:caddy:validate`.

In edge mode, Caddy is the only intended public entrypoint on ports `80` and `443`. It reverse
proxies to `batch-frontend:8080`; the frontend nginx config keeps same-origin `/api/*` traffic routed
to `batch-backend:8080`. Do not expose or proxy the backend directly for the normal alpha path.
Default production Compose also starts the generic `batch-worker`, the dedicated
`transcribe-worker`, and the dedicated `student-memory-worker`. The transcribe worker is required for
recording uploads to leave the `transcribe_queue_waiting` state. The student-memory worker is
required for queued lesson-memory, homework-memory, and student-memory snapshot jobs to become ready
after normal tutor activity.

Backend-image services that may touch Google STT/TTS mount the server-local `.secrets` directory
read-only at `/app/secrets`. Keep the real service-account file on the VPS at
`/opt/esl-pipeline/.secrets/google-service-account.json`; production containers use
`GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/google-service-account.json`. Do not commit `.secrets`
or replace it from git during deploys.

### Frontend response delivery

Caddy negotiates `zstd` or gzip for compressible public responses. Frontend nginx owns cache
semantics: Vite's content-hashed `/assets/*` files use
`Cache-Control: public, max-age=31536000, immutable`, while `index.html` uses `Cache-Control:
no-cache` so each release can point browsers at new asset hashes. Missing `/assets/*` paths return
404 rather than the SPA fallback.

After deployment, copy the current entry JavaScript path from the served `index.html`, then verify
the bounded response contract:

```bash
curl -fsSI https://<public-hostname>/index.html | grep -i '^cache-control: no-cache'
curl -fsSI https://<public-hostname>/assets/<current-entry>.js \
  | grep -i '^cache-control: public, max-age=31536000, immutable'
curl -fsS -D - -o /dev/null -H 'Accept-Encoding: gzip' \
  https://<public-hostname>/assets/<current-entry>.js \
  | grep -iE '^(content-encoding: gzip|vary: Accept-Encoding)'
```

After DNS points to the VPS, verify:

```bash
curl -I http://<public-hostname>
curl -fsS https://<public-hostname>/
curl -fsS https://<public-hostname>/api/health
curl -fsS https://<public-hostname>/api/meta/version
```

The HTTP check should show Caddy redirecting to HTTPS.
Before real tutor access, set `REFRESH_COOKIE_SECURE=true` and confirm backend, frontend raw host
port, Postgres, Redis, and worker ports are not publicly reachable.

## Production Deployment Flow

A reviewed production deployment should broadly follow:

1. PR CI passes before merge.
2. After a deployable merge (`release:patch`, `release:minor`, or `release:major`), `Release On
Merge` revalidates the release decision, creates the release commit and `vX.Y.Z` tag, then
   publishes a complete backend, frontend, and Telegram bot bundle to GHCR with the release commit
   SHA tag and the `vX.Y.Z` tag. It rebuilds only affected images and server-side retags unchanged
   manifests from the previous version. A validated maintenance-only `release:none` merge creates no
   release or images and therefore has nothing to deploy.
   `packages/batch-backend/prompt-assets/**` is backend runtime content and never qualifies for
   `release:none`.

   Use the successful publication run's **Published release images** summary for the release SHA
   and three SHA-tagged image references. The workflow event's PR head SHA is not the release SHA.
   For older runs without this summary, use the publication job's checked-out release commit.
   The deploy script resolves the requested image digests through its existing preflight.

   If Git history was rewritten after publication, the new tag target may have no published images.
   Use the original publication evidence and rewrite mapping to identify the original published SHA;
   a matching source tree alone does not establish image availability. Do not automatically rebuild,
   retag, or repair historical releases. Such repairs require separate approval.

   If publication fails after the release commit and tag exist, do not deploy that release. After
   confirming which images were already published, use the manually dispatched
   `Recover Release Image Bundle` workflow to copy only the unchanged images from the last complete
   release. The workflow verifies that the release-SHA and semantic-version refs resolve to the same
   digest for all three production images before it succeeds. For example:

   ```bash
   gh workflow run recover-release-image-bundle.yml \
     -f release_sha=<40-char-release-sha> \
     -f release_tag=<vX.Y.Z> \
     -f previous_tag=<previous-vX.Y.Z> \
     -f reuse_batch_backend=true \
     -f reuse_batch_frontend=false \
     -f reuse_telegram_ops_bot=true
   ```

3. SSH to the VPS checkout and run:

   ```bash
   cd /opt/esl-pipeline
   bash scripts/deploy/deploy-prod-images.sh <40-char-git-sha>
   ```

   On the VPS, the deploy script reads `CADDY_PUBLIC_HOSTNAME`, `CADDY_ACME_EMAIL`, and the temporary
   `CADDY_TRANSITION_*` settings from
   server-local `/etc/esl-pipeline/production.env` when those values are not already exported.
   Explicit shell exports still take precedence for one-off overrides. Do not put these values in
   the generated deploy state files under `/var/lib/esl-pipeline/deploy`.

4. The script resolves all requested manifest digests. If a digest is already the current local
   image, it adds the new SHA tag locally instead of downloading the layers. It records image refs,
   digests, application configuration digest and Caddy configuration digest under `/var/lib/esl-pipeline/deploy`, then prints its
   plan. Every deploy checks the requested backend's packaged migration inventory and compatibility
   metadata against the read-only PostgreSQL migration ledger. Backend digest changes trigger
   Postgres health, a verified pre-migration backup, migrations,
   backend workers, frontend, and Caddy recreation. Frontend changes recreate frontend and Caddy;
   bot changes recreate the enabled bot; Caddyfile or effective edge-environment changes recreate Caddy.
   The requested backend image validates production environment before runtime changes. Changes to
   `production.env` or production Compose recreate the enabled application services and edge without database
   work when backend image digests match. An alias-only
   release updates state and runs bounded health checks without backup, migration, or service restart work.
   Older state without the application configuration digest causes one runtime recreation.
5. If checks fail after services update, follow the script's compatibility-gated recovery guidance.
   It prints a command using `/var/lib/esl-pipeline/deploy/previous-images.env` only when that
   backend runtime supports the planned schema. An incompatible boundary blocks that command.

### Schema compatibility and recovery

For a canonical origin change, follow [the domain migration runbook](../operations/canonical-domain-migration.md).
It stages direct Caddy HTTPS on both application hosts, switches the single MCP issuer/resource,
and pairs environment rollback with explicit connector reconnection. Image state alone cannot
roll back an issuer change.

`packages/batch-backend/migrations/runtime-compatibility.json` ships inside the backend image.
Every migration ID must have a declaration; the release contract check rejects missing entries,
unknown values, extra entries, duplicate migration numbers, and unsupported metadata versions.
For each new migration, declare one of:

- `compatible`: old application writers may remain live during this migration, and runtimes that
  supported the preceding schema can still run after it commits.
- `incompatible`: old application writers must stop before migration; a runtime whose packaged
  inventory does not contain this boundary requires database restore before image-only recovery.

Historical migrations through `0059` are explicitly `legacy-unclassified`, which has the same
conservative deployment behavior as `incompatible` when pending or absent from the previous
runtime's inventory. This avoids inventing compatibility guarantees for old releases. `0060` is
explicitly incompatible: it removed `user_settings.id`, used by v12.0.1. Migrations numbered `0060`
and later cannot use `legacy-unclassified`. Do not edit applied SQL or its checksum to add metadata.
Compatibility declarations describe schema/runtime behavior, independently of semantic release labels.

`0061_ordinary_memory_replay` is also incompatible with previous writers. Its student-lock
triggers require publication and confirmed Source transactions to acquire the student lock before
source/memory rows; previous images use opposing ordering and can deadlock. The same quiescence and
schema-compatible recovery gates apply even though this migration only adds indexes and triggers.

`0067_mcp_profile_identities` is incompatible with previous grant writers. It backfills one stable,
immutable profile UUID per retained OAuth user/workspace pair, including expired/revoked grants.
Old writers must stop before backfill so they cannot create grants without identities. Deploy the
combined MCP profile/session-binding correction with the standard script: inspect
`deploy-prod-images.sh <40-char-release-sha> --plan`, then, under separate deployment authorization,
run `deploy-prod-images.sh <40-char-release-sha>`. Use the complete CI-published release bundle,
not the PR head SHA. No new environment variables, manual identity backfill, or OAuth artifact
rewrites are required. The script quiesces writers, verifies the pre-migration backup, applies the
packaged migrations, recreates application services, and verifies schema/health/worker readiness.

After rollout, verify `/api/meta/version` reports migration head `0067_mcp_profile_identities`
(or the reviewed later head). Existing session-bound refresh tokens keep their stored flag and need
reauthorization; the backfilled profile UUID remains stable for the same user/workspace pair.
Observe a new connection's normal refresh after browser-session expiry and confirm its read-only
`get_profile` ID is unchanged. Do not log credentials or initiate live OAuth tests without approval.
Previous-image rollback across `0067` is blocked. Prefer a runtime supporting `0067`, which preserves
profile identities. Restoring a verified pre-`0067` backup is a separate recovery operation: it loses
post-backup writes and any newly provisioned profile identities; applying `0067` again generates
new UUIDs. A backup from a deploy retry after `0067` committed cannot restore pre-`0067` compatibility.

The pre-mutation output lists pending migrations, incompatible/unclassified boundaries, required
quiescence, and previous-image rollback eligibility. To inspect it without backup, migration, or
service mutation:

```bash
bash scripts/deploy/deploy-prod-images.sh <40-char-git-sha> --plan
```

Planning may pull/alias images and write pending local deploy-state files. It does not advance
current/previous image state. A requested image without valid compatibility metadata fails closed;
older current images can supply their SQL inventory without having the new metadata. Database
checksum drift or applied migrations missing from the requested image also block deployment,
including image downgrade attempts. `PG_MIGRATIONS_DIR` overrides are unsupported in this path:
the preflight and migrator must both use the image-packaged SQL.

The terminal output groups work into named phases, reports each step as `WAIT` then `OK`, and
prints one final action plan after schema compatibility and live-bot recovery decisions. That plan
lists image/configuration changes, pending migrations, writer downtime, service recreation reasons,
verification work, and previous-runtime rollback restrictions. `PLAN COMPLETE` means the preflight
passed; review any `WARN` lines before applying. Plan and apply share the incompatible-current-state
guard and require the AWS CLI when backup/migration processing is planned. Preflight success does
not guarantee later backup, migration, provider, or runtime operations will succeed.

Routine command output is retained in a unique `run-<short-sha>-<random>` directory under
`/var/lib/esl-pipeline/deploy` (directory mode `0700`, log files `0600`). Each step log names its
operation. Warnings from captured commands remain visible in the terminal. On failure, the script
reports the phase, operation, original exit code, runtime mutation state, and up to 40 lines of
the failing step's diagnostics, followed by the applicable recovery guidance. Earlier failures
before log initialization report directly to the terminal. Logs can contain operational details;
inspect and redact them before sharing. They are retained until an operator removes them.

To print captured command details after each step, add `--verbose` to either mode:

```bash
bash scripts/deploy/deploy-prod-images.sh <40-char-git-sha> --plan --verbose
```

Health probes suppress intermediate startup errors in the concise view and report elapsed time
and attempts on success. Every request has a 3-second connection timeout and a 5-second total
timeout. Exhausted retries fail deployment with the probe diagnostics. Planning also creates
detailed logs and runs disposable validation containers; it does not stop/recreate application
services, invoke migrations, or create a backup.

Before incompatible schema work, the script stops the live API, all three workers, frontend, and
bot containers belonging to its Compose project, including a live bot whose profile was omitted.
It leaves PostgreSQL, Redis, and Caddy running, rejects unknown live project services, and verifies
that no application container remains running before taking the required verified backup and
invoking migrations. The enabled bot is recreated even if its digest is unchanged. Ordinary
compatible migrations retain the existing online backup/migrate/recreate sequence.

After migration invocation, a failure may mean some migration transactions already committed.
Recovery guidance therefore uses the conservative planned schema, rather than assuming migration
failure rolled everything back. An incompatible boundary suppresses the previous-image command
on migration, recreation, or verification failure and on success. A retry also checks already
applied boundaries against the previous runtime's inventory. Backup/stop failures leave services
stopped (or partially stopped), never invoke migrations, and never automatically restart writers.

`/var/lib/esl-pipeline/deploy/rollback-compatibility.json` records the deployment SHA, requested and
previous backend images, boundaries, and conservative rollback eligibility before mutation. Read
it together with `previous-images.env`; the state file alone is not authorization to restart old
images. To recover across an incompatible boundary, use a schema-compatible application image, or
deliberately restore a verified database backup from before the blocked boundary whose schema
supports the previous runtime. A backup taken during a later deploy retry may already contain that
boundary and cannot recover the old runtime. Database restore remains a separate operator-controlled
operation. The deploy lock and
writer checks cover this Compose project; do not run separate migrations or restart writers
concurrently with deployment.

Post-deploy service evidence should include the dedicated memory worker:

```bash
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  ps student-memory-worker
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  logs --tail=120 student-memory-worker
```

The deploy script requires structured `worker_ready` evidence for all three current worker
instances, including the dedicated memory worker, on every deploy verification. Each record must
match the container's hostname, current Docker start time, service, and configured queue. Workers
await BullMQ initialization with a 30-second deadline; verification polls for up to 60 seconds.
A running container or generic “started” log alone does not satisfy readiness. Readiness proves
current consumer initialization, not future liveness or business success. See
[`host-runtime-health.md`](../operations/host-runtime-health.md) for the separate read-only runtime
queue observation and rollout procedure. `batch-worker` does not consume student-memory jobs.

Record the deployed Git SHA or image version in
[`docs/operations/hosted-mvp-evidence.md`](../operations/hosted-mvp-evidence.md) or the active
deployment evidence note. Do not leave the VPS in a state where the only working fix is an
uncommitted server edit.

Application-image rollback and database restore are separate operations. The deployment script does
not automatically restore PostgreSQL when an application health check fails. Prefer
backward-compatible, additive migrations; an older application image may not work after a schema
migration if the migration was not compatible with the previous runtime.

## Environment Files

Create/update:

```bash
cp .env.example .env
```

Populate required credentials/keys referenced in:
[`docs/reference/env.md`](../reference/env.md)

### Production configuration reconciliation (ESL-53)

Production uses `/etc/esl-pipeline/production.env` as root:root `0600` under protected,
root-owned ancestors. Development continues using repository-local `.env`. Do not create a
compatibility symlink through the checkout or keep operator env backups in `.secrets`.

Existing hosts must follow the [reversible operator migration](../operations/production-config-reconciliation.md)
before deploying this tooling. This repository change prepares that migration; it does not mean
production has migrated. Root performs checkout updates and deployment through the operator's sudo
workflow. The deployment guard rejects unsafe configuration/code/state paths and an unclean checkout;
it deliberately permits a selected published image SHA different from checkout HEAD.

If Google STT/TTS uses a service-account file, create it outside git on the VPS before deployment:

```bash
sudo install -d -o root -g 1000 -m 0750 /opt/esl-pipeline/.secrets
# Securely provision google-service-account.json as root:1000 0640. No env backups here.
```

Production Compose mounts that directory into backend-image services as read-only `/app/secrets`;
the container path is
`GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/google-service-account.json`.

The production backend image includes ffmpeg and uses provider-backed pronunciation/audio paths:
ElevenLabs, Google, or Inworld. It does not provision a separate pronunciation helper runtime.

## Database Migration Flow

Run before serving production traffic on existing databases:

```bash
pnpm --filter @esl-pipeline/batch-backend db:status
pnpm --filter @esl-pipeline/batch-backend db:migrate
pnpm --filter @esl-pipeline/batch-backend db:verify
```

For the production Compose runtime image, run the built tools inside `batch-backend` instead of
assuming source `pnpm`/`tsx` are present:

```bash
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/migrate-db.js status
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/migrate-db.js migrate
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/migrate-db.js verify
```

For fresh environments bootstrapped from the generated schema baseline, verify the baseline stays current when schema work changes:

```bash
pnpm --filter @esl-pipeline/batch-backend db:verify-baseline
```

These baseline commands require a Postgres connection with permission to create and drop temporary databases for verification.

## Prompt Catalog Bootstrap (Required for Fresh Envs)

```bash
pnpm --filter @esl-pipeline/batch-backend run prompt-assets:bootstrap:dry
pnpm --filter @esl-pipeline/batch-backend run prompt-assets:bootstrap
```

Production Compose runtime equivalent:

```bash
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/bootstrap-prompt-assets.js --dry-run
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/bootstrap-prompt-assets.js
```

The production backend image copies `packages/batch-backend/prompt-assets` into
`/app/packages/batch-backend/prompt-assets`.
Keep `PROMPT_TEMPLATE_PATH` relative to `/app` or explicitly under
`/app/packages/batch-backend/prompt-assets/...`; paths such as `/docs/...` point outside the runtime
image and fail bootstrap.

Details: [`docs/operations/prompt-gallery-bootstrap.md`](../operations/prompt-gallery-bootstrap.md)

## Object Storage Smoke

Before the first hosted assignment publish, prove the backend runtime can use the configured S3
artifact bucket/prefix:

```bash
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/smoke-s3-storage.js
```

The command uploads a small text object, reads metadata, generates a short-lived presigned URL, then
deletes the object by default. Add `--keep` only when you want a retained evidence object and have
chosen a non-sensitive key.

## Backup and Ops Safety (Recommended)

- Daily backup archival to S3:
  - local/dev stack: `pnpm docker:db:backup:s3:scheduled`
  - production Compose one-shot: `pnpm docker:prod:db:backup:s3 -- <label>`
  - production Compose listing: `pnpm docker:prod:db:list:s3`
  - remote download/checksum evidence: `pnpm docker:db:artifact-integrity -- <key.dump>`
  - isolated PostgreSQL 18.6 restore/read evidence: `pnpm docker:db:restore-drill -- <key.dump>`
- Ops health status:
  - `pnpm ops:status`
- Alert check (Telegram + cooldown/recovery):
  - `pnpm ops:alert:check`
- Telegram control-panel bot (optional, threaded ops commands):
  - enable `TELEGRAM_OPS_BOT_ENABLED=true`
  - keep `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=false` unless a reviewed host-side command runner
    has been deployed
  - only enable `BATCH_BACKEND_ENABLE_OPS_CONTROL=true` with explicit
    `BATCH_BACKEND_OPS_CONTROL_*_COMMAND` values that do not require Docker/AWS tooling inside the
    long-running backend container
  - run rollout closeout tooling:
    - `pnpm ops:telegram:preflight --profile=readonly_canary`
    - post-deploy `pnpm ops:telegram:verify`

Runbooks:

- [`docs/operations/postgres-backup-restore.md`](../operations/postgres-backup-restore.md)
- [`docs/operations/postgres-backup-s3.md`](../operations/postgres-backup-s3.md)
- [`docs/operations/postgres-ops-health.md`](../operations/postgres-ops-health.md)
- [`docs/operations/telegram-ops-control-panel.md`](../operations/telegram-ops-control-panel.md)

Use both Lightsail snapshots for whole-server recovery and logical Postgres backups for
application-data recovery. Store logical backups separately from the main application data where
possible, and periodically test restores in a non-production environment.

Lightsail instances use burstable CPU performance. Short deployment spikes are acceptable, but do
not spend burst capacity on development work, repeated image builds, or full test suites that can
run locally or in CI. The host/runtime timer reports local CPU and memory pressure, filesystem
capacity, container state/restarts, and the public application routes from the VPS. It does not
report Lightsail burst balance or prove availability when the VPS itself is unreachable; see
[`host-runtime-health.md`](../operations/host-runtime-health.md).

## Redis Queue Runtime

Compose-managed Redis is used as durable queue/event infrastructure for BullMQ, not as a disposable
cache. Production uses the exact official `redis:8.10.1-alpine3.23` image in standalone mode, with
the named `redis_data` volume mounted at `/data` and the host port published only on
`127.0.0.1:6379`. Keep `maxmemory-policy noeviction` so Redis returns backpressure errors under
memory pressure instead of evicting queue state. Production Compose enables AOF with
`appendfsync everysec`; local dev keeps persistence disabled for fast reset semantics unless you
take a manual snapshot before a Redis container refresh. Latency monitoring is enabled at 100 ms so
`LATENCY DOCTOR` and `LATENCY LATEST` can explain server-side stalls without waiting for a failure
window to reproduce.

Treat a production Redis version change as a quiet stateful cutover. Before recreating Redis:

1. Stop or otherwise quiesce queue producers, all BullMQ workers, and direct Redis consumers. Allow
   already-active jobs to finish before stopping their workers; do not deliberately strand active
   locks for the cutover.
2. Record the running server version, container image ID/digest, `redis_data` volume identity,
   `INFO persistence`, and the effective values of `appendonly`, `appendfsync`, `maxmemory-policy`,
   and `latency-monitor-threshold`.
3. With Redis and its writers stopped, create and verify a recoverable snapshot or copy of the
   pre-upgrade `redis_data` volume. A whole-server Lightsail snapshot is acceptable only when its
   Redis filesystem state is quiet and recovery of that volume has been verified operationally.
4. Pull the reviewed exact Redis image, recreate only the intended services, and never run the old
   and new Redis servers against the same volume concurrently.

After recreation, require `redis_version:8.10.1`, a healthy Compose service, successful AOF load and
rewrite status, and the same effective persistence, eviction, and latency settings. Inspect Redis
and worker logs for AOF/load, protocol, connection, and stalled-job errors. Resume consumers in a
controlled order, verify all workers reconnect, and prove an ordinary queued job completes with its
QueueEvents notification before restoring normal traffic.

If Redis cannot load the persisted state or queue/runtime verification fails, stop the new Redis and
consumers. Do not start Redis 8.6 against a volume that Redis 8.10.1 may have rewritten. Restore the
verified pre-upgrade volume snapshot or copy, restore the recorded exact prior image, start Redis,
verify its version/persistence/configuration, then reconnect workers and producers. Do not attempt
ad-hoc AOF repair or data conversion on production.

Before the first BullMQ 6 deployment, run the read-only legacy-repeatable preflight against every
configured ESL Pipeline queue while the currently running backend container still has BullMQ 5:

```bash
cd /opt/esl-pipeline
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec -T batch-backend node --input-type=module \
  < scripts/deploy/check-bullmq-v5-repeatable-jobs.mjs
```

Record the three zero counts before proceeding. A nonzero count is a deployment blocker: do not
deploy BullMQ 6 or introduce Job Schedulers automatically. Inspect and migrate or remove the legacy
definitions with the BullMQ 5 APIs only after that production-data change is separately approved.
The script intentionally fails when run inside a BullMQ 6 container, because v6 removed the
supported v5 API that it uses to read this legacy metadata.

The direct Redis client uses ioredis 6 with `protocol: 2` set explicitly. This keeps the deployed
BullMQ 6 stack and application Redis consumers on the existing RESP2 wire protocol. Treat any
future RESP3 adoption as a separate migration with its own compatibility evidence; do not remove
the explicit protocol setting as routine dependency cleanup.

## CI Expectations

Deployment changes should preserve green CI for:

- `CI gate`
- `repository policy (node 24.x)`
- `build + code quality (node 24.x)`
- `unit + component (node 24.x)`
- `deterministic integration + media (blocking)`
- `backend db + worker integration (blocking)`
- `telegram command-loop compose smoke`

Production image publication is intentionally separate from PR validation. It runs only after the
release bot creates the release commit and tag, and must publish:

- `ghcr.io/abocha/esl-pipeline/batch-backend:<release-commit-sha>`
- `ghcr.io/abocha/esl-pipeline/batch-frontend:<release-commit-sha>`
- `ghcr.io/abocha/esl-pipeline/telegram-ops-bot:<release-commit-sha>`

CI must remain separate from the production VPS. Do not install a self-hosted GitHub Actions runner
on the Lightsail server.

Workflow source:
[`/.github/workflows/ci.yml`](../../.github/workflows/ci.yml) and
[`/.github/workflows/release-on-merge.yml`](../../.github/workflows/release-on-merge.yml). Incident
recovery source:
[`/.github/workflows/recover-release-image-bundle.yml`](../../.github/workflows/recover-release-image-bundle.yml).
