# Backend/Frontend Refactor Plan

This document captures medium‑sized refactors that streamline the batch backend and frontend collaboration. Each section outlines the motivation, scope, dependencies, and acceptance criteria so we can schedule the work incrementally without losing track of cross‑package effects.

---

## 1. Consolidate Alignment Documentation

- **Problem**: Requirements currently live in three overlapping docs (`backend-frontend-alignment.md`, `design-batch-frontend.md`, `implementation-plan-batch-frontend.md`). Contributors often miss updates or read stale guidance.
- **Plan**:
  1. Make `backend-frontend-alignment.md` the authoritative tracker for API status + phase completion.
  2. Move UI behavior details from `design-batch-frontend.md` into contextual sections (user journey, layout) and link to the alignment doc for backend dependencies.
  3. Collapse the implementation checklist into GitHub issues or a short appendix, removing duplicate per-phase descriptions.
  4. Update `AGENTS.md` §5 to point to the new single document.
- **Acceptance criteria**:
  - Only one doc describes backend ↔ frontend contracts.
  - Other docs reference the canonical source instead of restating status.
  - PR template/checklist updated to remind authors to touch the single alignment doc.

---

## 2. Real Config/Metadata Feed

**Status: delivered (see `packages/orchestrator/src/metadata/job-options.ts`).**

- **Problem**: `/config/job-options` (`packages/batch-backend/src/application/get-job-options.ts`) still relies on env overrides and static JSON. Frontend dropdowns drift whenever presets/voices/Notion DBs change elsewhere in the repo.
- **Plan**:
  1. Add an orchestrator helper that exposes presets/voices/Notion DB metadata via the existing config provider interfaces.
  2. Replace the static loader with a call into that helper (fallback to static only when the provider is unreachable).
  3. Document env knobs (e.g., `NOTION_DB_OPTIONS`) as legacy overrides and schedule removal after migration.
  4. Update frontend API typings so `GET /config/job-options` mirrors the new response shape.
- **Acceptance criteria**:
  - Backend metadata automatically reflects orchestrator config changes.
  - Frontend no longer needs out-of-band env vars to stay in sync.
  - Alignment doc describes the source of truth for presets/voices/DBs.

_Outcome_: `packages/orchestrator/src/metadata/job-options.ts` now exposes `resolveJobOptions`, `packages/batch-backend/src/infrastructure/orchestrator-service.ts` re-exports it via `getJobOptionsFromOrchestrator`, and `/config/job-options` emits whatever presets/voices/Notion DBs the orchestrator config provider resolves. When that fetch fails, the backend logs a warning and returns the legacy static/env-driven payload so operators retain a safe fallback.

---

## 3. Shared Job DTO & Types

- **Problem**: Job DTO shape is defined in `packages/batch-backend/src/application/job-dto.ts`, while the frontend redefines the payload in `packages/batch-frontend/src/utils/api.ts`. Divergence risks runtime mismatches.
- **Plan**:
  1. Publish the DTO types from a shared workspace package (e.g., `@esl-pipeline/contracts`).
  2. Update backend exports so `/jobs/:id` and SSE both reference the shared types.
  3. Extend frontend API client + SSE hooks to import the shared DTO interface instead of duplicating it.
  4. Add lint/test guardrails ensuring the shared package is the only source of job DTO truth.
- **Acceptance criteria**:
  - There is a single TypeScript definition for job payloads.
  - SSE + REST responses are verified against the shared type in tests.
  - Frontend type errors arise automatically when backend fields change.

---

## 4. Modularize Extended API Routes

- **Problem**: `packages/batch-backend/src/transport/http-server.ts` intermixes core job routes with optional uploads/auth endpoints, making the file long and harder to reason about when `BATCH_BACKEND_ENABLE_EXTENDED_API` is toggled.
- **Plan**:
  1. Extract route registration into plugins:
     - `registerCoreJobRoutes(fastify)` – POST/GET jobs + SSE.
     - `registerExtendedRoutes(fastify)` – config metadata, uploads, auth, admin.
  2. Keep feature flags at the plugin boundary so flag logic disappears from individual handlers.
  3. Add module-level unit tests for each plugin.
  4. Update docs to explain which routes belong to which plugin/flag.
