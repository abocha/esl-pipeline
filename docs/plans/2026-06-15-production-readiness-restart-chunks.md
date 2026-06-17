# Production Readiness Restart Work Chunks

## Meta

- Audience: founder-maintainer, Codex, implementation agents, deployment agents.
- Status: active.
- Last Verified Against: 2026-06-17 repo state.
- Exit Trigger: archive after the restart backlog is converted into shipped implementation PRs or superseded by the next invite-wave readiness plan.
- Current Focus: finish Chunk 5 P1 tutor assignment creation and publishing UX.

## Purpose

Turn the restart handoff into a small set of independently plannable work chunks. This document is
not an implementation plan yet; it is the intake map for the next implementation plans.

Chunks 1 and 2 have been implemented. The current implementation plan adds Chunks 3 and 9 plus a
design-only Chunk 10 note on the same readiness branch.

## Priority Order

1. Chunk 1: enable `student-memory-worker` in production.
2. Chunk 2: preserve and verify live production hotfixes in source.
3. Chunk 3: remove the legacy pronunciation helper from runtime images.
4. Chunk 4: repair new-student and profile revision UX correctness.
5. Chunk 5: simplify tutor assignment creation and publishing controls.
6. Chunk 6: fix scheduling, billing, and candidate queue defaults.
7. Chunk 7: fix pronunciation source text, then improve audio caching and explicit regeneration.
8. Chunk 8: re-scope Telegram and invite-registration follow-up.
9. Chunk 9: reduce deployment env friction for Caddy edge commands.
10. Chunk 10: improve student-memory generation throughput and prompt quality.
11. Chunk 11: split PR validation from production image publishing workflows.

## Chunk 1: Production Student-Memory Worker

Priority: P0.

Goal: production must run `student-memory-worker` so lesson memories, homework memories, and student
memory snapshots are created after normal tutor activity.

Why first: the backend already has student-memory queue, worker, replay, and inspection surfaces, but
the production Compose stack in this branch does not run `student-memory-worker`. That leaves a core
student-memory feature inert in production.

Likely files to inspect or modify in the implementation plan:

- `docker-compose.prod.yml`
- `docs/backend-frontend/DEPLOYMENT.md`
- `docs/operations/student-memory-replay-backfill.md`
- `docs/backend-frontend/BATCH_SYSTEM.md`
- `packages/batch-backend/src/transport/student-memory-worker.ts`
- `packages/batch-backend/src/infrastructure/student-memory-queue.ts`
- `packages/batch-backend/package.json`
- deployment smoke/evidence docs selected for the release

Implementation boundaries:

- Add a production Compose service named `student-memory-worker`.
- Use the same backend runtime image as `batch-backend` and `batch-worker`.
- Load `.env.batch-backend`.
- Set a distinct `PG_APPLICATION_NAME`, for example `esl-pipeline-student-memory-worker`.
- Use command `node dist/transport/student-memory-worker.js`.
- Use Redis and Postgres dependencies consistent with other backend workers.
- Mount runtime uploads and server-local `.secrets` only if required by the worker's provider paths.
- Add production status/log verification to deployment smoke evidence.
- Do not redesign the student-memory architecture in this chunk.

Acceptance gates:

- Production Compose config includes `student-memory-worker`.
- Production deploy smoke includes `student-memory-worker` status and logs.
- A hosted tutor flow or targeted replay proves at least one lesson/homework memory job can be
  processed by the worker.
- The student memory inspection surface shows new or refreshed memory data for the verified student.
- Documentation names the worker in the production runtime model and replay/repair expectations.

Suggested validation for the future implementation plan:

```bash
pnpm docker:prod:config
pnpm --silent run check:fast:agent
pnpm docs:generate:indexes
pnpm docs:check
```

Hosted smoke evidence should include bounded production commands equivalent to:

```bash
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml ps student-memory-worker
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml logs --tail=120 student-memory-worker
```

## Chunk 2: Production Hotfix Source Parity

Priority: P0.

Goal: make sure every live VPS hotfix required for the next deploy exists in source before any
service is recreated.

Items from the restart handoff:

- Frontend nginx resolver must include `resolver 127.0.0.11 ipv6=off valid=30s;`.
- Profile revision APIs must avoid path-like profile IDs in URLs by using query/body aliases.
- `scripts/deploy/deploy-prod-images.sh` must force-recreate `caddy-edge` when edge mode is enabled.
- The deploy script must assert the running Caddyfile contains `reverse_proxy batch-frontend:8080`.
- `packages/batch-backend/Dockerfile` must create writable `/app/tmp` and `/app/uploads` before
  `USER node`.
