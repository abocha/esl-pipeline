# Batch System Guide (Active)

## Meta

- Audience: AI agents and maintainers for batch frontend/backend tasks.
- Read Time: 4 minutes.
- Authority Level: Active system map.
- Last Verified Against: 2026-10-11 native assignment, transcript completion and profile review audit.
- Owner: backend/frontend maintainers + automation agents.
- Review Cadence: monthly or after major batch workflow changes.
- Status: `active`.

## Purpose

Provide the batch architecture and user-flow map. Use package READMEs for implementation detail and
[`backend-frontend-alignment.md`](backend-frontend-alignment.md) for capability status.

## Canonical Sources

1. [`docs/reference/agents-ssot.md`](../reference/agents-ssot.md)
2. [`packages/batch-backend/README.md`](../../packages/batch-backend/README.md)
3. [`packages/batch-frontend/README.md`](../../packages/batch-frontend/README.md)
4. [`docs/backend-frontend/backend-frontend-alignment.md`](backend-frontend-alignment.md)

## Architecture

```text
Batch Frontend (React + Vite)
  -> Batch Backend (Fastify + Postgres + Redis/BullMQ)
     -> batch-worker / transcribe-worker / student-memory-worker
     -> Orchestrator (validate/import/plan/TTS/upload/manifest)

Telegram Ops Bot -> authenticated Batch Backend ops/job APIs
```

The backend owns durable sessions, jobs, lineage, queues, and student-memory state. The frontend owns
the authenticated five-step interaction and recovery presentation; the backend owns confirmation
prerequisites, lineage, stable share reservation/retry, and the completed predicate. The frontend and
Telegram bot are operator surfaces; neither owns alternate workflow or pipeline semantics.

## Assignment Flow

1. **Student:** start new work or resume a recent assignment, then select/confirm the learner.
2. **Lesson source:** upload a supported recording or paste an existing transcript. Ordinary media
   uses backend probe/allowlist policy and automatic STT recovery; manual transcripts retain explicit
   `manual_transcript`/`manual` provenance and do not enqueue STT.
3. **Teaching context:** review learner context and enter assignment-specific guidance.
4. **Create:** generate and edit the prompt-backed assignment draft.
5. **Review & share:** preview, approve, publish, and open the handout.

Sharing completes an immutable assignment session. A tutor can explicitly enter correction mode to
edit the mutable working draft; **Publish corrected version** snapshots the exact saved draft into a
child job and executes the normal assignment pipeline. Historical rerun and **Republish published
version** for supported native assignments remain separate Advanced actions: reruns create `source_job_id` children, while republish
and selected study-text or pronunciation regeneration remain job actions rather than assignment-flow
steps. Starting another assignment is always an explicit tutor action; asynchronous readiness changes
do not navigate steps.

Historical Markdown/renderer-1 jobs remain readable but cannot rerun, republish, correct or create
new memory extractions. Native AssignmentV1 preview and publication share `learner-handout`;
previously materialized historical observations remain usable only under verified memory lineage.

For no-homework lessons, explicit **Review & finish** confirms the exact source and records current
transcript completion. Completed transcripts appear in student History; **Create homework** clears
current completion and returns the retained source to Teaching context. Memory processing continues
without inventing a Share job or changing lesson billing.

## Runtime Boundaries

- Prompt templates and profiles are revisioned in Postgres; bootstrap tooling seeds fresh
  environments.
- The orchestrator remains the canonical publish engine after backend approval handoff.
- `batch-worker` handles ordinary pipeline jobs; `transcribe-worker` handles STT;
  `student-memory-worker` exclusively consumes lesson-memory, homework-memory, and snapshot work.
- Job and recording events use targeted SSE subscriptions backed by Redis fanout. Wildcard streams
  are explicit rather than the frontend default.
- Study-text synthesis passes through provider-neutral voice and speech plans before TTS.

## API and Operations Routes

- Auth, recordings, transcripts, sessions, jobs, prompts, drafts, students, and ops routes:
  [`packages/batch-backend/README.md`](../../packages/batch-backend/README.md)
- Operations routing and current runbooks: [`docs/operations/README.md`](../operations/README.md)
  and [`docs/reference/DOCS_IA_MAP.md`](../reference/DOCS_IA_MAP.md)
- Generated route inventory:
  [`docs/generated/backend-route-index.md`](../generated/backend-route-index.md)
- Student-memory replay/backfill:
  [`docs/operations/student-memory-replay-backfill.md`](../operations/student-memory-replay-backfill.md)
- Prompt bootstrap: [`docs/operations/prompt-gallery-bootstrap.md`](../operations/prompt-gallery-bootstrap.md)
- Speech/TTS contract:
  [`docs/reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md`](../reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md)
- Deployment and worker verification: [`docs/backend-frontend/DEPLOYMENT.md`](DEPLOYMENT.md)

## Rules

- Do not bypass orchestrator or contracts-package boundaries.
- Do not invent frontend-only durable state or backend-only alternate pipeline semantics.
- Update this map, the alignment tracker, and touched package README together when the shared flow
  or service topology changes.
