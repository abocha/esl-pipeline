# Backend–Frontend Alignment Plan (Batch System)

This document captures the gaps between the new batch frontend (Phase 7/8 UI) and the existing batch-backend implementation, along with the concrete steps needed to bring the backend up to speed.

---

## Current Mismatch

- Frontend now expects:
  - A real SSE endpoint (`GET /jobs/events`) that streams `job_state_changed` events.
  - A `/config/job-options` endpoint to populate presets, voice accents, Notion DBs, upload options, and (soon) dialogue/monologue modes.
  - Job status payloads that include extra metadata (`preset`, `voiceAccent`, `notionDatabase`, `notionUrl`, `runMode`, etc.).
  - Fully functional `/auth/*`, `/uploads`, `/jobs` routes with the extended API enabled.
- Backend currently:
  - Returns `501` for `/jobs/events`.
  - Lacks `/config/job-options`.
  - Stores only `md`, `preset`, `withTts`, `upload` on the job; no fields for voice, notion DB, run mode, or Notion links.
  - Emits no events when job states change.

---

## Required Backend Work

### 1. Implement Job Event Bus + SSE

1. **Event bus module**
   - Create `packages/batch-backend/src/domain/job-events.ts`:
     ```ts
     import { EventEmitter } from 'node:events';
     export type JobEventType = 'job_created' | 'job_state_changed';
     export interface JobEvent { type: JobEventType; job: JobRecord; }
     export function publishJobEvent(event: JobEvent): void;
     export function subscribeJobEvents(listener: (event: JobEvent) => void): () => void;
     ```
   - Use a single `EventEmitter` instance (`setMaxListeners(0)` to avoid warnings).

2. **Emit events**
   - In `submitJob`: after `insertJob`, emit `{ type: 'job_created', job }`.
   - In `processQueueJob`:
     - After the queued → running transition, emit `{ type: 'job_state_changed', job: runningRecord }`.
     - After success/failure updates, emit with the returned record from `updateJobStateAndResult`.

3. **Shared job DTO helper**
   - Add `packages/batch-backend/src/application/job-dto.ts` with `jobRecordToDto(job: JobRecord): GetJobStatusResponse`.
   - Update `getJobStatus` to use this helper so SSE and HTTP responses share the same serialization.

4. **Real `/jobs/events` route**
   - In `http-server.ts`, replace the placeholder with an SSE implementation:
     - Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
     - Subscribe to the event bus; on each event, write:
       ```
       event: job_state_changed
       data: {...serialized job...}

       ```
     - Send periodic heartbeats (e.g., `:\n\n`) to keep proxies from timing out.
     - On connection close, unsubscribe and clear any heartbeat timers.
   - Decide whether SSE requires authentication (frontend currently sends cookies). If yes, reuse the existing auth middleware.

### 2. `/config/job-options` Endpoint

- Add a handler (e.g., `app.get('/config/job-options', authenticate, ...)`) when the extended API flag is on.
- Response shape:
  ```json
  {
    "presets": ["b1-default"],
    "voiceAccents": ["american_female", "british_male"],
    "notionDatabases": [
      { "id": "uuid1", "name": "B1 Lessons" },
      { "id": "uuid2", "name": "B2 Lessons" }
    ],
    "uploadOptions": ["auto", "s3", "none"],
    "modes": ["auto", "dialogue", "monologue"]
  }
  ```
- Until the orchestrator branch merges the new modes, return `"modes": ["auto"]` and let the frontend disable the selector.
- Voice accent list can come from env/config (match whatever the orchestrator uses for ElevenLabs voices).

### 3. Job Schema Extensions (Upcoming)

To fully support the new UI controls, plan for:

- **Schema changes** (`schema.sql`, `JobRecord`, `insertJob`, etc.):
  - Add columns: `voice_accent`, `force_tts`, `notion_database`, `mode`, `notion_url`.
  - Update DTO/helper + SSE payload to include these fields.
  - Persist `notion_url` once the orchestrator returns it.
- **Submit job payload**:
  - Accept and forward the new fields (`voiceAccent`, `forceTts`, `notionDatabase`, `mode`).
- **Audio regeneration endpoint** (future):
  - Backend should expose something like `/jobs/:jobId/rerun/audio` so the frontend’s “Regenerate audio” button can work once the new TTS module is merged.

These schema updates can follow after SSE is working; just keep the plan documented.

---

## Implementation Order

1. **SSE infrastructure** (event bus + `/jobs/events` route) — unblocks frontend live updates.
2. **/config/job-options** — lets frontend populate dropdowns without hardcoding.
3. **Job DTO refactor** — ensures both SSE and `/jobs/:id` return consistent metadata.
4. **Schema/field expansion** — necessary for advanced settings and Notion link copying.
5. **Audio rerun endpoint** — once the orchestrator supports it.

