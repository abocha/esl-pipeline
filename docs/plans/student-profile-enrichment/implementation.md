# Student Profile Enrichment Implementation Plan

## Summary

Implement the full student-profile-enrichment workstream as one backend-first program, then add the draft-grade workspace surfaces, then finish with the temporary live-transition tooling.

Execution order:

1. backend candidate/review/promotion contracts first
2. workspace review/promotion and starter-profile flow second
3. tool-first live-transition normalization last

This does **not** need to remain production-usable at every intermediate checkpoint. The acceptance bar is the completed workstream, not each partial phase.

## Key Implementation Changes

### 1. Backend foundation: candidate facts, review state, and promotion

- Add canonical `student_profile_candidates` persistence in `batch-backend` with:
  - lifecycle status: `pending_review | approved | rejected | promoted | superseded`
  - secondary review state: `unreviewed | deferred | approved | rejected`
  - source provenance: `studentId`, `sourceSnapshotId`, `sourceLessonMemoryIds`, evidence payload, authority, confidence, target section
  - decision metadata: reviewer id, reviewer note, approved edited text, promoted revision id, superseded linkage
- Extend the existing student-memory queue with a new job kind for candidate refresh, triggered after a new ready student-memory snapshot is written.
- Implement candidate generation from canonical memory only:
  - primary input: latest ready snapshot `personalFacts`
  - corroboration input: recent ready lesson-memory `studentFacts`
  - no raw transcript re-analysis in v1
  - enforce profile-worthiness rules, repeatability rules for strengths, and deterministic dedupe/supersession
- Add read and mutation services/routes under the existing student-scoped surface:
  - `GET /students/:id/profile-candidates`
  - `POST /students/:id/profile-candidates/:candidateId/approve`
  - `POST /students/:id/profile-candidates/:candidateId/reject`
  - `POST /students/:id/profile-candidates/:candidateId/defer`
  - `POST /students/:id/profile-candidates/promote`
- Promotion must be explicit-subset by default:
  - request includes selected approved candidate ids
  - frontend may offer “select all approved” as a convenience wrapper only
  - backend never silently treats “all approved” as default
- Promotion creates a **draft** profile revision only; it must not auto-activate.
- Expand `ProfileRevisionSource` to preserve provenance for new revision origins:
  - `starter_profile_form`
  - `candidate_promotion`
  - `legacy_normalization`
- Implement promotion drafting as:
  - deterministic candidate selection and section targeting
  - one bounded LLM drafting call
  - draft revision persistence via the existing revision system without activation
- Keep runtime authority unchanged:
  - prompt packages still use only the active profile revision
  - pending/rejected/approved-but-not-promoted candidates never affect live generation

### 2. Starter-profile creation flow

- Extend `POST /students` to accept an optional `starterProfile` object instead of forcing teachers to pre-create a full profile document.
- `starterProfile` should support:
  - `level?`
  - `goals`
  - `professionOrContext`
  - `interests`
  - `longRunningChallenges`
  - `studyPreferencesOrConstraints`
  - `teacherNotes?`
- Backend create flow should, when `starterProfile` is present:
  - create or upsert the student row
  - create a profile record
  - create an active initial profile revision with source `starter_profile_form`
  - bind that profile to the student through the existing binding system
- CEFR level remains optional; unknown level must not block student creation.

### 3. Workspace UI: draft-grade but complete

- Extend the typed frontend API surface for:
  - candidate list/read models
  - approve/reject/defer mutations
  - promotion request/response
  - starter-profile create payload
- Add a utilitarian profile-candidates section to `StudentWorkspace` near the current profile/memory surfaces:
  - grouped by target section
  - evidence expansion
  - approve
  - edit-and-approve
  - reject
  - defer
  - filter pending vs reviewed
  - explicit deferred state
  - explicit “approved but not yet promoted” vs “already promoted”
- Add a plain promotion flow in the workspace:
  - choose approved candidates
  - generate draft revision
  - inspect draft revision / diff through existing revision surfaces
  - activate through existing activation flow
- Extend the student-create card with starter-profile fields rather than introducing a second onboarding surface.
- Keep the UI additive and operational; do not reorganize the whole workspace.