- **Acceptance criteria**:
  - HTTP server composition clearly separates mandatory vs optional routes.
  - Flag changes no longer require editing the main server file.
  - Tests cover each plugin independently.

_Status_: Completed — `transport/core-routes.ts` and `transport/extended-routes.ts` now register their respective surfaces, and `http-server.ts` simply wires the plugins behind `config.experimental.extendedApiEnabled`.

---

## Stage 5: Shared Infra Utilities

**Status:** ✅ Delivered (2025-01-21)

**Problem:**

- Duplicated environment parsing between `orchestrator` and `batch-backend` (`loadEnvFiles`, `readBool`, `readInt`, `readString`)
- Duplicated storage configuration resolution (S3/MinIO/filesystem handling)
- Rate-limiter helpers only in batch-backend but could be shared

**Plan:**

1. Create new package: `@esl-pipeline/shared-infrastructure`
2. Extract and consolidate:
   - Environment variable loading utilities
   - Storage configuration services
   - Manifest store resolution
   - (Optional) Rate-limiting utilities for future use
3. Update both orchestrator and batch-backend to import from shared package
4. Maintain backward compatibility via re-exports

**Implementation:**

- ✅ Created `@esl-pipeline/shared-infrastructure` package
- ✅ Extracted `loadEnvFiles`, `readBool`, `readInt`, `readString` from both packages
- ✅ Consolidated `StorageConfigurationService` from batch-backend
- ✅ Extracted `resolveManifestStoreConfig` from orchestrator
- ✅ Updated orchestrator to use shared utilities (backward-compatible re-exports)
- ✅ Updated batch-backend to use shared utilities
- ✅ All packages build successfully
- ✅ All tests passing (29 tests for shared-infrastructure, 29 for orchestrator, 154 for batch-backend)

**Impact:**

- Eliminated ~250 lines of duplicated code
- Single source of truth for infrastructure utilities
- Easier maintenance and consistency across packages

---

3. Document shared behaviors in `docs/agents-ssot.md` so future services reuse them.

- **Acceptance criteria**:
  - Only one implementation of env validation/storage config remains.
  - Both backend and orchestrator import from the shared utility package.
  - Tests demonstrate identical behavior across packages.

---

## Stage 6: Future Job Actions Abstraction

**Status:** ✅ Delivered (2025-01-21)

**Problem:**
Audio rerun was a TODO (Phase 7), and future actions (cancellation, metadata edits) would require touching multiple layers without a unified abstraction.

**Plan:**

1. Define generic "job action" domain model with types for rerun/audio, cancel, edit-metadata
2. Prepare backend routes/services to execute actions (stubbed initially)
3. Expose action capabilities in `/config/job-options` for frontend discovery
4. Create extensible infrastructure for future action implementations

**Implementation:**

- ✅ Created domain model `domain/job-actions.ts`:
  - `JobActionType` enum (RERUN_AUDIO, CANCEL, EDIT_METADATA)
  - Type-safe action interfaces and result types
- ✅ Created action handler infrastructure `application/job-actions/`:
  - `rerun-audio.ts`, `cancel-job.ts`, `edit-metadata.ts` (stub implementations)
  - `action-handler.ts` central dispatcher with metadata exposure
- ✅ Added `POST /jobs/:jobId/actions` route to `extended-routes.ts`:
  - Validates action types
  - Routes to appropriate handler
  - Returns 501 Not Implemented for stubs
- ✅ Updated `/config/job-options` to include `supportedActions` array
- ✅ Added job action types to `@esl-pipeline/contracts`:
  - `JobActionType`, `JobActionRequest`, `JobActionResponse`, `ActionCapability`
- ✅ All tests passing (154/154 for batch-backend)

**Impact:**