---

## Backend Implementation Plan (Phase-Based)

Each phase is sized so a junior developer can complete it in a focused session. Work through them sequentially.

### Phase 1 – Job Event Bus Scaffolding
1. Create `src/domain/job-events.ts` with a shared `EventEmitter` as described above.
2. Export helpers: `publishJobEvent`, `subscribeJobEvents`.
   - Import `JobRecord` from [`domain/job-model`](../../packages/batch-backend/src/domain/job-model.ts) so the event payload is typed.
   - Instantiate the emitter once (`const jobEventEmitter = new EventEmitter(); jobEventEmitter.setMaxListeners(0);`) and keep it module-local so every caller shares the same bus.
   - `subscribeJobEvents` should attach the listener via `on`, return a disposer that calls `off`, and never swallow listener errors (let Fastify’s request scope handle them).
3. Add unit tests (or simple assertions) to ensure listeners receive events and unsubscribe correctly.
   - Place them alongside the other Vitest suites in `packages/batch-backend/tests/domain.job-events.test.ts`.
   - Cover at least: (a) a listener receives both `job_created` and `job_state_changed`, (b) calling the disposer stops further events, and (c) publishing with no listeners is a no-op (no thrown errors).

_Deliverable_: Backend can publish/subscribe to in-memory job events (even though no emitters exist yet), and Vitest exercises both listener delivery and cleanup semantics.

---

### Phase 2 – Emit Events from Application Services
1. Wire `submitJob` (`packages/batch-backend/src/application/submit-job.ts`) into the event bus.
   - Import `publishJobEvent` from the new domain module.
   - Immediately after `insertJob` resolves, call `publishJobEvent({ type: 'job_created', job })`.
   - Keep the payload exactly what `insertJob` returned so timestamps (`createdAt`, `updatedAt`) flow through without additional queries.
2. Extend `processQueueJob` (`packages/batch-backend/src/application/process-queue-job.ts`) to publish lifecycle updates.
   - After `updateJobStateAndResult` marks the job `running`, emit `{ type: 'job_state_changed', job: running }`.
   - Capture the `JobRecord` returned by the success/failure updates and emit the same event structure (this ensures SSE clients see manifest path + finished timestamps).
   - When `updateJobStateAndResult` returns `null` (race conditions), skip publishing so we don’t leak stale data.
3. Tests:
   - Add or extend Vitest suites (`packages/batch-backend/tests/application.submit-job.test.ts` and `...process-queue-job.test.ts`) to stub the job event module (e.g., using `vi.spyOn`).
   - Assert that `submitJob` emits one `job_created`, and `processQueueJob` emits transitions in the right order (`running` then terminal state).

_Deliverable_: Event bus fires whenever a job is created or its state changes, with coverage in the existing application-level tests.

---

### Phase 3 – Shared Job DTO Helper
1. Create `packages/batch-backend/src/application/job-dto.ts` with:
   - `export interface JobStatusDto` (superset of the current HTTP response, e.g., include `md`, `preset`, `withTts`, `upload` to prep for frontend metadata).
   - `export function jobRecordToDto(job: JobRecord): JobStatusDto` that handles ISO date serialization and `null` normalization.
2. Refactor `getJobStatus` to import `jobRecordToDto`.
   - Function now becomes: fetch record → `return job ? jobRecordToDto(job) : null`.
   - Re-export `JobStatusDto`/`jobRecordToDto` from `application/index.ts` (or directly import where needed) so later phases (SSE) reuse it without duplicating shape.
3. Update tests:
   - Move serialization assertions into a new `packages/batch-backend/tests/application.job-dto.test.ts`.
   - Keep `application.get-job-status.test.ts` focused on repository interactions by mocking `jobRecordToDto` or snapshotting the helper output.

_Deliverable_: Single source of truth for job serialization, with targeted tests that lock the DTO shape for both HTTP and SSE consumers.

---

### Phase 4 – `/jobs/events` SSE Endpoint
**Status: complete.**