- Production Compose backend-image services that may touch Google STT/TTS must mount VPS-local
  `.secrets` read-only.
- The real credential path remains server-local:
  `/opt/esl-pipeline/.secrets/google-service-account.json`.
- Container env expects `GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/google-service-account.json`.

Implementation boundaries:

- Treat this as source parity and verification first; some items may already be present.
- Do not overwrite `.env.batch-backend` or `.secrets` from git.
- Do not recreate `batch-backend`, `batch-worker`, `batch-frontend`, `caddy-edge`, or new
  `student-memory-worker` until the corresponding source and Compose fixes are present.

Acceptance gates:

- Each hotfix has source evidence or a documented "already present" note.
- Production Compose remains pull-based and SHA-image driven.
- Deployment smoke covers edge routing, backend health, worker logs, and image refs.

Source evidence:

- `packages/batch-frontend/nginx.conf` already contains
  `resolver 127.0.0.11 ipv6=off valid=30s;`.
- `packages/batch-frontend/src/utils/api.profile-routes.test.ts` verifies path-like profile IDs use
  query/body aliases for profile revision routes, and
  `packages/batch-backend/src/transport/extended-routes/profiles-templates-routes.ts` accepts those
  aliases while keeping legacy path routes.
- `scripts/deploy/deploy-prod-images.sh` force-recreates `caddy-edge` when edge mode is enabled and
  asserts the running Caddyfile contains `reverse_proxy batch-frontend:8080`; this is covered by
  `scripts/deploy/deploy-prod-images.test.mjs`.
- `packages/batch-backend/Dockerfile` creates and chowns `/app/tmp` and `/app/uploads` before
  `USER node`; this is covered by `scripts/docker/backend-dockerfile-runtime.test.mjs`.
- `docker-compose.prod.yml` mounts server-local `./.secrets` read-only at `/app/secrets` and sets
  `GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/google-service-account.json` for `batch-backend`,
  `batch-worker`, `student-memory-worker`, and `transcribe-worker`; this is covered by
  `scripts/docker/prod-compose-config.test.mjs`.

## Chunk 3: Remove Legacy Pronunciation Helper Runtime

Priority: P0.

Goal: remove unused legacy pronunciation-helper dependencies from runtime images without breaking
supported provider pronunciation audio paths.

Items from the restart handoff:

- Remove the legacy helper, Python venv setup, and related env from Docker runtime images.
- Verify no runtime path still depends on old helper env or provider values.

Implementation boundaries:

- This chunk removes the helper from production, development, orchestrator, backend, frontend, and
  contract surfaces.
- Keep supported production TTS providers explicit: ElevenLabs, Google, and Inworld.
- Do not combine this with broad audio UX simplification unless the implementation is tiny and
  validation stays focused.

Acceptance gates:

- Runtime images no longer install the legacy helper.
- Tests or source inspection prove publish paths use only supported provider TTS.
- Documentation and env references no longer imply a separate helper runtime is available.

Source evidence:

- Backend and orchestrator Dockerfiles keep ffmpeg in runtime stages and remove the legacy helper
  setup.
- `scripts/check/no-legacy-pronunciation-helper.test.mjs` verifies the removed integration is not
  present in tracked source or docs.
- Env examples and production docs document ElevenLabs, Google, and Inworld as the supported audio
  provider paths.

## Chunk 4: New Student and Profile UX Correctness

Priority: P1.

Goal: make new student creation and profile revision UX reliable enough for real tutors.

Items from the restart handoff:

- Redesign new student creation around DB-only student info.
- Remove `.md`-file mental model from student creation and profile UX.
- Fix `not_found This learner profile has not been structured yet.` after profile data exists.
- Fix `Current Revision Current` display so it shows actual versions such as `v1` or `v5`.
- Prevent empty-profile activation from showing both `not_found` and `Draft activated.`
- Hide `Restore` on active profile versions.
- Hide old profile drafts from student overview.

Implementation boundaries:

- Keep foundational profile revisions canonical.
- Do not silently change profile DTOs or revision semantics.
- Prefer a narrow profile/new-student implementation plan before touching UI broadly.

Acceptance gates:

- A tutor can create a student, see an understandable profile state, activate a draft, and view the
  correct active revision without contradictory messages.
- Student overview shows only useful current state for normal tutors.

## Chunk 5: Tutor Assignment Creation and Publishing UX

Priority: P1.

Goal: remove expert/admin clutter from normal tutor assignment generation and publishing.

Items from the restart handoff:

- Clean up tutor-facing copy and density.
- Remove duplicated instructions, repeated metadata, extra cards, unused buttons, and repeated
  support ID display.
