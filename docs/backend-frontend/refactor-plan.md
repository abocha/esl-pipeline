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

---

## 5. Shared Infra Utilities

- **Problem**: Env parsing, storage config resolution, and rate-limiter helpers exist in both orchestrator and batch-backend packages with slight differences.
- **Plan**:
  1. Create `@esl-pipeline/shared-config` (or similar) exporting:
     - Env schema validation.
     - Storage configuration (filesystem, MinIO/S3) factories.
     - Rate limiter constructors.
  2. Refactor orchestrator + batch-backend to consume these helpers.
  3. Document shared behaviors in `docs/agents-ssot.md` so future services reuse them.
- **Acceptance criteria**:
  - Only one implementation of env validation/storage config remains.
  - Both backend and orchestrator import from the shared utility package.
  - Tests demonstrate identical behavior across packages.

---

## 6. Future Job Actions Abstraction

- **Problem**: Audio rerun is currently a TODO (Phase 7), and future actions (cancellation, metadata edits) would require touching multiple layers.
- **Plan**:
  1. Define a generic “job action” domain model (e.g., `job-actions.ts`) with types for rerun/audio, cancel, etc.
  2. Prepare backend routes/services to enqueue actions and emit events even if only rerun is implemented initially.
  3. Expose action capabilities in `/config/job-options` so the frontend knows which buttons to show.
  4. Stub frontend UI components around the shared action schema to simplify future features.
- **Acceptance criteria**:
  - Rerun endpoint can be implemented by filling in the action handler without rewriting job infrastructure.
  - Frontend toggles actions based on capabilities reported by the backend.
  - Alignment doc includes the job action contract.

---

### Next Steps

1. Prioritize tasks 2, 3, and 4 in upcoming sprints (they unlock immediate developer productivity).
2. Track each refactor as an issue linked back to this plan.
3. Revisit the document after each milestone to mark sections as completed or adjust scope.
