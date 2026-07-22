# Hosted MVP Evidence

## Meta

- Audience: founder/operator, Codex, implementation agents.
- Last Verified Against: 2026-07-23 first-profile assignment incident; 2026-07-16 production
  deployment and automated smoke; 2026-07-14 manual main-flow smoke.
- Status: private hosted baseline passed; keep this record current after material redeploys or rehearsals.
- Related historical plan: `docs/archive/plans/standalone/slice-1-private-hosted-environment.md`.

## Latest Deployment Evidence

```text
Date verified: 2026-07-16
Release: v9.11.0
Git commit deployed: b3b3d203e739e7e9e6636a12d7cb7492713ae16a
Deployment result: frontend-only production VPS deploy completed; no database work; Caddy refreshed
Automated smoke result: backend, frontend API, and public edge health checks passed after bounded startup retries
Manual smoke result: not rerun; latest manual main assignment flow passed on v9.10.0
Invite-path result: not re-verified in this deployment; Slice 2 remains open until one clean
  invite acceptance -> default workspace/settings -> first student -> first assignment run passes
```

The original June rehearsal below remains as historical infrastructure evidence. The July 14 manual
smoke confirms the main assignment flow, while the July 16 deployment adds current release and
automated health evidence. Neither replaces the narrower invite/account bootstrap acceptance gate in
the active Slice 2 plan.

## 2026-07-23 First-Profile Assignment Incident

An alpha tutor's assignment stalled at Teaching context and later returned HTTP 400 when confirming
Create. The assignment, prompt package, draft, confirmed source, confirmed Context snapshot, and
active profile revision remained valid. The failure was fail-closed: no assignment was published
against mismatched lineage.

Observed sequence:

1. the tutor had already populated and approved a structured learner profile;
2. returning focus exposed a brief alternate Teaching context state;
3. after the first containment release, a hard refresh incorrectly displayed `Populate first
profile from lesson`;
4. the tutor followed that instruction, creating and activating a second profile revision while the
   previous revision was preserved as deprecated history;
5. Teaching context then confirmed and assignment generation succeeded; and
6. Create confirmation rejected the session because mutable recovery profile fields were null while
   the durable confirmed Context snapshot contained a complete profile id/revision/hash triple.

Production inspection established that the student-profile binding and structured active revision
had existed when the refreshed UI claimed no profile was available. The refreshed client hydrated
profile selection from the asynchronously loaded student-options list instead of the assignment
session. Before that list resolved, the client represented the learner as having no profile and the
pre-v10 first-profile helper treated that loading gap as a real empty-profile state. Clicking the
helper also re-enabled recovery persistence while the client still held incomplete profile state.

Containment was split deliberately:

- v10.2.1 stopped partial profile lineage from being saved or confirmed, adopted the activated
  revision immediately, and surfaced confirmation errors beside the primary action;
- v10.2.2 made Create recovery atomically restore the durable confirmed Context snapshot before
  confirmation; and
- the follow-up safety patch documented with this incident makes assignment-session lineage
  authoritative during refresh and keeps first-profile actions unavailable while profile authority
  is unresolved.

The incident exposed a larger product mismatch: the first-profile helper predated the v10 assignment
session and confirmation model and exposed profile drafting/activation mechanics inside the teaching
flow. The approved long-term replacement is documented in
[`First-profile onboarding`](../design/FIRST_PROFILE_ONBOARDING.md). Initial evidence enrichment will
be automatic, bound to the exact confirmed lesson, editable through the Student Learning page, and
free of assignment-level profile workflow choices.

## 2026-07-16 Release Publication Incident and Recovery

