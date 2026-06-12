# Alpha Deployment Decisions and First-Slice Plan

## Meta

- Audience: founder/operator, Codex, implementation agents.
- Authority level: active decision record for closed-alpha infrastructure and first implementation slices.
- Status: active until replaced by a later decision record.
- Related source of truth: `docs/product-north-star-closed-alpha.md`.
- Scope: ESL Pipeline closed-alpha preparation.
- Current phase: hosted deployment plus invite-only tutor signup.

## Purpose

This document records the decisions already made before implementation starts. Codex should use this file to avoid reopening solved questions unless implementation evidence proves a decision is wrong.

The immediate product goal is not public launch. The immediate goal is a private hosted rehearsal, then a controlled tutor entry path, then the first real tutor dry run.

## Working Order

The order is locked for now:

```text
1. Deploy privately.
2. Prove the current app works hosted.
3. Finish invite/signup -> workspace -> first student flow.
4. Invite one real tutor.
5. Expand to 3 to 5 tutors only after the one-tutor dry run is healthy.
```

Short rule:

```text
Deploy early. Share late.
```

Slice 1 is not a public launch. It is a private hosted rehearsal for the founder/operator.

## Locked Decisions

### 1. Compute Provider

Decision: use an AWS Lightsail instance for first hosted alpha compute.

Reason:

- The current repo already has Docker-based deployment assets.
- A single VM keeps the first hosted environment understandable.
- It avoids a platform rewrite for Firebase, Supabase, Vercel, or serverless functions.
- It keeps closed-alpha cost low.
- It supports the current shape of the app: frontend, API, worker, Postgres, Redis.
- AWS billing is available for the operator, while DigitalOcean account activation was blocked.

Current starting size:

- AWS Lightsail, Singapore region.
- Ubuntu 24.04 LTS.
- General purpose instance with 2 GB RAM, 2 vCPUs, 60 GB SSD, and 3 TB transfer.

Verify the exact Lightsail bundle, region, and current price at provisioning time through the AWS
console or AWS CLI; do not copy old size/pricing assumptions into deployment scripts without
checking them live.

Codex must not hard-code a provider-specific assumption into app code. Provider choice belongs in docs and deployment commands.

### 2. Object Storage and Backups

Decision: keep existing AWS S3 storage.

Current known use:

- transcripts
- generated artifacts
- MP3/audio outputs
- Postgres backups

Reason:

- AWS S3 is already working.
- Existing cost is low.
- Migrating storage now does not improve Slice 1.
- The app already has S3-oriented runtime and backup scripts.

Non-decision:

- Do not migrate away from AWS S3 for Slice 1.
- Reconsider only if S3 cost, latency, IAM complexity, or operational friction becomes a real alpha problem.

### 3. Deployment Shape

Decision: use a single Docker Compose deployment on the Lightsail VPS.

Target services:

```text
AWS Lightsail VPS
  - Caddy edge proxy for HTTPS
  - frontend container
  - backend/API container
  - worker container
  - transcribe worker container
  - Postgres container with persistent Docker volume
  - Redis container with persistent Docker volume

AWS S3
  - transcripts
  - artifacts
  - audio/MP3 outputs
  - Postgres backups
```

Repo facts to verify and use:

- `docker-compose.prod.yml` already exists.
- It defines `batch-backend`, `batch-frontend`, `batch-worker`, `transcribe-worker`, `postgres`,
  and `redis`.
- It also currently defines `telegram-ops-bot`; Telegram bot work is deferred for alpha.
- Root `package.json` already has `pnpm docker:prod`, `pnpm docker:prod:ps`, and backup/restore commands.
  The HTTPS edge path also has `pnpm docker:prod:edge:*` validation/start commands.

Codex should preserve and improve the existing deployment path instead of creating a parallel one unless there is a documented blocker.

Development and deployment policy:

- The developer laptop is the primary development environment.
- Git commits and CI validation are the source of truth for deployable code.
- The Lightsail VPS is production runtime, not the normal coding, test-suite, or repeated image-build
  environment.
- SSH is for deployment, status/log/resource checks, reviewed migrations, backup/restore operations,
  production-only diagnosis, and emergency recovery.
- Prefer CI-built images tagged by Git commit SHA for production deployment. Until that publish path
  exists, record the exact deployed Git SHA for the current Compose-based rehearsal path.
- Do not install a self-hosted CI runner on the production VPS.

Current verification notes from the 2026-06-09 doc/repo pass:

- `docker compose -p esl-pipeline-prod -f docker-compose.prod.yml config --quiet` parses
  successfully.
- The frontend API client uses `/api/...` when `VITE_BATCH_BACKEND_URL` is unset, and production
  frontend nginx now proxies `/api/*` to `batch-backend:8080` with `/api` stripped. Raw `/jobs` is
  not exposed by default through frontend nginx.
- Default production Compose should keep the raw frontend host binding private on `127.0.0.1`.
  `BATCH_FRONTEND_BIND_ADDR=0.0.0.0` is a founder-rehearsal-only HTTP override, not a tutor-access
  shape.