### 4. Temporary epilogue: tool-first live transition

- Do **not** add a permanent public normalization API for migration.
- Implement Phase 5 as tool-first operator support:
  - a backend tool/command that reads the active legacy profile plus current canonical memory
  - one bounded LLM normalization draft pass
  - create a draft profile revision with source `legacy_normalization`
  - never auto-activate
- Mixed-state operation is explicitly allowed during transition:
  - legacy overloaded profile students continue to work
  - migrated students use normalized profiles
- The normalization tool should be one-student-at-a-time and support preview metadata in stdout/log output:
  - profile used
  - snapshot used
  - recent lesson/homework memory used
  - created draft revision id
- Keep migration helpers out of permanent runtime authority or prompt assembly.

### 5. Delegation plan

- Explorer agents for codebase questions only, reused as needed.
- Worker 1: backend schema/repository/routes for candidate lifecycle.
- Worker 2: backend drafting/promotion/normalization services and tools.
- Worker 3: frontend API + `StudentWorkspace` additive UI and tests.
- Main thread owns:
  - cross-slice contract alignment
  - prompt runtime authority invariants
  - review-state semantics
  - final integration and acceptance validation

## Public APIs, Interfaces, and Types

- New backend routes:
  - `GET /students/:id/profile-candidates`
  - `POST /students/:id/profile-candidates/:candidateId/approve`
  - `POST /students/:id/profile-candidates/:candidateId/reject`
  - `POST /students/:id/profile-candidates/:candidateId/defer`
  - `POST /students/:id/profile-candidates/promote`
- Extended backend route:
  - `POST /students` accepts optional `starterProfile`
- New canonical backend type family:
  - `StudentProfileCandidate`
  - `StudentProfileCandidateStatus`
  - `StudentProfileCandidateReviewState`
- Extended revision source enum:
  - `starter_profile_form | candidate_promotion | legacy_normalization`
- Tool-only migration surface:
  - one student normalization command under `packages/batch-backend/src/tools/`
  - no new permanent public HTTP route for normalization in v1

## Test Plan

### Backend

- Repository / PG-backed tests:
  - candidate insert/list/dedupe/supersession
  - review state transitions
  - promoted revision linkage
  - starter-profile bundled create flow
- Application tests:
  - candidate generation from snapshot + corroborating lesson memory
  - no candidate leakage into prompt packages
  - approve / edit-and-approve / reject / defer
  - explicit-subset promotion only
  - bounded drafting preserves unrelated sections except allowed coherence edits
  - legacy normalization creates draft revisions only
- Route tests:
  - new candidate endpoints
  - extended `POST /students`
- Prompt/runtime tests:
  - pending/rejected/approved-but-not-promoted candidates do not change prompt package profile resolution
  - only activated revisions affect live prompt generation
- PG-backed lanes should use the documented `BATCH_BACKEND_TEST_PG` host recipe and run serially where shared truncation is an issue.

### Frontend

- `api.ts` tests for new candidate and starter-profile calls.
- `StudentWorkspace` tests for:
  - candidate inspection
  - approve/edit/reject/defer
  - pending vs reviewed vs deferred visibility
  - promotion selection flow
  - starter-profile create flow
  - no regression to current memory/provenance surfaces

### Manual checkpoints

- Checkpoint 1: after backend candidate/review/promotion contracts are green, pause for user review of route behavior and candidate semantics.
- Checkpoint 2: after workspace review/promotion flow is working, pause for user review of the draft UX before adding migration tooling.
- Checkpoint 3: after the normalization tool is working, run one real-student migration and inspect:
  - current profile vs normalized draft
  - prompt-package lineage before/after activation
  - one generated homework output

## Assumptions and Defaults

- Intermediate phases do not need to remain independently usable during active construction.
- Tool-first normalization is the chosen migration surface for v1.
- Candidate generation reuses canonical student-memory outputs rather than introducing a parallel transcript-analysis path.
- Promotion uses constrained LLM drafting for prose quality; selection and authority remain backend-controlled and teacher-approved.
- The current workspace remains the temporary UI home; no frontend polish or major re-layout is required before the workstream is complete.
