# Student System Roadmap

## Meta

- Audience: maintainers, backend/frontend agents.
- Authority Level: implementation roadmap.
- Last Updated: 2026-02-07.

## Purpose

- Define the staged path from current student profile support to a complete student-centric system.
- Keep decisions stable across sessions so implementation can continue without re-planning from scratch.

## Current Baseline

- Student metadata CRUD exists (`/students`).
- Profile content CRUD + revision history exists (`/profiles`, `/profiles/:id/revisions`).
- Prompt package snapshots profile/template hashes and revision IDs.
- Prompt readback exposes drift metadata (`profileDrift`, `templateDrift`).
- Student timeline endpoint exists (`/students/:id/timeline`) with core entities.
- Minimal UI supports student selection, profile editing, revision restore, and prompt drift warnings.

## Return-To-Track Checklist

1. Confirm environment mode for migration completion:
   - `STUDENT_SYSTEM_SOURCE=hybrid`
   - `STUDENT_SYSTEM_FS_FALLBACK=true`
2. Run migration verification:
   - `pnpm --filter @esl-pipeline/batch-backend run student-system:backfill:dry`
   - `pnpm --filter @esl-pipeline/batch-backend run student-system:backfill`
   - `pnpm --filter @esl-pipeline/batch-backend run student-system:verify:oneoff`
3. Cut over to DB-canonical reads in target environment:
   - `STUDENT_SYSTEM_SOURCE=db`
   - `STUDENT_SYSTEM_FS_FALLBACK=false`
4. Validate application health after cutover:
   - `pnpm check:fast`
   - perform one assignment flow through draft -> publish -> rerun audio.
5. Start Phase B implementation only after steps 1-4 are complete and green.

## Design Decisions (Locked)

1. Keep phased delivery (`A` through `E`) with each phase independently mergeable.
2. Unify student/profile source-of-truth toward DB-backed metadata and revision history.
3. Treat prompt templates/profiles as versioned artifacts, not only filesystem files.
4. Preserve compatibility during migration with read-through/fallback behavior.
5. Keep explainability first-class: every generated assignment should be traceable to exact profile/template revisions.

## Phase A: Canonical Data Model + Storage Unification

### Goal

- Remove split-brain storage (JSON/MD files vs DB revisions) for student system core data.

### Status

- Complete (2026-02-07).

### Deliverables

1. Canonical tables for student profile metadata and bindings (DB as source-of-truth).
2. Migration/import tool from current JSON/MD sources into DB records.
3. Compatibility adapter:
   - read DB first
   - optional fallback read from filesystem during transition window.
4. Operational docs:
   - migration runbook
   - rollback strategy.
   - see `docs/reference/STUDENT_SYSTEM_PHASE_A_RUNBOOK.md`.

### Acceptance Criteria

- Student/profile CRUD continues to work with existing API contracts.
- No data loss during import.
- System can run with filesystem fallback disabled in staging.

### Completed Outputs

1. Canonical tables are in place: `students`, `profiles`, `student_profile_bindings`.
2. Backfill tooling exists and has been executed in Docker for the current environment.
3. DB-first + hybrid fallback behavior is wired via `STUDENT_SYSTEM_SOURCE` and `STUDENT_SYSTEM_FS_FALLBACK`.
4. Operational guidance is documented in `docs/reference/STUDENT_SYSTEM_PHASE_A_RUNBOOK.md`.

## Phase B: First-Class Prompt Versioning

### Goal

- Move from hash-only snapshotting to explicit template/profile version lifecycle.

### Deliverables

1. Versioned entities for templates (and template revisions) with statuses:
   - `draft`, `active`, `deprecated`.
2. Optional human version labels (`v1`, `v1.1`, etc.) in addition to immutable IDs/hashes.
3. Prompt package records pinned to immutable profile/template revision references.
4. API additions for viewing revision lineage per prompt package.

### Acceptance Criteria

- Any prompt package can be traced to exact template/profile revisions without filesystem lookups.
- Drift detection works against canonical revision lineage.

### Phase B Ready Gate

1. Prompt package write path stores immutable revision references without filesystem resolution.
2. Read APIs expose revision lineage in a stable shape suitable for UI rendering.
3. Profile/template revision lifecycle includes explicit status transitions (`draft` -> `active` -> `deprecated`).
4. Integration tests prove lineage reconstruction for at least:
   - initial draft publish
   - profile revision restore
   - rerun against a newer profile/template revision.

## Phase C: Historical Student Binding + Governance

### Goal

- Model profile linkage as time-aware history rather than only current state.

### Deliverables

1. Student-profile binding history (`effective_from`, `effective_to`, actor, reason).
2. Resolution rules for prompt generation at creation time:
   - use effective binding at event time.
3. Governance capabilities:
   - revision restore metadata
   - audit actor and reason capture.

### Acceptance Criteria

- Reconstructable answer to: "Which profile binding was active for this assignment?"
- Restores and binding changes appear in audit trail.

## Phase D: End-to-End Lineage + Timeline 2.0

### Goal

- Expose complete student learning/work lifecycle history with actionable diagnostics.

### Deliverables

1. Expanded timeline events:
   - profile saved/restored
   - template revision changes
   - prompt package creation with pinned revisions
   - rerun/cancel/publish outcomes.
2. Event filters and stable ordering guarantees.
3. Explainability endpoint/view for assignment provenance.

### Acceptance Criteria

- Timeline answers "what happened and why" without cross-referencing multiple endpoints manually.
- Operators can debug student-specific issues from timeline + lineage alone.

## Phase E: Student Workspace UX

### Goal

- Deliver a full student-first workspace beyond the minimal assignment UI.

### Deliverables

1. Dedicated student workspace:
   - profile editor with revision history and restore flow
   - assignment history
   - prompt/template lineage surface
   - publish/rerun outcome visibility.
2. Keep minimal UI as compact operational fallback.
3. UX guardrails for destructive/high-impact actions.

### Acceptance Criteria

- Tutor can complete student-focused operations from one workspace without context-switching.
- Minimal UI remains functional and aligned with backend contracts.

## Cross-Phase Non-Negotiables

1. Backward compatibility for active routes unless explicitly versioned.
2. Deterministic IDs and stable pagination semantics.
3. Full test coverage additions per phase (unit + integration; UI tests where applicable).
4. `pnpm check` and CI gates green at each merge point.

## Execution Order

1. Phase A (storage foundation)
2. Phase B (version model)
3. Phase C (binding history and governance)
4. Phase D (lineage and timeline expansion)
5. Phase E (full workspace UX)

## Notes

- This roadmap is intentionally implementation-facing and should be revised only when requirements shift.
- For day-to-day status tracking, mirror progress in `docs/backend-frontend/backend-frontend-alignment.md`.