- Frontend can discover available actions via `/config/job-options`
- Single generic endpoint pattern for all actions
- Easy to implement actual logic in future stages (just fill in handler stubs)
- Type-safe contracts shared between frontend/backend

**Future Stages:**

- Stage 7: Implement `rerun_audio` logic (call orchestrator)
- Stage 8: Implement `cancel` logic (BullMQ integration)
- Stage 9: Implement `edit_metadata` logic (DB + manifest updates)

---

## Stage 7: Implement Rerun Audio Action

**Status:** Pending

**Problem:**
Users need to regenerate TTS audio for completed jobs (e.g., to use a different voice or fix audio issues) without re-running the entire pipeline. Infrastructure exists (Stage 6), but actual implementation is stubbed.

**Plan:**

1. Integrate with orchestrator's `rerunAssignment` function
2. Handle job state validation (only allow rerun for completed jobs)
3. Support voice/TTS parameter overrides via action payload
4. Update job tracking (either update existing job or create linked job)
5. Emit appropriate events for frontend updates

**Implementation Details:**

### Application Layer Changes

**Modify `application/job-actions/rerun-audio.ts`:**

```typescript
// Replace stub with actual implementation
export async function rerunAudio(
  jobId: string,
  action: RerunAudioAction,
): Promise<JobActionResult> {
  // 1. Get job and validate
  const job = await getJobById(jobId);
  if (!job) return notFoundResult(jobId);
  if (job.state !== 'succeeded') {
    return errorResult(jobId, 'Job must be in succeeded state to rerun audio');
  }

  // 2. Resolve manifest path
  const manifestPath = job.manifestPath;
  if (!manifestPath) {
    return errorResult(jobId, 'No manifest found for this job');
  }

  // 3. Call orchestrator rerunAssignment
  const orchestratorOptions = {
    manifestPath,
    voiceId: action.payload.voiceId,
    voiceAccent: action.payload.voiceAccent,
    forceTts: action.payload.forceTts ?? true,
  };

  await rerunAssignment(orchestratorOptions);

  // 4. Update job or create new reference
  // Option A: Update existing job to 'queued', re-run worker
  // Option B: Create new job linked to original

  // 5. Emit event
  publishJobEvent({ type: 'job_state_changed', job: updatedJob });

  return successResult(jobId, 'Audio rerun initiated');
}
```

**Dependencies:**

- Import `rerunAssignment` from `@esl-pipeline/orchestrator`
- Update job repository with new state/status
- Handle worker queue submission

**Acceptance Criteria:**

- Rerun only works for succeeded jobs
- Voice overrides are properly applied
- Manifest path is validated before calling orchestrator
- Events emitted for frontend tracking
- Tests cover validation, orchestrator call, and state updates

---

## Stage 8: Implement Cancel Job Action

**Status:** Pending

**Problem:**
Users cannot cancel queued or running jobs, leading to wasted resources and poor UX during accidental submissions or changed requirements.

**Plan:**

1. Validate job is cancellable (queued or running state only)
2. Remove from BullMQ queue if queued
3. Signal running worker to gracefully abort if running
4. Update job state to 'cancelled' in database
5. Clean up any partial artifacts
6. Emit cancellation event

**Implementation Details:**

### Application Layer Changes

**Modify `application/job-actions/cancel-job.ts`:**

```typescript
export async function cancelJob(jobId: string, action: CancelJobAction): Promise<JobActionResult> {
  // 1. Validate job state
  const job = await getJobById(jobId);
  if (!job) return notFoundResult(jobId);

  if (!['queued', 'running'].includes(job.state)) {
    return errorResult(jobId, `Cannot cancel job in ${job.state} state`);
  }

  // 2. Remove from queue if queued
  if (job.state === 'queued') {
    const removed = await removeJobFromQueue(jobId);
    if (!removed) {
      return errorResult(jobId, 'Failed to remove job from queue');
    }
  }

  // 3. Signal running worker to abort
  if (job.state === 'running') {
    await signalWorkerAbort(jobId);
    // Worker will detect signal and gracefully stop
  }

  // 4. Update job state
  const cancelledJob = await updateJobState(jobId, {
    state: 'cancelled',
    finishedAt: new Date(),
    error: action.payload.reason || 'Cancelled by user',
  });

  // 5. Emit event
  publishJobEvent({ type: 'job_state_changed', job: cancelledJob });

  return successResult(jobId, 'Job cancelled successfully');
}
```

