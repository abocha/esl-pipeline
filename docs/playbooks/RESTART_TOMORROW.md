# Restart Tomorrow (ADHD-Friendly, ELI5)

## Current Handoff (2026-06-11)

- What I finished:
  - First private hosted rehearsal is live at `https://esl-pipeline.run.place/` on AWS Lightsail.
  - DNSExit `A` record points `esl-pipeline.run.place` at the static Lightsail IPv4 address.
  - Caddy edge mode is running with HTTPS.
  - Production Compose stack is up after the deployment stabilization changes:
    - `batch-frontend`
    - `batch-backend`
    - `batch-worker`
    - `transcribe-worker`
    - `postgres`
    - `redis`
    - `caddy-edge`
  - Public health checks passed:
    - `https://esl-pipeline.run.place/api/health`
    - `https://esl-pipeline.run.place/api/meta/version`
  - Backend health reported `api`, `postgres`, and `redis` all `ok: true`.
  - Worker logs show `Worker started`.
  - Restored production-ish DB state from the configured S3 backup prefix.
  - Migration verification passed at:
    - `db=0.20.0`
    - `dbMigrationHead=0038_alpha_invites_and_signup_workspace`
  - S3 smoke passed against bucket `esl-notion-tts`, with upload, presigned URL generation, and delete all successful.
  - Post-restore backup uploaded successfully under the configured S3 backup prefix.
  - First live recording job initially waited forever at `transcribe_queue_waiting`; it completed only after starting a transcribe worker manually.

- First step for next session:
  - Review, commit, and push the deployment stabilization PR:
    - `packages/orchestrator/tsup.config.ts`
    - `packages/orchestrator/package.json`
    - `pnpm-lock.yaml`
    - `docker-compose.prod.yml`
    - Lightsail deployment docs and evidence

- Current blocker:
  - No hosted runtime blocker after the manual transcribe worker was started, but the VPS must not rely on manual one-off worker starts.
  - Do not forget to preserve the server-local `.env.batch-backend`; it contains real secrets and host-specific fixes.

## Tomorrow Todo (Lightsail Hosted Alpha)

1. Commit the production boot hotfix.
   - Root cause: backend crashed because the orchestrator bundle embedded Google Cloud TTS CommonJS code, which triggered `Dynamic require of "stream" is not supported`.
   - Fix already applied locally:
     - externalize `@google-cloud/text-to-speech` in `packages/orchestrator/tsup.config.ts`
     - add `@google-cloud/text-to-speech` as an orchestrator runtime dependency
   - Validation already run:
     - `pnpm --filter @esl-pipeline/orchestrator build`
     - direct `node import('./packages/orchestrator/dist/index.js')`
     - `pnpm --filter @esl-pipeline/orchestrator test:unit:prebuilt`
     - `pnpm --filter @esl-pipeline/batch-backend build`
   - Backend unit prebuilt failed only because local Postgres was not running at `127.0.0.1:5432`; do not treat that as related without reproducing with DB up.

2. Commit the production `transcribe-worker` service.
   - Root cause: generic `batch-worker` does not consume transcription jobs.
   - Required production service:
     - same backend runtime image and `.env.batch-backend`
     - `PG_APPLICATION_NAME=esl-pipeline-transcribe-worker`
     - command `node dist/transport/transcribe-worker.js`
     - `restart: unless-stopped`
   - Fresh `pnpm docker:prod:edge` must start it automatically.

3. Clean up deployment docs.
   - Replace active DigitalOcean/Droplet assumptions with AWS Lightsail.
   - Keep the actual decision as:
     - single VPS
     - Docker Compose
     - Caddy HTTPS edge
     - local Docker Postgres and Redis for now
     - AWS S3 for artifacts and Postgres backups
   - Likely files:
     - `docs/alpha-deployment-decisions.md`
     - `docs/plans/slice-1-private-hosted-environment.md`
     - `docs/operations/postgres-backup-s3.md`
     - `docs/operations/hosted-mvp-evidence.md`
     - generated plans index after docs generation

4. Record hosted evidence.
   - Fill `docs/operations/hosted-mvp-evidence.md` with:
     - hosted URL
     - Lightsail region/shape
     - commit deployed
     - compose command
     - health output summary
     - migration output summary
     - S3 smoke result
     - backup result without exact private object keys
     - worker/backend/transcribe-worker log evidence

5. Fix server env rough edges.
   - Change `PG_BACKUP_S3_ENV=dev` to `PG_BACKUP_S3_ENV=alpha` for future hosted backups.
   - Confirm prompt paths stay relative or `/app/...`, not `/docs/...`:
     - `PROMPT_TEMPLATE_PATH=docs/prompt-gallery/templates/hw_prompt_definitive.md`
     - `PROMPT_PROFILE_PATH=docs/prompt-gallery/profiles/PROFILE_2025-11-16.md`
   - Keep prod restore targeting explicit:
     - `PG_CONTAINER_NAME=esl-pipeline-prod-postgres-1`
     - `PG_COMPOSE_PROJECT=esl-pipeline-prod`
     - `PG_COMPOSE_FILE=docker-compose.prod.yml`
   - Set the real Caddy ACME email if it was left as a placeholder.