- Wall off assignment templates from regular users.
- Replace provider/model/RPM/RPD/token controls with one normal-tutor `Generate assignment` action.
- Rename `HTML pages` / `published HTML` to user-facing language such as `Assignment Handout`.
- Remove cancel reason field.
- Put `Cancel` next to `Share assignment`.
- Enable `Cancel` only while a job is underway.
- Default voice engine should be `inworld`.
- Remove reading style selector.

Implementation boundaries:

- Keep admin/operator affordances available only where explicitly needed.
- Do not hide complex normal-user settings behind a spoiler; remove them from the normal tutor path.
- Preserve backend capabilities while simplifying default frontend exposure.

Acceptance gates:

- Normal tutor flow is one clear generation path with no provider/budget jargon.
- Template management is not reachable by regular users.
- Publishing language and cancel behavior match the tutor-facing product model.

Source evidence:

- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx` presents one
  tutor-facing `Generate assignment` action, hides template/provider/quota/audio model selectors,
  uses `Assignment Handout` copy, and places `Cancel` beside `Share assignment`.
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.authoring.ts` keeps template,
  provider, model, and TTS defaults internal while defaulting publishing audio to Inworld and using
  tutor-facing generation errors.
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.advanced.tsx` removes the public cancel
  reason field while keeping advanced rerun/support tools behind the advanced actions section.
- Targeted frontend tests assert hidden template/provider/quota/audio controls, one-button
  assignment generation, Inworld publish defaults, cancel-without-reason behavior, and resume/publish
  copy using the Assignment Handout model.

## Chunk 6: Schedule, Billing, and Candidate Queue Defaults

Priority: P1.

Goal: fix default values and queue visibility that currently create avoidable tutor friction.

Items from the restart handoff:

- Add-lesson default date should be today, not fixed to `07.05.2026`.
- Default duration and timezone should inherit from tutor settings.
- If homework is added to a past lesson, mark the lesson completed automatically.
- Profile candidate promotion queue should show new unapproved candidates.
- The candidate queue should not default to approved candidates.

Implementation boundaries:

- Keep schedule/billing behavior aligned with `docs/reference/SCHEDULE_BILLING_PRODUCT_DECISIONS.md`.
- Do not change payment or package accounting beyond the listed defaults.

Acceptance gates:

- New lesson defaults match tutor settings and current date.
- Past-lesson homework creates the expected completed lesson state.
- Candidate review starts with actionable unapproved candidates.

## Chunk 7: Pronunciation Source Text, Audio Caching, and Explicit Regeneration

Priority: P1 for pronunciation source-text correctness; P2 for broader caching and regeneration
ergonomics.

Goal: make pronunciation audio read the tutor/student-facing text, then avoid regenerating all audio
when draft edits do not change audio-relevant source text.

Items from the restart handoff:

- In homework assignment pronunciation mode, `connected_speech` tasks should synthesize the normal
  written phrase from the left side of the task, not the pseudo-transcription/right-side analysis.
- Current pronunciation chunks can be generated from rough pseudo-transcription such as
  `ə-tuft-uv-feathers`, which makes provider TTS read broken audio. The intended spoken source is
  normal orthography such as `a tuft of feathers`.
- Reuse existing audio when audio-relevant text is unchanged.
- Regenerate only audio parts whose source text changed.
- Make audio regeneration explicit in the UI.
- Treat current `republish current draft` behavior as closer to the desired default.

Implementation boundaries:

- First isolate the pronunciation item data model and renderer contract for left-side display text
  versus right-side pronunciation guidance/transcription.
- Do not discard the right-side pronunciation guidance; keep it visible/usable for the learner while
  selecting the normal written phrase as the TTS source.
- This is architecture/product work and should not block Chunk 1 through Chunk 6.
- Plan from orchestrator manifest and rerun-family contracts before implementation.

Acceptance gates:

- `connected_speech` pronunciation chunks use normal written phrase text for TTS.
- Pseudo-transcription or pronunciation guidance can appear in the homework UI, but is not used as
  the provider synthesis input unless a future mode explicitly requires phonetic reading.
- Tests cover a representative connected-speech item, e.g. left side `a tuft of feathers` and right
  side `ə-tuft-uv-feathers`, proving the generated audio request uses the left side.
- Minor non-audio draft edits do not force full audio regeneration.
- Audio-affecting edits regenerate only the relevant artifacts.
- UI clearly separates republish from regenerate-audio behavior.

Source evidence for P1 source-text correctness:

- `packages/orchestrator/src/runtime/pronunciation-audio.ts` selects the connected-speech
  `careful` phrase as the provider TTS text for item clips and falls back to the connected guidance
  only when no careful phrase is available.
- `packages/orchestrator/tests/runtime.pronunciation-audio.test.ts` covers the representative
  `a tuft of feathers` / `ə-tuft-uv-feathers` case and proves provider TTS receives the normal
  written phrase.
- `packages/html-publisher/tests/rendering.pronunciation-behavior.test.ts` keeps the same
  pseudo-respelling visible as learner-facing connected-speech guidance.
- The P2 caching and explicit regeneration items remain open; do not treat this P1 source-text fix
  as completion of the broader Chunk 7 regeneration scope.

## Chunk 8: Telegram and Invite Registration Follow-Up

Priority: P2.

Goal: defer non-critical follow-up until production runtime and tutor invite blockers are stable.

Items from the restart handoff:

- Rework Telegram bot around tutor workflows instead of operator mode.
- Revisit invite registration polish after runtime blockers are fixed.

Implementation boundaries:

- Do not spend next-invite-wave time on Telegram operator surfaces unless they block production
  support.
- Treat invite polish as investigation until a specific tutor-facing defect is reproduced.

Acceptance gates:

- A later product plan defines tutor bot workflows or removes them from near-term scope.
- Invite registration polish has concrete reproduction notes before implementation.

## Chunk 9: Caddy Edge Deploy Env Ergonomics

Priority: P2.

Goal: stop requiring operators to manually export Caddy edge env values before every
`scripts/deploy/deploy-prod-images.sh` run when those values already exist in the server-local
`.env.batch-backend`.

Observed during the successful 2026-06-15 production upgrade:

```bash
export CADDY_PUBLIC_HOSTNAME=esl-pipeline.run.place
export CADDY_ACME_EMAIL=abocha.true@gmail.com
```

The values are already present in `.env.batch-backend`, but the deploy path still requires them in
the shell environment for edge validation/deploy commands.

Implementation boundaries:

- Keep `.env.batch-backend` server-local and uncommitted.
- Do not duplicate real production values into committed docs or Compose defaults.
- Prefer a small deploy-script or validator change that can safely read the existing server-local env
  file when running on the VPS.
- Preserve local validation behavior for placeholder/example edge env values.

Acceptance gates:

- Running the deploy script from `/opt/esl-pipeline` can reuse `CADDY_PUBLIC_HOSTNAME` and
  `CADDY_ACME_EMAIL` from `.env.batch-backend` when they are not exported.
- Explicit shell exports still override file values.
- The edge env validator still rejects missing, malformed, local-only, or URL-like hostnames.
- Docs explain whether the source of truth is shell env, `.env.batch-backend`, or both.

Source evidence:

- `scripts/deploy/deploy-prod-images.sh` parses only `CADDY_PUBLIC_HOSTNAME` and
  `CADDY_ACME_EMAIL` from `${APP_DIR}/.env.batch-backend` when edge mode is enabled and shell
  exports are absent.
- `scripts/deploy/deploy-prod-images.test.mjs` verifies the env-file fallback, shell-export
  precedence, and validation ordering.
- Deployment docs state that pnpm edge validation commands still need current-process exports, while
  the VPS deploy script can reuse the server-local batch backend env file.

## Chunk 10: Student-Memory Generation Throughput and Prompt Quality

Priority: P2.

Goal: make background student-memory generation more resilient to backlog bursts and improve the
quality/cost shape of memory extraction requests.

Observed during the 2026-06-15 production upgrade:

- Student-memory requests using `gpt-5.4-mini` hit the Tier 1 `200k` TPM limit while clearing a
  backlog.
- Normal student-memory work is background and not time-sensitive, so queue latency is acceptable.
- The OpenAI `v1/batch` endpoint may be a better fit for backlog replay or other non-urgent memory
  extraction work.
- Prompt tuning and more structured requests are worth exploring for student-memory extraction.

Implementation boundaries:

- Treat this as exploration before implementation; verify current OpenAI Batch API constraints,
  model support, request format, result polling, and error handling before designing code.
- Keep normal online assignment generation separate from async memory extraction.
- Preserve deterministic backend ownership of what memory inputs are selected.
- Do not make prompt packages depend on immediate completion of background memory jobs.
- Consider rate-limit-aware throttling/backoff even if Batch API is adopted for backlog work.

Acceptance gates:

- A short design note compares the existing worker path, rate-limit-aware worker throttling, and
  OpenAI Batch API for backlog memory generation.
- The design states when to use normal queue processing versus batch submission.
- Prompt/request changes are measured against structured output quality, token use, replayability,
  and provenance.
- Operators have a safe replay/backfill path that does not stampede Tier 1 TPM limits.

Source evidence:

- `docs/plans/2026-06-16-student-memory-throughput-design-note.md` captures the design-only
  recommendation and Batch API constraints to verify before implementation.

## Chunk 11: PR Validation and Production Image Publishing Workflow Split

Priority: P2.

Goal: avoid duplicate CI work by running validation on PRs and publishing production container
images only after merge to `main`.

Observed after the first successful production image deploys:

- Production container images should be built/pushed only from trusted merged `main` commits, not
  from PR branches.
- The full CI suite should run on PRs, where it gates review and merge.
- After a PR has passed CI and merged, the `main` workflow should not rerun the whole suite just to
  prove the same merge content again; it should focus on release/image publication and any minimal
  post-merge guards needed for safety.
- The existing release bot is part of this flow: `.github/workflows/release-on-merge.yml` runs after
  a PR merges, resolves the release label, commits `chore(release): vX.Y.Z` to `main`, and pushes
  tag `vX.Y.Z`.
- Production image publishing must account for that bot-authored version bump so image metadata,
  tags, release notes, and deployable SHAs do not drift.

Implementation boundaries:

- Keep PR validation comprehensive enough to protect `main`.
- Decide explicitly whether production images are built from the original merged PR SHA, the
  bot-authored `chore(release)` SHA, or the release tag; prefer the release bot commit/tag unless
  there is a concrete reason deploys must target the pre-release merge SHA.
- Keep production image publication tied to immutable SHAs/tags, not mutable branch names.
- Preserve release-label and release-on-merge behavior.
- Before changing workflows, inspect `.github/workflows/ci.yml`,
  `.github/workflows/release-on-merge.yml`, image build/push jobs, and any deployment consumers of
  GHCR tags.
- Prevent the release bot's `main` push from causing a duplicate full validation run. If a
  post-merge workflow is still needed, scope it to release/image safety checks and image
  publication.
- Do not weaken required PR checks; this chunk is about event routing and avoiding duplicate
  post-merge work, not reducing PR confidence.

Acceptance gates:

- PR workflows run validation but do not publish production runtime images.
- Merge-to-`main` or release-tag workflows publish production images only after the release bot has
  either completed or been deliberately bypassed by documented design.
- Production image tags/labels make it clear whether the deployable image corresponds to the
  original merge SHA, the bot-authored release commit SHA, or the release tag.
- The release bot's `chore(release)` push does not rerun the full PR validation suite.
- Required checks and release label guards still protect PRs before merge.
- Deployment docs or release notes explain which workflow creates production images and when.

Source evidence:

- `.github/workflows/ci.yml` runs validation only on PR events and no longer builds or publishes
  production container images.
- `.github/workflows/release-on-merge.yml` publishes production images only after `Release On Merge`
  completes the bot-authored release commit and tag push; this avoids relying on a tag-push workflow
  that would not be triggered by the release job's `GITHUB_TOKEN`.
- Production images are tagged with both the release commit SHA and release tag; the deploy script
  continues to consume the release commit SHA.
- `docs/backend-frontend/DEPLOYMENT.md` documents the PR CI -> release bot -> release-tag image
  publication -> VPS deploy sequence.

## Deployment State Notes to Preserve

These notes are operational context, not a standalone implementation chunk:

- PR #96 deployed successfully at `dac03f3a6de34febeeca907436d0b6ddaf8c7148`.
- Later invited-tutor readiness deploy attempted
  `83b75a515453df708cb5d7ed4d81781db1d2369b`.
- That deploy pulled images, backed up Postgres to S3, verified migrations, and updated services,
  but failed before final deploy-state promotion during public edge smoke.
- `/var/lib/esl-pipeline/deploy/current-images.env` may point at the earlier SHA even if containers
  are running newer images.
- `.env.batch-backend` and `.secrets/google-service-account.json` are server-local and must not be
  overwritten by git.

## Generation Model Env Notes to Preserve

These notes are operator context, not repo defaults:

```bash
GEN_SAFETY_MODE=off
GEN_STRICT_NO_PAID=false
GEN_ALLOW_PAID_SPEND=true
```

If using OpenRouter with `GEN_SAFETY_MODE=hard_stop`, do not leave these at zero:

```bash
GEN_OPENROUTER_DAILY_TOKEN_BUDGET
GEN_OPENROUTER_DAILY_REQUEST_BUDGET
GEN_OPENROUTER_RPM_BUDGET
```

Recreate backend services after production env changes.

## Next Step

After this readiness PR lands, start Chunk 4 as a separate product/UX correctness branch. Treat any
student-memory Batch API implementation as a later Chunk 10 implementation branch after the design
note is reviewed.