1. `/jobs/events` now streams real job updates from Fastify (auth-gated whenever the extended API flag is on):
   - Sets SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`), flushes `: connected`, and hijacks the socket.
   - Subscribes to the shared job-event bus, serializes via `jobRecordToDto`, and writes `event:`/`data:` blocks for `job_created` + `job_state_changed`.
   - Sends heartbeat comments every ~25 s and tears down timers/listeners on close/error.
2. Cross-process delivery is backed by the Redis bridge (`packages/batch-backend/src/infrastructure/job-event-redis-bridge.ts`), so worker-generated events reach the API process.
3. Logging captures connect/disconnect plus heartbeat/publish failures for observability.
4. Tests in `tests/transport.http-server.integration.test.ts` spin up the server, open a real HTTP connection, publish a fake event, and assert the streamed DTO.
5. Follow-up: document the final SSE contract (event names, sample payload, heartbeat interval) in `docs/backend-frontend/batch-backend-ssot.md`.

_Deliverable_: ✅ `/jobs/events` streams live DTOs (matching `/jobs/:id`) for both job creation and state changes, backed by Redis-published events and heartbeat keepalives.

---

### Phase 5 – `/config/job-options` Endpoint
1. Add a new handler in `http-server.ts` behind the extended API flag:
   - `if (extendedApiEnabled) app.get('/config/job-options', { preHandler: [authenticate] }, handler);`
   - Response shape:
     ```ts
     interface JobOptionResponse {
       presets: string[];
       voiceAccents: string[];
       notionDatabases: Array<{ id: string; name: string }>;
       uploadOptions: Array<'auto' | 's3' | 'none'>;
       modes: Array<'auto' | 'dialogue' | 'monologue'>;
     }
     ```
2. Source data:
   - Presets/voice accents/modes should come from configuration (reuse `loadConfig()` or orchestrator defaults where possible). Until wiring is ready, fall back to constants but wrap them in TODO comments referencing the upstream config provider.
   - Notion DB metadata should piggyback on existing config (if not available, stub a deterministic list so the UI can render; again mark with TODO).
3. Logging + caching:
   - Log the route invocation similarly to `/jobs`.
   - Since the payload is static, set `Cache-Control: private, max-age=60` so the frontend can cache for a minute.
4. Tests + docs:
   - Add integration tests asserting the endpoint is 404/disabled when the flag is off, and returns the expected JSON when enabled.
   - Document the contract in the SSOT plus a short mention in `README.md` (CLI users know the backend now owns option discovery).

_Deliverable_: Frontend can fetch dropdown values dynamically, keeping option lists in sync with backend/orchestrator defaults.

---

### Phase 6 – Schema Extensions & Additional Fields
1. Update persistence layer:
   - Modify `packages/batch-backend/schema.sql` to add columns `voice_accent TEXT`, `force_tts BOOLEAN`, `notion_database TEXT`, `mode TEXT`, `notion_url TEXT`.
   - Regenerate `JobRecord` (`domain/job-model.ts`) to include the new fields (all nullable for backward compatibility).
   - Teach `insertJob`/`updateJobStateAndResult` to read/write the columns and pass them through `mapRowToJob`.
2. Surface fields through the application layer:
   - Extend `SubmitJobRequest` + validator so `/jobs` can accept `voiceAccent`, `forceTts`, `notionDatabase`, `mode`.
   - Store these values via `insertJob`, and forward them to the orchestrator (when supported) inside `processQueueJob`.
   - Update `jobRecordToDto` so SSE/HTTP clients see the extra metadata (even if null today).
3. Handle Notion URL persistence:
   - Once `runAssignmentJob` resolves with a Notion link, capture it in the success branch and persist in `updateJobStateAndResult`.
   - Include `notionUrl` in DTOs so the frontend can surface a “Open in Notion” button.
4. Migration strategy:
   - Provide a SQL migration snippet (in `docs/backend-frontend/batch-backend-ssot.md` or `/configs/db/migrations`) so existing deployments can add the columns without dropping data.
5. Tests:
   - Extend domain/application tests to cover the new fields (insertion defaults, DTO serialization, orchestrator payload handoff).

_Deliverable_: Backend stores and exposes the advanced job metadata required for the Phase 8 UI controls.

---

### Phase 7 – Audio Rerun Endpoint (pending orchestrator support)
1. Vendor dependency:
   - After `@esl-pipeline/orchestrator` exposes a rerun API, add an application service (`packages/batch-backend/src/application/rerun-audio.ts`) that validates the request and calls the orchestrator helper.
2. HTTP contract:
   - Add `POST /jobs/:jobId/rerun/audio` under the extended API (auth required).
   - Body may include overrides like `{ voiceAccent, forceTts }`; validate via Zod similar to `/jobs`.
   - Decide whether reruns create a brand-new job row or mutate the existing one:
     - Preferred: insert a new job referencing `parentJobId` so history remains immutable. Persist that relation via a new column or a join table.
3. Eventing + SSE:
   - Publish `job_created` for the rerun row and let the normal worker pipeline handle status changes, ensuring frontend receives updates automatically.
4. Tests + docs:
   - Integration tests should cover 202 responses, validation errors, and rerun behavior (e.g., ensures a second queue job exists).
   - Document the rerun endpoint in the SSOT and update frontend alignment doc so designers know when to expose the “Regenerate audio” button.

_Deliverable_: Frontend “Regenerate audio” action triggers a real backend workflow that replays audio generation while preserving historical jobs.

---

Edit this document as work progresses so backend and frontend stay aligned. 
