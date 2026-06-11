# Hosted MVP Evidence

## Meta

- Audience: founder/operator, Codex, implementation agents.
- Status: first private hosted rehearsal recorded; update after each redeploy or rehearsal.
- Related plan: `docs/plans/slice-1-private-hosted-environment.md`.

## Deployment Snapshot

```text
Date: 2026-06-11
Operator: founder/operator
Git commit deployed: server checkout included hotfixes from this stabilization branch; commit pending
Branch: codex/lightsail-hosted-rehearsal-stabilization
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
pnpm docker:prod:edge

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
```

## Migration Evidence

```text
Migration status before: restored DB had no pending migrations after restore
Migration command result: no pending database migrations
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
Backup command: PG_BACKUP_ALERT_TELEGRAM_DISABLE=true pnpm docker:prod:db:backup:s3 -- alpha_post_restore_check
Backup timestamp: 2026-06-10 23:16 UTC from server output
Backup S3 key: post-restore alpha_post_restore_check set uploaded under backups/postgres/dev/esl_batch/
List command result: pnpm docker:prod:db:list:s3 listed remote backup objects including the post-restore set
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
```

## Slice 1 Pass/Fail

```text
Hosted app URL exists: yes
Backend health check passes: yes
Worker is running: yes
Transcribe worker is running: yes after manual incident workaround; now required in prod Compose
Database persists after redeploy/restart: yes
Uploaded/generated file persists in S3: S3 smoke passed; assignment artifact not recorded in this doc
Published HTML artifact reachable: not recorded in this committed doc
Hosted logs accessible: yes
Failed job diagnosis path exists: yes
Backup exists in S3: yes
Restore path documented: yes
One hosted end-to-end assignment publish succeeded: yes after manually starting transcribe worker
Same-origin frontend API calls work: yes
Prompt assets bootstrapped: yes after path correction
Telegram ops bot absent/profile-gated/intentionally enabled: absent/profile-gated
```

Final decision:

```text
Slice 1 status: pass after stabilization PR lands and prod Compose starts transcribe-worker by default
Blocker if any: hosted reproducibility depends on committing the transcribe-worker service and orchestrator runtime hotfix
Next slice allowed: yes after one clean redeploy from committed code and one live recording transcription check
```