- Caddy edge mode is the intended public HTTPS topology: public `80/443` terminate at Caddy, then
  Caddy proxies to `batch-frontend:80`, and frontend nginx keeps `/api/*` routed to
  `batch-backend:8080`.
- The production backend image is a built runtime image. Do not assume
  `pnpm --filter @esl-pipeline/batch-backend db:migrate` works inside the container until the
  runtime image is verified; prefer or add a built command such as
  `node dist/tools/migrate-db.js migrate`.
- `telegram-ops-bot` is profile-gated behind the `ops-bot` Compose profile. Default production
  Compose does not start it.
- The hosted rehearsal proved that the generic `batch-worker` is not enough for recording uploads.
  Transcription jobs require a dedicated `transcribe-worker` service running
  `node dist/transport/transcribe-worker.js`.

### 4. Docker

Decision: keep Docker and Docker Compose.

Reason:

- The repo already supports Docker.
- Docker makes local/hosted process shape explicit.
- Avoiding Docker would not remove the need for API, worker, Postgres, Redis, env, logs, and backups.
- A non-Docker VM deployment would make the server easier to drift into a handcrafted snowflake.

### 5. Managed Services

Decision: do not start with managed Postgres or managed Redis.

Reason:

- Closed alpha is small: founder/operator first, then one tutor, then 3 to 5 tutors.
- The repo already has Docker Postgres and Redis.
- Existing backup-to-S3 scripts reduce the first-stage risk.
- Managed Postgres/Redis can be reconsidered after alpha usage or if VM operations become painful.

Stop condition:

- If Postgres restore cannot be documented and tested enough for alpha, reopen managed Postgres discussion.
- If VM disk/volume persistence or host-level recovery feels too fragile after the first restore
  drill, reopen managed Postgres or a separate volume discussion before inviting tutors.

### 6. Public Access

Decision: first deployment is private/internal.

Private/internal means:

- The founder/operator can access it.
- It does not need to be polished for outside tutors.
- It does not need public marketing pages.
- It does not need paid billing.
- It must still protect secrets and private data.

Do not invite trial tutors until Slice 2 passes.

Plain HTTP is acceptable only for founder/operator rehearsal. Real invited tutors must not register,
log in, or submit lesson/student data until HTTPS is configured.

## Non-Goals for the First Two Slices

Do not build these unless they unblock the current slice:

- public landing page
- SaaS billing/pricing
- Google Calendar sync
- tutor-facing Telegram bot
- student-facing Telegram bot
- student portal
- advanced admin dashboard
- provider gateway overhaul
- prompt library expansion
- TTS expressiveness improvements
- storage migration
- Kubernetes
- autoscaling
- multi-region deployment

## Slice Summary

### Slice 1: Private Hosted Environment

Goal:

The founder/operator can use the hosted app for real work.

Pass evidence:

- hosted app URL exists
- API health check works
- API container is running
- worker container is running
- Postgres data persists after container restart/redeploy
- Redis is available to API and worker
- existing AWS S3 storage works from hosted containers
- database backup uploads to AWS S3
- restore path is documented
- one hosted end-to-end assignment publish succeeds
- logs are accessible enough to diagnose a failed job without guesswork

See: `docs/plans/slice-1-private-hosted-environment.md`.

### Slice 2: Invite Signup to Workspace to First Student

Goal:

An invited tutor can create an account, receive a default workspace and settings, create a first student, and reach the first assignment path without manual database work.

Pass evidence:

- invited tutor can sign up
- non-invited registration is blocked or controlled
- login works
- user has a default workspace
- user has default settings
- user can create first student
- user can start the assignment flow
- signup requires no manual DB intervention

See: `docs/plans/slice-2-invite-workspace-first-student.md`.

## Decision Ledger

Use this format for future decisions made with Codex:

```text
date:
decision:
reason:
alternatives considered:
impact:
follow-up:
```

### 2026-06-06: First alpha hosting topology

```text
date: 2026-06-06
decision: Use a single VPS for compute and existing AWS S3 for object storage/backups.
reason: Lowest migration burden for the current Docker-based repo while preserving existing working S3 storage and keeping alpha cost low.
alternatives considered: Render, Railway, Fly.io, Firebase rewrite, Supabase rewrite, Vercel/serverless rewrite, DigitalOcean Spaces migration.
impact: One-server alpha deployment; low initial cost; simple mental model; VM operations remain the operator's responsibility.
follow-up: Reconsider managed Postgres/Redis or PaaS deployment after alpha usage shows real operational pain.
```

### 2026-06-06: First deployment before tutor sharing

```text
date: 2026-06-06
decision: Deploy privately before finishing tutor signup/workspace flow, but do not share with tutors until signup/workspace passes.
reason: Hosting failures and product-entry failures should be isolated. A private hosted rehearsal reveals env, Docker, S3, DB, Redis, migration, CORS, and worker problems before a real tutor is waiting.
alternatives considered: Finish all workspace/signup work locally first, then deploy once before sharing.
impact: Earlier reality check; less debugging fog; no real tutor exposure until Slice 2 passes.
follow-up: Keep Slice 1 strictly private/internal.
```