6. Fix Telegram backup notification confusion.
   - Backup/restore completion Telegram uses `PG_BACKUP_ALERT_TELEGRAM_*`, not `TELEGRAM_OPS_BOT_*`.
   - Current safe setting:
     - `PG_BACKUP_ALERT_TELEGRAM_DISABLE=true`
   - If enabling later, only set `PG_BACKUP_ALERT_TELEGRAM_THREAD_ID` if the exact forum topic exists.
   - The previous error was:
     - `Bad Request: message thread not found`

7. Commit the Compose image/tag polish patch.
   - `batch-worker` references `image: esl-pipeline/batch-backend:local`.
   - `batch-backend` currently builds with a Compose-generated image name unless explicitly tagged.
   - This caused the initial pull error for `esl-pipeline/batch-backend:local`.
   - Make the image naming/build dependency unambiguous before the next fresh host deploy.

8. Run final morning verification.
   - On VPS:
     - `curl -fsS https://esl-pipeline.run.place/api/health | jq .`
     - `curl -fsS https://esl-pipeline.run.place/api/meta/version | jq .`
     - `docker compose -p esl-pipeline-prod -f docker-compose.prod.yml ps`
     - `docker compose -p esl-pipeline-prod -f docker-compose.prod.yml logs --tail=80 batch-worker`
     - `docker compose -p esl-pipeline-prod -f docker-compose.prod.yml logs --tail=80 transcribe-worker`
   - Optional:
     - submit one small hosted assignment job and confirm worker completion.

## Purpose

Use this when your brain feels scattered and you want to restart without re-reading everything.
This is the "no-thinking required" re-entry path.

## The Only 4 Files You Need

1. `docs/playbooks/RESTART_TOMORROW.md` (this file)
2. `docs/reference/PRESET_V2_SPEC.md` (preset model truth)
3. `docs/reference/V1_IMPLEMENTATION_TRACKER.md` (what to do)
4. `docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md` (how to stay grounded)

If you open only these 4 files, you are back on track.

If you are touching backup operations, also open:

- `docs/operations/postgres-backup-s3.md` (daily/monthly scheduler + restore drill commands)

## 10-Minute Reboot (Do in Order)

1. Run `git status --short` and do not fix everything. Just observe.
2. Open `docs/reference/PRESET_V2_SPEC.md`.
3. Open `docs/reference/V1_IMPLEMENTATION_TRACKER.md`.
4. Find the active workstream and its `Now` task.
5. Pick exactly one micro-task that can fit in 30-90 minutes.
6. Write this sentence in your notes:
   - "Today I only need to finish: \_\_\_\_."

## Session Modes (Choose One, No Guilt)

### Mode 1: Low energy (15-30 min)

- Read tracker for 5 minutes.
- Pick one micro-task.
- Do only one small action:
  - update a TODO checkbox,
  - write one failing test,
  - add one API/type skeleton,
  - or clean one doc section.

Success condition: one concrete improvement exists in the repo.

### Mode 2: Normal energy (60-90 min)

- Complete one micro-task end-to-end.
- Update tracker status/evidence link.
- Add one line to "next first step" before stopping.

Success condition: one shippable unit is done.

### Mode 3: High energy (2-3 hours)

- Complete one full checklist block for active workstream.
- Run relevant tests.
- Update tracker + weekly template.

Success condition: one meaningful roadmap step is closed.

## What to Work on First (Default Priority)

When in doubt, always use this order:

1. The current `Today "Now" slice` in `docs/reference/V1_IMPLEMENTATION_TRACKER.md`
2. The current stabilization or readiness follow-through named in that tracker
3. The active plan README linked from `docs/plans/README.md` if the tracker points to a deeper workstream
4. Reliability-only follow-up if readiness metrics are red
5. Weekly review cleanup in `docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md` if you need a low-energy closeout

This order keeps the restart path aligned with the live tracker instead of a frozen workstream list.

Scope lock reminder:

- In this phase, ship `general-english` preset content only.
- Baseline homework method lives in
  `docs/reference/HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md`.
- The bootstrap seed template remains
  `docs/prompt-gallery/templates/hw_prompt_definitive.md`.

## Anti-Spiral Rules

1. No "perfect system" work before the next concrete deliverable.
2. No jumping workstreams unless blocked.
3. If stuck for 20 minutes:
   - write a "blocker note",
   - pick a smaller slice,
   - continue.
4. If two or more readiness metrics are red, run reliability-only work next session.

## End-of-Session Rule (2 Minutes)

Before stopping, write:

- What I finished:
- First step for next session:
- Current blocker (if any):

This is mandatory. It is your bridge back in tomorrow.

## Copy-Paste Daily Log Template

```md
## Session YYYY-MM-DD

Mode: low / normal / high
Workstream: WS\_\_
Today's one target:

Done:

-

Evidence link:

-

First step next session:

-

Blocker:

-
```

## Grounding Reminder

You are not trying to impress anyone with speed.
You are building a reliable tutor tool that saves real time and reduces chaos.
Small, consistent completions beat heroic bursts.

## Related

- `docs/reference/V1_IMPLEMENTATION_TRACKER.md`
- `docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md`
- `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`
