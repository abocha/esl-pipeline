# Backend–Frontend Alignment Plan (Batch System)

> **Canonical status tracker** — This file is now the single human-readable source for backend ↔ frontend API status, milestones, and dependencies. All other docs (UI design, implementation notes) should link here instead of duplicating requirements. For runtime contracts always defer to `docs/agents-ssot.md`.

## Document Map

- [`design-batch-frontend.md`](design-batch-frontend.md) — UI/UX narrative (user journey, layout, component responsibilities). Backend requirements referenced there link back to this plan.
- [`implementation-plan-batch-frontend.md`](implementation-plan-batch-frontend.md) — lightweight execution tips and checklists; any blocking backend work must be reflected here first.
- Additional backend scaffolding lives in [`groundwork-for-backend.md`](groundwork-for-backend.md) and the SSOTs referenced from `AGENTS.md`.

---

This document captures the gaps between the new batch frontend (Phase 7/8 UI) and the existing batch-backend implementation, along with the concrete steps needed to bring the backend up to speed.

---

## Phase 6: Job Actions Infrastructure ✅

**Status:** Complete (2025-01-21)

### Job Actions Contract

The backend now supports a generic job action system that allows the frontend to perform operations on existing jobs. Currently all actions are stubbed and return `501 Not Implemented`, but the infrastructure is in place for future implementation.

#### Discover Available Actions

**Endpoint:** `GET /config/job-options`  
**Auth:** Required (Bearer token)

**Response includes:**
```json
{
  "presets": [...],
  "voices": [...],
  "supportedActions": [
    {
      "type": "rerun_audio",
      "label": "Rerun Audio Generation",
      "description": "Regenerate TTS audio for this job with optional voice/TTS overrides",
      "requiresFields": [],
      "implemented": false
    },
    {
      "type": "cancel",
      "label": "Cancel Job",
      "description": "Cancel a queued or running job",
      "requiresFields": [],
      "implemented": false
    },
    {
      "type": "edit_metadata",
      "label": "Edit Job Metadata",
      "description": "Update job configuration (preset, Notion database) without rerunning",
      "requiresFields": [],
      "implemented": false
    }
  ]
}
```

#### Execute Job Action

**Endpoint:** `POST /jobs/:jobId/actions`  
**Auth:** Required (Bearer token)

**Request Body:**
```json
{
  "type": "rerun_audio" | "cancel" | "edit_metadata",
  "payload": {
    // Action-specific payload
  }
}
```

**Action-Specific Payloads:**

**Rerun Audio:**
```json
{
  "type": "rerun_audio",
  "payload": {
    "voiceId": "voice-123",      // Optional: override voice
    "voiceAccent": "british_male",  // Optional: override accent
    "forceTts": true             // Optional: force TTS regeneration
  }
}
```

**Cancel Job:**
```json
{
  "type": "cancel",
  "payload": {
    "reason": "User requested cancellation"  // Optional
  }
}
```

**Edit Metadata:**
```json
{
  "type": "edit_metadata",
  "payload": {
    "preset": "b2-advanced",           // Optional
    "notionDatabase": "notion-db-uuid"  // Optional
  }
}
```

**Response (Current - Not Implemented):**
```json
{
  "error": "not_implemented",
  "message": "Audio rerun not yet implemented",
  "actionType": "rerun_audio"
}
```
Status: `501 Not Implemented`

**Response (Future - Success):**
```json
{
  "success": true,
  "message": "Action completed successfully",
  "jobId": "job-uuid",
  "actionType": "rerun_audio",
  "timestamp": "2025-01-21T12:00:00Z"
}
```
Status: `200 OK`

**Error Responses:**
- `400 Bad Request` - Invalid action type or malformed payload
- `404 Not Found` - Job does not exist
- `422 Unprocessable Entity` - Job state invalid for action (e.g., cancelling succeeded job)
- `501 Not Implemented` - Action infrastructure exists but logic not yet implemented

#### Frontend Integration

**Capabilities Discovery:**
1. On app load, fetch `GET /config/job-options`
2. Parse `supportedActions` array
3. Render action buttons/menus based on `type` and `label`
4. Disable or hide actions where `implemented: false`
5. Show tooltip with `description` on hover

