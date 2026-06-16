# Restart Tomorrow

## Current Handoff (2026-06-13)

- First external tutor test:
  - Hosted invite and basic assignment flow were usable enough for the first external test.
  - Several runtime gaps and UX blockers surfaced. Prioritize fixes below before the next invite
    wave.

- First step next session:
  - Check the active PR/branch contains every live hotfix that was applied on the VPS.
  - Do not recreate `batch-backend`, `batch-worker`, `batch-frontend`, or `caddy-edge` until the
    corresponding image/Compose/config fix is present.
  - Verify production state:

    ```bash
    curl -fsS https://esl-pipeline.run.place/api/health | jq .
    docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml ps
    docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml images
    docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml logs --tail=120 batch-worker
    docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml logs --tail=120 transcribe-worker
    docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml logs --tail=120 student-memory-worker
    ```

- P0 production/runtime blockers:
  - Add `student-memory-worker` to production Compose.
    - Current production stack does not include it.
    - Result: student memories and lesson memories are not created.
    - Use the same backend runtime image and `.env.batch-backend`.
    - Set a distinct `PG_APPLICATION_NAME`.
    - Command:
      - `node dist/transport/student-memory-worker.js`
    - Add health/log verification and include it in deploy smoke evidence.
  - Preserve live hotfixes in source before the next deploy:
    - `packages/batch-frontend/nginx.conf` must include:

      ```nginx
      resolver 127.0.0.11 ipv6=off valid=30s;
      ```

    - profile revision APIs must use query/body aliases instead of path-like profile IDs in the URL;
    - `scripts/deploy/deploy-prod-images.sh` should force-recreate `caddy-edge` when edge mode is
      enabled and assert the running Caddyfile contains `reverse_proxy batch-frontend:8080`;
    - `packages/batch-backend/Dockerfile` must create writable runtime dirs before `USER node`:

      ```dockerfile
      RUN mkdir -p /app/tmp /app/uploads \
          && chown -R node:node /app/tmp /app/uploads
      ```

    - `docker-compose.prod.yml` must mount VPS-local `.secrets` read-only for backend-image services
      that may touch Google STT/TTS:

      ```yaml
      - type: bind
        source: ./.secrets
        target: /app/secrets
        read_only: true
        bind:
          create_host_path: false
      ```

    - apply that mount to `batch-backend`, `batch-worker`, `student-memory-worker`, and
      `transcribe-worker`.
    - real credential file on VPS:
      - `/opt/esl-pipeline/.secrets/google-service-account.json`
    - container env expects:
      - `GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/google-service-account.json`

  - Remove the legacy pronunciation helper from runtime paths.
    - Keep pronunciation audio on ElevenLabs, Google, or Inworld.
    - Verify no runtime code path still depends on its old env or Docker setup.

- P1 product blockers before the next invite wave:
  - Redesign new student creation.
    - Current flow contains legacy paths that are unused, unclear, or broken.
    - Remove `.md`-file mental model from student creation and profile UX.
    - Student info is DB-only; path-like profile IDs no longer serve the product.
  - Finish new student profile UI fixes.
    - Frontend can show `not_found This learner profile has not been structured yet.` even after
      the profile works internally.
    - Student learning page can show `Current Revision Current` instead of `v1`, `v5`, etc.
    - Creating an empty profile then activating a draft can show both `not_found` and
      `Draft activated.`
    - Active profile versions should not show a `Restore` action.
    - Old student profile drafts should not surface in student overview.
  - Clean up tutor-facing UI copy and density.
    - Remove flavor text and instructional text that does not directly support a user action.
    - Remove duplicated instructions and repeated metadata.
    - Stop showing student support ID in multiple unrelated places.
    - Remove unused buttons and extra cards.
  - Wall off assignment templates from regular users.
    - Templates should be admin-only for now.
    - Hide regular-user routes/buttons/API affordances for template management.
  - Simplify assignment generation settings.
    - Replace provider/model/RPM/RPD/token UI with one `Generate assignment` action.
    - Keep a simple usage indicator later, e.g. `quota left: 5 assignments`, once the business model
      is decided.
    - Do not hide noisy expert settings under a spoiler for regular tutors.
  - Rename HTML/publishing language.
    - Replace `HTML pages` / `published HTML` with user-facing language such as
      `Assignment Handout`.
  - Change cancel UX.
    - Remove cancel reason field.
    - Put `Cancel` next to `Share assignment`.
    - Enable `Cancel` only while a job is underway.
  - Audio and publishing defaults.
    - Default voice engine should be `inworld`.
    - Remove reading style selector.
  - Schedule and billing defaults.
    - Add-lesson default date should be today, not the fixed `07.05.2026`.
    - Default duration and timezone should inherit from tutor settings.
    - If a homework assignment is added to a past lesson, mark the lesson completed automatically.
  - Profile candidate promotion queue.
    - Show new unapproved candidates.
    - Do not default the queue to approved candidates.

