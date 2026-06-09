# Hosted MVP Evidence

## Meta

- Audience: founder/operator, Codex, implementation agents.
- Status: fill during Slice 1 verification.
- Related plan: `docs/plans/slice-1-private-hosted-environment.md`.

## Deployment Snapshot

```text
Date:
Operator:
Git commit deployed:
Branch:
Hosting provider:
Droplet size:
Region:
Domain or hosted URL:
Internal backend URL:
```

## Commands Used

```bash
# Build/deploy command:

# Migration status command:
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/migrate-db.js status

# Migration command:
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/migrate-db.js migrate

# Prompt assets bootstrap command:
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/bootstrap-prompt-assets.js --dry-run
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/bootstrap-prompt-assets.js

# Health check command:
curl -fsS http://127.0.0.1:${BATCH_FRONTEND_HOST_PORT:-5173}/api/health

# Frontend same-origin API proxy check:
curl -fsS http://127.0.0.1:${BATCH_FRONTEND_HOST_PORT:-5173}/api/meta/version

# Backup command:

# Restore drill command:
```

## Service Status

```text
Frontend container:
Backend/API container:
Worker container:
Postgres container:
Redis container:
Telegram ops bot absent/profile-gated/intentionally enabled:
```

Paste `pnpm docker:prod:ps` or equivalent output summary here:

```text

```

## Health Check Evidence

```text
Health endpoint:
HTTP status:
Response summary:
Postgres check:
Redis check:
Same-origin /api proxy check:
```

## Migration Evidence

```text
Migration status before:
Migration command result:
Migration status after:
DB verify result:
Prompt assets bootstrap result:
```

## S3 Evidence

```text
Artifact bucket/prefix:
Backup bucket/prefix:
Test upload/read performed:
Published artifact S3 key:
Published artifact URL or access mechanism:
Private transcript/backup visibility checked:
```

## Backup Evidence

```text
Backup command:
Backup timestamp:
Backup S3 key:
List command result:
Restore drill mode:
Restore drill result:
```

## Hosted Assignment Publish Evidence

```text
Test user/operator:
Test student:
Assignment session ID:
Job ID:
Published artifact URL:
S3 artifact key:
API logs inspected:
Worker logs inspected:
Failure diagnosis path confirmed:
```

## Restart/Redeploy Persistence Check

```text
Action performed:
DB data still present:
Uploaded/generated artifact still present:
Worker still starts:
Optional bot service is not restart-looping:
```

## Known Issues

```text
-
```

## Slice 1 Pass/Fail

```text
Hosted app URL exists: yes/no
Backend health check passes: yes/no
Worker is running: yes/no
Database persists after redeploy/restart: yes/no
Uploaded/generated file persists in S3: yes/no
Published HTML artifact reachable: yes/no
Hosted logs accessible: yes/no
Failed job diagnosis path exists: yes/no
Backup exists in S3: yes/no
Restore path documented: yes/no
One hosted end-to-end assignment publish succeeded: yes/no
Same-origin frontend API calls work: yes/no
Prompt assets bootstrapped: yes/no
Telegram ops bot absent/profile-gated/intentionally enabled: yes/no
```

Final decision:

```text
Slice 1 status: pass/fail/blocked
Blocker if any:
Next slice allowed: yes/no
```
