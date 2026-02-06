# Pipeline Integration Phase 4 Manual (Student-Centric Workflow)

Purpose: step-by-step manual for delivering Phase 4, focused on student
selection, profile CRUD, and per-student timelines in the batch system.
This manual assumes the Phase 2+ foundation and Phase 3 polish are already
implemented.

Audience: maintainers and agents implementing Phase 4 across batch-backend,
batch-frontend, and orchestrator config integration.

Scope:

- Student list + selection workflows across the UI.
- Student profile CRUD (metadata + profile content linkage).
- Per-student history and transcript/draft timeline views.
- Keep Phase 2+ behavior stable and backward compatible.

Status:

- Phase 2+ is implemented and stable.
- Phase 3 polish is implemented.
- Phase 4 student-centric workflow is implemented.

---

## Pre-flight (Required Reading)

- AGENTS.md (SSOT pointer)
- docs/reference/agents-ssot.md (repo invariants)
- docs/PIPELINE_INTEGRATION_VISION.md (operational runbook + roadmap)
- docs/design/TRANSCRIPTION_PIPELINE_SPEC.md (Phase 2+ spec)
- docs/design/FRONTEND_VISION.md (target UX)
- docs/backend-frontend/batch-backend-ssot.md (backend contracts)
- docs/backend-frontend/backend-frontend-alignment.md (API status tracker)
- docs/backend-frontend/BATCH_SYSTEM.md (batch system overview)
- docs/reference/env.md (env and config paths)
- configs/students/\*.json (current student profile schema)

Confirm these guardrails:

- Phase 2+ ingestion, transcription, prompt assembly, and approval flows must
  remain stable.
- Extended API routes require `BATCH_BACKEND_ENABLE_EXTENDED_API=true`.
- Student IDs are derived via `deriveStudentId`; renames change IDs unless a
  migration step explicitly re-links data.
- Any API contract change must be reflected in
  docs/backend-frontend/batch-backend-ssot.md and
  docs/backend-frontend/backend-frontend-alignment.md.

---

## Stage 0: Baseline audit

Goal: confirm current student association behavior and identify gaps.

Steps:

1. Verify student association in recordings and downstream artifacts:
   - recordings.student_id populated via scan folder name or upload selection.
   - prompt_packages.student_id and drafts.student_id are persisted.
2. Verify `GET /config/students` response:
   - Based on `configs/students/*.json` via orchestrator config provider.
   - Returns derived IDs via `deriveStudentId`.
3. Verify prompt profile allowlist behavior:
   - `GET /config/prompts` returns profile IDs relative to the profile root.
   - Profile selection uses allowlisted IDs (recognize how IDs map to file paths).
4. Confirm extended API guardrails and auth requirements in the batch backend.

Review Gate 0:

- Summarize the current student association behavior and any mismatches with
  desired Phase 4 outcomes.

---

## Stage 1: Student profile storage and CRUD (backend)

Goal: implement CRUD for student profiles while keeping config-driven defaults
and existing student IDs consistent.

Implementation steps:

1. Extend the student profile schema to carry a prompt profile mapping:
   - Add optional `profileId` (prompt profile ID relative to profile root).
   - Keep existing fields: `student`, `dbId`, `pageParentId`, `colorPreset`,
     `accentPreference`, `voices`, `manifestPreset`.
   - Update the orchestrator `StudentProfile` interface to include `profileId`
     so batch-backend can consume it without unsafe casts.
2. Add a student profile store in batch-backend that reads/writes JSON under
   the resolved students directory:
   - Use `resolveConfigPaths` via orchestrator integration to locate
     `studentsDir` and validate it is writable.
   - When `ESL_PIPELINE_CONFIG_PROVIDER` is remote/http, treat CRUD as
     read-only and return 409/501 with a clear error message.
   - Sanitize filenames (no path traversal, ASCII only) and enforce `.json`.
3. Add CRUD endpoints under the extended API plugin:
   - `GET /students` (search by name/id, optional pagination).
   - `GET /students/:id` (by derived ID).
   - `POST /students` (create new student profile).
   - `PUT /students/:id` (update metadata; reject name changes or document
     migration if renaming is supported).
   - `DELETE /students/:id` (remove profile; do not delete recordings).
4. Keep `GET /config/students` backward compatible while surfacing `profileId`:
   - Either proxy to the new store or merge config and CRUD data sources.
5. Tests:
   - Backend unit tests for store read/write + validation.
   - Integration tests for CRUD endpoints and error cases.

Review Gate 1:

- Provide sample request/response payloads and confirm that CRUD does not
  break `GET /config/students`.

---

## Stage 2: Student profile content workflow

Goal: enable editing and linking of per-student profile content used in prompt
assembly.

Implementation steps:

1. Add profile content endpoints that operate within the prompt profile root:
   - `GET /profiles` (list allowlisted profiles with IDs/labels).
   - `GET /profiles/:id` (read profile text).
   - `PUT /profiles/:id` (create/update profile text).
   - `DELETE /profiles/:id` (remove profile text file).
     Reuse allowlist and root validation logic from prompt option utilities.