The [`v9.11.0` release workflow](https://github.com/abocha/esl-pipeline/actions/runs/29495264990)
failed twice after successfully pushing the frontend image. The GHA Buildx cache exporter returned
`error writing layer blob: failed to reserve cache`, which stopped the job before unchanged backend
and Telegram bot manifests were retagged. The release bundle was incomplete, so it was not deployed;
the running production environment was unaffected.

Recovery and prevention landed in
[`PR #139`](https://github.com/abocha/esl-pipeline/pull/139) with `release:none`:

- GHA cache export is now best-effort via `ignore-error=true`; image publication and unchanged-image
  reuse remain fatal.
- `Recover Release Image Bundle` provides a manual, fail-closed recovery path. It validates the
  existing release tag/SHA, copies only explicitly selected unchanged images with
  `--prefer-index=false`, and verifies matching SHA/version-tag digests for all three images.
- The [recovery run](https://github.com/abocha/esl-pipeline/actions/runs/29497139651) copied backend
  and Telegram bot manifests from `v9.10.5`, retained the already-published frontend, and verified:
  - `batch-backend`: `sha256:20b0b3c3fa551c27e195bcab0c9401e5bb106ed756623da8c755b14c310f5e26`
  - `batch-frontend`: `sha256:725fb7d38858dfbffda1a7ecd9ef237a12a06833d31d7f82687f85c0b3e545e9`
  - `telegram-ops-bot`: `sha256:ec3af5d9e0205bf7e5397248551a9ebc8b300168baf7c9b9fcbec1e32824e8b3`

The subsequent VPS deploy correctly planned `backend_changed=false`, `frontend_changed=true`,
`bot_changed=false`, and `database_work=false`. It recreated the frontend and Caddy edge, passed the
bounded health/smoke checks after two transient connection-reset retries, recorded the successful
deployment state, and removed superseded custom images.

## Deployment Snapshot

```text
Date: 2026-06-13
Operator: founder/operator
Git commit deployed: dac03f3a6de34febeeca907436d0b6ddaf8c7148
Branch: main after PR #96 merge
Hosting provider: AWS Lightsail
Instance size: 2 GB RAM, 2 vCPUs, 60 GB SSD
Region: Singapore / ap-southeast-1
Domain or hosted URL: https://esl-pipeline.run.place/
DNS provider: DNSExit
Internal backend URL: http://127.0.0.1:8080
```

## Commands Used

```bash
# Build/deploy command:
export CADDY_PUBLIC_HOSTNAME=esl-pipeline.run.place
export CADDY_ACME_EMAIL=<operator-email>
bash scripts/deploy/deploy-prod-images.sh dac03f3a6de34febeeca907436d0b6ddaf8c7148

# Migration status command:
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/migrate-db.js status

# Migration command:
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/migrate-db.js migrate

# Prompt assets bootstrap command:
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/bootstrap-prompt-assets.js --dry-run
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/bootstrap-prompt-assets.js

# S3 storage smoke command:
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/smoke-s3-storage.js

# Health check command:
curl -fsS http://127.0.0.1:${BATCH_FRONTEND_HOST_PORT:-5173}/api/health

# Frontend same-origin API proxy check:
curl -fsS http://127.0.0.1:${BATCH_FRONTEND_HOST_PORT:-5173}/api/meta/version

# Backup command:
PG_BACKUP_ALERT_TELEGRAM_DISABLE=true pnpm docker:prod:db:backup:s3 -- alpha_post_restore_check

# Restore drill command:
PG_BACKUP_ALERT_TELEGRAM_DISABLE=true pnpm docker:prod:db:restore:s3 -- <remote-dump-key> --download-only
```

## Service Status

```text
Frontend container: running
Backend/API container: running and healthy
Worker container: running
Transcribe worker container: required for recording transcription; added to prod Compose after rehearsal incident
Postgres container: running and healthy
Redis container: running and healthy
Caddy edge container: running, public 80/443 only
Telegram ops bot absent/profile-gated/intentionally enabled: profile-gated behind ops-bot and not part of default stack
```

Paste `pnpm docker:prod:ps` or equivalent output summary here:

```text
batch-backend: healthy, 127.0.0.1:8080->8080
batch-frontend: running, 127.0.0.1:5173->80
batch-worker: running
postgres: healthy, 127.0.0.1:5432->5432
redis: healthy, 127.0.0.1:6379->6379
caddy-edge: running, 0.0.0.0:80/443
```

## Health Check Evidence

```text
Health endpoint: https://esl-pipeline.run.place/api/health
HTTP status: 200
Response summary: ok=true, service=batch-backend
Postgres check: ok=true
Redis check: ok=true
Same-origin /api proxy check: https://esl-pipeline.run.place/api/meta/version returned contract metadata
2026-06-13 pull-based deploy smoke also passed backend health, frontend API health, and public HTTPS edge health.
```

## Migration Evidence

```text
Migration status before 2026-06-13 deploy: no pending migrations
Migration command result: 38 discovered, 38 applied, 0 pending
Migration status after: db=0.20.0, head=0038_alpha_invites_and_signup_workspace
DB verify result: migration verification passed
Prompt assets bootstrap result: verified after correcting production prompt paths to docs/prompt-gallery/...
```

## S3 Evidence

```text
Artifact bucket/prefix: configured server-local S3 artifact bucket, smoke prefix under audio/assignments/smoke/closed-alpha
Backup bucket/prefix: configured server-local S3 backup bucket, backups/postgres/dev used during rehearsal; switch hosted env to alpha
Test upload/read performed: yes
S3 smoke command result: upload, metadata/read, presigned URL generation, and delete all succeeded
Published artifact S3 key: not recorded in this committed doc
Published artifact URL or access mechanism: not recorded in this committed doc
Private transcript/backup visibility checked: backup bucket list/upload worked with least-privilege credentials; public visibility not recorded here
```

## Backup Evidence

```text
Backup command: deploy-prod-images.sh created the pre-migration backup via postgres-prod-backup-s3.sh backup-upload
Backup timestamp: 2026-06-13 deploy window
Backup S3 key: uploaded by production backup script; exact private object key intentionally not committed
List command result: deploy script checksum-verified the local backup artifacts before continuing
Restore drill mode: destructive restore was performed from latest nightly before this evidence; use --download-only for routine drills
Restore drill result: DB restored, migrations verified, backend and worker recovered
```

## Hosted Assignment Publish Evidence

```text
Test user/operator: founder/operator account restored from backup
Test student: not recorded in committed docs
Assignment session ID: not recorded in committed docs
Job ID: not recorded in committed docs
Published artifact URL: not recorded in committed docs
S3 artifact key: not recorded in committed docs
API logs inspected: yes
Worker logs inspected: yes
Transcribe worker logs inspected: manual transcribe-worker was required during incident; prod Compose now includes it
Failure diagnosis path confirmed: yes, missing transcribe-worker was visible as transcribe_queue_waiting with no consumer
```

## Restart/Redeploy Persistence Check

```text
Action performed: restored DB from S3, restarted backend/worker, verified health and logs
DB data still present: yes, login and restored API surfaces worked
Uploaded/generated artifact still present: S3 smoke object lifecycle worked; assignment artifact evidence not committed here
Worker still starts: yes
Transcribe worker starts: added to prod Compose as follow-up from incident
Optional bot service is not restart-looping: not started by default
```

## Known Issues

```text
- Production backend initially crashed because the orchestrator bundle embedded Google Cloud TTS
  CommonJS code. Fixed by externalizing @google-cloud/text-to-speech from the orchestrator bundle
  and making it a runtime dependency.
- Production Compose initially tried to pull esl-pipeline/batch-backend:local because worker
  services referenced a local tag before the backend service image was explicitly named.
- Caddy edge pnpm scripts require CADDY_PUBLIC_HOSTNAME and CADDY_ACME_EMAIL exported in the shell,
  not only present in .env.
- Prompt bootstrap failed with /docs/... paths; production runtime expects docs/... or /app/docs/...
- Backup/restore completion Telegram uses PG_BACKUP_ALERT_TELEGRAM_* and can fail independently of
  TELEGRAM_OPS_BOT_* when an invalid message thread id is configured.
- The first live recording flow needed a dedicated transcribe-worker service. A generic
  batch-worker alone does not consume transcribe jobs.
- The first pull-based deploy exposed stale caddy-edge runtime config drift: the running Caddyfile
  still proxied to batch-frontend:80 after the frontend image moved to port 8080. Recreating
  caddy-edge fixed the live edge without a database restore. Follow-up branch
  codex/invited-tutor-readiness force-recreates caddy-edge during deploy and verifies the mounted
  Caddyfile targets reverse_proxy batch-frontend:8080.
- Pre-tutor product blocker found after student creation: profile IDs such as
  profiles/students/<student-id>.md must remain URL-escaped through the frontend nginx /api proxy.
  Branch codex/invited-tutor-readiness updates the same-origin proxy path to preserve encoded %2F
  and adds regression tests before the next tutor invite rehearsal.
```

## Slice 1 Pass/Fail

```text
Hosted app URL exists: yes
Backend health check passes: yes
Worker is running: yes
Transcribe worker is running: yes
Database persists after redeploy/restart: yes
Uploaded/generated file persists in S3: S3 smoke passed; assignment artifact not recorded in this doc
Published HTML artifact reachable: not yet refreshed after the 2026-06-13 pull-based deploy
Hosted logs accessible: yes
Failed job diagnosis path exists: yes
Backup exists in S3: yes
Restore path documented: yes
One hosted end-to-end assignment publish succeeded: yes in the rehearsal and the v9.10.0 main-flow smoke
Same-origin frontend API calls work: yes in the v9.10.0 manual smoke and v9.11.0 automated deploy checks; invite/bootstrap coverage remains a separate Slice 2 gate
Prompt assets bootstrapped: yes after path correction
Telegram ops bot absent/profile-gated/intentionally enabled: absent/profile-gated
```

Final decision:

```text
Slice 1 status: complete; pull-based deployment baseline passed and v9.11.0 was deployed successfully
Blocker if any: none for Slice 1
Next slice allowed: yes; retain one clean invite-to-assignment rehearsal as Slice 2 evidence
```