- P2 follow-up architecture/product work:
  - Revise audio caching.
    - Current behavior regenerates all audio if the draft changes by one character.
    - Desired default: reuse existing audio when audio-relevant text is unchanged, even if unrelated
      draft details changed after sharing.
    - Regenerate only audio parts whose source text changed.
    - The current `republish current draft` behavior is closer to the desired default.
    - Any audio regeneration should be explicit in the UI.
  - Rework Telegram bot for tutors instead of operators.
    - Operator mode is no longer a product goal.
    - Tutor bot should support tutor workflows, not host-machine operations.
  - Revisit invite registration polish after runtime blockers are fixed.
    - Invites worked for the first external test, but the earlier registration-flow mishap remains
      unexplored.

- Deployment state notes:
  - PR #96 deployed successfully at:
    - `dac03f3a6de34febeeca907436d0b6ddaf8c7148`
  - Later invited-tutor readiness deploy attempted:
    - `83b75a515453df708cb5d7ed4d81781db1d2369b`
  - That deploy pulled images, backed up Postgres to S3, verified migrations, and updated services,
    but failed before final deploy-state promotion during public edge smoke.
  - `/var/lib/esl-pipeline/deploy/current-images.env` may point at the earlier SHA even if
    containers are running newer images.
  - `.env.batch-backend` and `.secrets/google-service-account.json` are server-local and must not be
    overwritten by git.

- Generation model env note:
  - To disable assignment-generation budget/safety blockers on the VPS:

    ```bash
    GEN_SAFETY_MODE=off
    GEN_STRICT_NO_PAID=false
    GEN_ALLOW_PAID_SPEND=true
    ```

  - If using OpenRouter with `GEN_SAFETY_MODE=hard_stop`, do not leave these at zero:
    - `GEN_OPENROUTER_DAILY_TOKEN_BUDGET`
    - `GEN_OPENROUTER_DAILY_REQUEST_BUDGET`
    - `GEN_OPENROUTER_RPM_BUDGET`
  - Recreate backend after env changes.

## Purpose

Use this file to regain production/runtime context without re-reading recent chats.

## Active Chunk Map

The restart handoff has been separated into ordered work chunks in
[`docs/plans/2026-06-15-production-readiness-restart-chunks.md`](../plans/2026-06-15-production-readiness-restart-chunks.md).

Default next work:

1. Plan Chunk 1 only: production `student-memory-worker` enablement.
2. Implement Chunk 1 only after that plan is written and reviewed.
3. Do not pull unrelated P1/P2 UX work into the worker enablement branch.

## Core Files

1. `docs/playbooks/RESTART_TOMORROW.md` (this file)
2. `docs/reference/PRESET_V2_SPEC.md` (preset model truth)
3. `docs/reference/V1_IMPLEMENTATION_TRACKER.md` (roadmap status)
4. `docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md` (review notes)

If touching backup operations, also open:

- `docs/operations/postgres-backup-s3.md` (daily/monthly scheduler + restore drill commands)

## Restart Procedure

1. Run `git status --short`.
2. Open `docs/reference/PRESET_V2_SPEC.md`.
3. Open `docs/reference/V1_IMPLEMENTATION_TRACKER.md`.
4. Check the current handoff above for active production blockers.
5. Pick one task from the highest-priority active section.
6. Record the next stopping point before ending the session.

## What to Work on First (Default Priority)

1. The current `Today "Now" slice` in `docs/reference/V1_IMPLEMENTATION_TRACKER.md`
2. The current stabilization or readiness follow-through named in that tracker
3. The active plan README linked from `docs/plans/README.md` if the tracker points to a deeper workstream
4. Reliability-only follow-up if readiness metrics are red
5. Weekly review cleanup in `docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md`

This order keeps the restart path aligned with the live tracker instead of a frozen workstream list.

Scope lock:

- In this phase, ship `general-english` preset content only.
- Baseline homework method lives in
  `docs/reference/HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md`.
- The bootstrap seed template remains
  `docs/prompt-gallery/templates/hw_prompt_definitive.md`.

## Scope Rules

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

## Related

- `docs/reference/V1_IMPLEMENTATION_TRACKER.md`
- `docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md`
- `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`
