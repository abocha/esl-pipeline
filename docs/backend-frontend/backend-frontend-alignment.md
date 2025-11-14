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

Edit this document as work progresses so backend and frontend stay aligned. 