**Action Execution:**
1. User clicks action button (e.g., "Rerun Audio")
2. Frontend shows confirmation dialog with action-specific form fields
3. On confirm, `POST /jobs/:jobId/actions` with appropriate payload
4. Handle response:
   - `501`: Show "Coming soon" message
   - `200`: Show success toast, refresh job status via SSE
   - `4xx`: Show validation error to user
   - `5xx`: Show generic error message

**Shared Types:**
Import from `@esl-pipeline/contracts`:
```typescript
import { 
  JobActionType,
  JobActionRequest, 
  JobActionResponse,
  ActionCapability 
} from '@esl-pipeline/contracts';
```

### Implementation Status

- ✅ Domain model (`domain/job-actions.ts`)
- ✅ Action handlers (stubbed in `application/job-actions/`)
- ✅ Generic endpoint (`POST /jobs/:jobId/actions`)
- ✅ Capability exposure in `/config/job-options`
- ✅ Shared types in `@esl-pipeline/contracts`
- ⏳ Rerun audio logic (Stage 7 - pending)
- ⏳ Cancel job logic (Stage 8 - pending)
- ⏳ Edit metadata logic (Stage 9 - pending)

---

## Current Status

### ✅ Completed Infrastructure

- **SSE Event Stream:** `GET /jobs/events` is fully implemented
  - Streams `job_created` and `job_state_changed` events in real-time
  - Includes heartbeat mechanism for connection stability
  - Requires authentication when extended API is enabled

- **Configuration Endpoint:** `GET /config/job-options` is operational
  - Dynamically pulls from orchestrator config (with fallback)
  - Returns presets, voices, voice accents, Notion databases, upload options, modes
  - Now includes `supportedActions` array for job action capabilities

- **Job Metadata:** Jobs store and return full metadata
  - Extended fields: `voiceAccent`, `forceTts`, `notionDatabase`, `mode`, `notionUrl`
  - DTO serialization consistent between HTTP and SSE
  - Database schema supports all frontend requirements

- **Job Actions Infrastructure:** Generic action system in place (Phase 6)
  - `POST /jobs/:jobId/actions` endpoint available
  - Three action types defined: `rerun_audio`, `cancel`, `edit_metadata`
  - Actions currently return `501 Not Implemented` (logic pending Stages 7-9)

- **Extended API:** Fully functional routes
  - Authentication (`/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/me`)
  - File uploads (`/uploads` with validation and sanitization)
  - Admin endpoints (`/admin/users`, `/admin/jobs`, `/admin/stats`)
  - User profile (`/user/profile`, `/user/jobs`, `/user/files`)

### ⏳ Pending Work

- **Job Action Implementations:**
  - Stage 7: Implement `rerun_audio` logic (orchestrator integration)
  - Stage 8: Implement `cancel` logic (BullMQ queue management)
  - Stage 9: Implement `edit_metadata` logic (database + manifest updates)

- **Future Enhancements:**
  - User-scoped job filtering (multi-tenant support)
  - Pagination for job lists
  - Job priority/scheduling options
  - Advanced search and filtering capabilities


---

## Required Backend Work

> **Routing split**: `packages/batch-backend/src/transport/core-routes.ts` now owns the mandatory job endpoints, while `transport/extended-routes.ts` contains `/config/job-options`, uploads, auth, and admin routes. `createHttpServer` registers the extended plugin only when `config.experimental.extendedApiEnabled` / `BATCH_BACKEND_ENABLE_EXTENDED_API` is true, so any new optional surface should land inside that plugin.

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

_Deliverable_: Single source of truth for job serialization, with targeted tests that lock the DTO shape for both HTTP and SSE consumers. The canonical DTO + SSE event types now live in `@esl-pipeline/contracts`, and both backend + frontend import from that package instead of redefining their own interfaces.

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
**Status: complete.**