### 2026-06-09: Closed-alpha invite and first-student boundary

```text
date: 2026-06-09
decision: Use alpha_invites plus existing users.is_active for closed-alpha signup; create users.role=user and workspace_memberships.role=owner during signup.
reason: Provides controlled signup without introducing a broader account-state system or admin UI.
alternatives considered: open registration with admin approval, new user status enum, full organization management.
impact: Operator creates invites through a compiled backend CLI; signup creates user, settings, workspace, membership, business settings, and accepted invite transactionally.
follow-up: Do not expand past one real tutor until workspace isolation covers the active assignment flow.
```

### 2026-06-10: Optional Caddy HTTPS edge prepared before VPS access

```text
date: 2026-06-10
decision: Prepare an optional Caddy edge profile for the Ubuntu 24.04 VPS while VPS access is blocked.
reason: The app needs a single public HTTPS entrypoint before real tutor signup/login, but the current account review prevents live VPS validation.
alternatives considered: Leave the raw frontend port public, proxy backend directly from Caddy, wait for VPS access before adding any edge config.
impact: Default prod Compose remains private-safe and locally verifiable; edge mode exposes only Caddy on 80/443 and preserves same-origin frontend nginx API routing.
follow-up: After VPS access and DNS are available, verify HTTP redirects to HTTPS, public `/api/health`, public `/api/meta/version`, closed raw service ports, and persistent Caddy state volumes on the real VPS.
```

### 2026-06-11: Compute provider switched to AWS Lightsail

```text
date: 2026-06-11
decision: Use AWS Lightsail in Singapore for the first private hosted rehearsal.
reason: DigitalOcean blocked account activation, while AWS billing and Lightsail provisioning worked for the operator.
alternatives considered: Continue waiting on DigitalOcean account activation, migrate storage/provider shape, or switch to a broader PaaS.
impact: The existing single-VPS + Docker Compose + AWS S3 topology remains intact; only the compute provider/runbook language changes.
follow-up: Keep app code provider-neutral, update docs from Droplet to Lightsail, and record the hosted rehearsal evidence.
```

### 2026-06-11: First private hosted rehearsal completed

```text
date: 2026-06-11
decision: Treat the Lightsail deployment as the Slice 1 rehearsal environment.
reason: The app loaded over HTTPS at esl-pipeline.run.place, public health passed, DB restore and migration verification passed, S3 smoke passed, and backup upload to S3 passed.
alternatives considered: Tear down and retry on a different provider before recording evidence.
impact: Next work should stabilize reproducibility from git and server-local env rather than hand-editing the VPS.
follow-up: Add production transcribe-worker, commit the orchestrator runtime hotfix, and verify a fresh prod Compose rebuild.
```

### 2026-06-12: Development and VPS runtime boundary

```text
date: 2026-06-12
decision: Treat local development as the coding/testing environment, Git plus CI as the deployable source of truth, and Lightsail as production runtime only.
reason: The Lightsail instance is burstable and holds production data; using it for routine coding, full tests, hot reload, repeated builds, or CI would waste capacity and increase drift/data risk.
alternatives considered: Use the VPS as a remote development box, install a self-hosted CI runner there, or keep deploying mutable local/server builds without recording the selected commit.
impact: Normal work happens locally, CI remains clean and off-server, deployments must record the Git SHA or image version, and SSH use is limited to production operations.
follow-up: Add a CI image-publish path with commit-SHA tags when the deployment flow graduates from private rehearsal to repeatable production releases.
```

## Codex Working Rules

Before coding any slice, Codex should:

1. Read this file.
2. Read `docs/product-north-star-closed-alpha.md`.
3. Read the slice plan file.
4. Inspect existing repo implementation before proposing new architecture.
5. State non-goals.
6. Make the smallest vertical change that produces slice evidence.
7. Prefer fixing the existing path over creating parallel infrastructure.
8. Stop and report if a decision is required that is not recorded here.

Completion output from Codex must include:

```text
Files changed:
Commands run:
Tests run:
Manual verification:
Evidence produced:
Known limitations:
Follow-up:
```

## Stop Rules

Stop and ask for a product/operator decision if any of these happen:

- Current `docker-compose.prod.yml` cannot support required Slice 1 services without substantial redesign.
- Production env/secrets shape is ambiguous enough that deployment would be unsafe.
- Existing S3 usage cannot be verified from the hosted environment.
- Backup upload works but restore path cannot be documented.
- Health check cannot verify enough to prove API/DB/Redis availability.
- Worker cannot start or consume jobs in the hosted environment.
- Signup implementation requires changing account/workspace semantics beyond the Slice 2 plan.
- A migration could risk existing data without a backup and rollback path.

## Mental Model

Do not optimize the long-term SaaS platform yet.

The current target is:

```text
A small serious app, privately hosted, observable enough, safe enough, and ready to accept one invited tutor later.
```