2. Update student profiles to reference `profileId` (from Stage 1).
3. Update prompt package creation defaults:
   - When a student is selected, default `profileId` to the student profile.
   - Keep the prompt profile allowlist and validation intact.
4. Tests:
   - Backend tests for profile read/write/validation.
   - Ensure profile IDs map to actual prompt files and stay within root.

Review Gate 2:

- Confirm a student profile can be edited and immediately used in prompt
  package creation without changing Phase 2+ behavior.

---

## Stage 3: Per-student timeline and history (backend)

Goal: deliver a timeline API that aggregates recordings, transcripts, prompt
packages, drafts, and jobs for a student.

Implementation steps:

1. Define a timeline payload:
   - Fields: `type`, `studentId`, `recordingId`, `transcriptId`,
     `promptPackageId`, `draftId`, `jobId`, `status`, `createdAt`,
     `displayName`, and optional `details`.
   - Types should include at least: `recording_ingested`, `transcript_ready`,
     `prompt_package_created`, `draft_saved`, `job_awaiting_approval`, `job_completed`.
2. Add repository queries to gather timeline items:
   - Use existing `student_id` indexes on recordings/prompt_packages/drafts.
   - Join jobs via `recordingId` or `draftId` as needed.
   - Sort by `createdAt` desc; support `limit`, `offset`, `order`.
3. Add endpoint:
   - `GET /students/:id/timeline` with filters for `type` and `status`.
4. Tests:
   - Integration tests for timeline ordering and filtering.
   - Ensure multi-step artifacts from the same recording correlate properly.

Review Gate 3:

- Provide a sample timeline response and verify pagination/filtering.

---

## Stage 4: Student-centric UI workflow (frontend)

Goal: expose a student-first UX with selection, profile editing, and timeline.

Implementation steps:

1. Add a student list view:
   - Search + filter (recent activity, missing profiles).
   - Show key summary metrics (last lesson, pending drafts, recent errors).
2. Add a student detail view:
   - Profile metadata editor (dbId, preset, accent, voices, profileId).
   - Profile content editor (markdown/text).
   - Timeline panel with actions to open transcript, draft, or job.
3. Integrate with the existing transcription workspace:
   - Selecting a student pre-fills upload association and defaults.
   - Prompt package creation uses the student profile when available.
4. SSE and refresh behavior:
   - Timeline updates on new recording/job events where possible.
   - Fall back to refresh or polling if SSE payloads lack student context.
5. Tests:
   - Frontend tests for selection, profile save, and timeline filters.

Review Gate 4:

- Confirm the student workflow is usable end-to-end without breaking the
  existing transcription UI.

---

## Stage 5: Documentation and release checklist

Goal: keep contracts and docs synchronized with the Phase 4 rollout.

Steps:

1. Update:
   - docs/backend-frontend/batch-backend-ssot.md (new endpoints/DTOs)
   - docs/backend-frontend/backend-frontend-alignment.md (status + contracts)
   - docs/backend-frontend/BATCH_SYSTEM.md (student workflow summary)
   - docs/PIPELINE_INTEGRATION_VISION.md (Phase 4 status + manual link)
2. Add or update fixtures/tests as needed.
3. Confirm env docs if any new paths are introduced.

Review Gate 5:

- Provide a short changelog and verify doc alignment.

---

## Notes

- Keep Phase 2+ pipeline stages unchanged.
- Do not change manifest schema in Phase 4.
- When adding API fields, update the SSOT and alignment docs in the same change
  set.

---

## Implementation Report

Summary:

- Backend: student profile store (metadata CRUD), profile content CRUD, per-student
  timeline aggregation (SQL union with DB pagination and filters), draft fetch
  endpoint, and prompt package defaults now prefer student profileId when present.
- Frontend: student workspace (list, metadata form, profile content editor,
  timeline panel), selection context, transcription workspace integration, and
  API client extensions, plus profile editor reset on student/profile changes.
- Docs: updated timeline type list to use `job_awaiting_approval` in this manual.
- Tests: added backend unit tests for student profiles, profile content, timeline;
  added frontend test for StudentWorkspace; updated integration tests for new
  endpoints and DTO fields.

Review Gate Status:

- Review Gate 4: pending. No manual end-to-end UI verification performed in this
  run.
- Review Gate 5: partial. Manual updated, but alignment and workflow still
  require manual confirmation.

Changelog:

- New extended API routes for student CRUD, profile content CRUD, student
  timeline, and draft fetch.
- Student records include optional profileId and prompt profiles allowlist is
  exposed with file path.
- Student-centric UI with polling + SSE refresh hooks for timeline updates.
- Timeline types now include `job_awaiting_approval`, with DB-level pagination
  and filters for type/status.
- Transcription workspace clears prompt profile defaults when student selection
  has no profile; profile editor content resets when switching students/profiles.