- `GET /config/job-options` now lives in `http-server.ts`, inherits the extended API/auth gate, and sets `Cache-Control: private, max-age=60` so the React Query call can memoize the response.
- The handler calls `getJobOptions()` (`packages/batch-backend/src/application/get-job-options.ts`), which proxies to the orchestrator’s `resolveJobOptions` helper via `getJobOptionsFromOrchestrator`. The helper reads presets + Notion DB metadata from the active config provider (`configs/*.json` or remote) and voice catalog data from `configs/elevenlabs.voices.json`, so frontend dropdowns always reflect whatever the worker will run.
- If the orchestrator metadata fetch fails, the backend logs a warning and falls back to the legacy static/env-driven options (`NOTION_DB_OPTIONS`, `NOTION_DB_ID`, `NOTION_DB_NAME`, etc.). These env overrides remain supported only as a safety net; they should be treated as temporary until the orchestrator config is reachable again.
- Integration coverage in `tests/transport.http-server.integration.test.ts` asserts both the success payload (mocked via the orchestrator helper) and the disabled (`404`) behavior when `BATCH_BACKEND_ENABLE_EXTENDED_API=false`.

_Deliverable_: Frontend fetches dropdown metadata from the orchestrator-configured presets/voices/databases and stays aligned with backend defaults without hardcoding; legacy env overrides are now a fallback path only.

---

### Phase 6 – Schema Extensions & Additional Fields
**Status: complete.**

1. Persistence:
   - `schema.sql` gained `voice_accent`, `force_tts`, `notion_database`, `mode`, and `notion_url` columns so Postgres can store the upcoming UI controls plus the Notion link surfaced by the orchestrator. `withPgClient` now guards against older databases by issuing `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for those fields at startup.
   - `JobRecord`/`insertJob`/`updateJobStateAndResult` round-trip the new columns, and `job-dto.ts` exposes them to both HTTP and SSE consumers. See `packages/batch-backend/src/domain/job-repository.ts` for the canonical mapping.
2. Submission + workers:
   - `/jobs` validation accepts `voiceAccent`, `forceTts`, `notionDatabase`, `mode`, and the new `'auto'` upload option, passing those fields through `submitJob`.
   - `process-queue-job.ts` forwards `voiceAccent` → `accentPreference`, `mode` → `ttsMode`, `forceTts` → `redoTts`, and `notionDatabase` → `dbId` when calling the orchestrator, and captures `pageUrl` as `notionUrl` on success (persisted + emitted to clients).
3. Storage path hygiene:
   - `FILESYSTEM_UPLOAD_DIR` now defaults to an absolute path, and Docker Compose mounts a shared `uploads_data` volume at `/app/uploads` for both API + worker so local filesystem jobs are readable across processes. The DTO/logger surface both the sanitized storage key and the resolved absolute path for observability.
4. Manifest credentials:
   - When `manifestStore` is `s3`, the backend now instantiates the orchestrator’s `S3ManifestStore` with a preconfigured `S3Client` that uses either real AWS credentials (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) or the MinIO credentials from `.env`. This fixes the “Region/credentials missing” crashes encountered in earlier spins.
5. Configurable job options:
   - `GET /config/job-options` now surfaces real Notion database IDs when `NOTION_DB_ID`/`NOTION_DB_NAME` or `NOTION_DB_OPTIONS` are set, so the frontend can stop sending placeholder values that fail validation.
6. Notion throttling safeguards:
   - The colorizer now honors `NOTION_COLORIZER_MAX_RETRIES`, `NOTION_COLORIZER_RETRY_DELAY_MS`, `NOTION_CLIENT_TIMEOUT`, and `NOTION_COLORIZER_THROTTLE_MS` env vars to avoid “fetch failed” errors when Notion rate-limits the batch worker. These defaults match the CLI wizard pacing.
7. Tests + docs:
   - DTO, repository, submit-job, process-queue, and HTTP integration suites assert the new metadata path end-to-end, and `docs/backend-frontend/batch-backend-ssot.md` now includes the SQL migration snippet operators can run against existing databases.

_Deliverable_: Job rows carry the advanced metadata required by the Phase 8 UI, and clients immediately receive the Notion URL once the orchestrator run succeeds.

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