**Infrastructure Requirements:**

- Add `removeJobFromQueue(jobId)` helper using BullMQ API
- Implement worker abort signaling (Redis flag or BullMQ job.remove())
- Update worker to check for abort signals during processing
- Add 'cancelled' as valid JobState in contracts

**Acceptance Criteria:**

- Queued jobs removed from BullMQ queue immediately
- Running jobs receive abort signal and stop gracefully
- Succeeded/failed jobs cannot be cancelled
- Database reflects cancelled state
- Events emitted for frontend updates
- Tests cover all state transitions

---

## Stage 9: Implement Edit Metadata Action

**Status:** Pending

**Problem:**
Users cannot fix metadata mistakes (wrong preset, wrong Notion database) after job submission without re-submitting entirely. Metadata edits don't require re-running the pipeline.

**Plan:**

1. Validate new metadata values
2. Update job record in database
3. Optionally update manifest file if it exists
4. Emit metadata update event
5. Support partial updates (only changed fields)

**Implementation Details:**

### Application Layer Changes

**Modify `application/job-actions/edit-metadata.ts`:**

```typescript
export async function editMetadata(
  jobId: string,
  action: EditMetadataAction,
): Promise<JobActionResult> {
  // 1. Validate job exists
  const job = await getJobById(jobId);
  if (!job) return notFoundResult(jobId);

  // 2. Validate new metadata
  const updates: Partial<JobRecord> = {};

  if (action.payload.preset) {
    // Validate preset exists in config
    const validPresets = await getValidPresets();
    if (!validPresets.includes(action.payload.preset)) {
      return errorResult(jobId, `Invalid preset: ${action.payload.preset}`);
    }
    updates.preset = action.payload.preset;
  }

  if (action.payload.notionDatabase) {
    // Validate Notion DB exists
    const validDbs = await getValidNotionDatabases();
    if (!validDbs.find((db) => db.id === action.payload.notionDatabase)) {
      return errorResult(jobId, `Invalid Notion database: ${action.payload.notionDatabase}`);
    }
    updates.notionDatabase = action.payload.notionDatabase;
  }

  // 3. Update job record
  const updatedJob = await updateJobMetadata(jobId, updates);

  // 4. Update manifest if it exists
  if (updatedJob.manifestPath) {
    try {
      await updateManifestMetadata(updatedJob.manifestPath, updates);
    } catch (err) {
      // Log warning but don't fail - manifest sync is best-effort
      logger.warn('Failed to sync manifest after metadata edit', { jobId, error: err });
    }
  }

  // 5. Emit event
  publishJobEvent({ type: 'job_state_changed', job: updatedJob });

  return successResult(jobId, 'Metadata updated successfully');
}
```

**Validation Requirements:**

- Cross-reference presets with `/config/job-options`
- Cross-reference Notion databases with available options
- Verify user has permissions (if auth/tenant-based)

**Manifest Sync:**

- Read existing manifest JSON
- Update relevant fields (preset, notionDatabase)
- Write back atomically
- Handle missing/corrupted manifests gracefully

**Acceptance Criteria:**

- Invalid metadata rejected with clear error messages
- Database updated with new values
- Manifest synced if present (best-effort)
- Events emitted with updated job data
- Tests cover validation, DB updates, manifest sync, and error cases

---

### Next Steps

1. Prioritize tasks 2, 3, and 4 in upcoming sprints (they unlock immediate developer productivity).
2. Track each refactor as an issue linked back to this plan.
3. Revisit the document after each milestone to mark sections as completed or adjust scope.
