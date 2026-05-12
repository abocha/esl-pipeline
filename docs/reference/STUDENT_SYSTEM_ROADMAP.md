# Student System Roadmap

## Meta

- Audience: maintainers, backend/frontend agents.
- Authority Level: implementation roadmap.
- Last Verified Against: 2026-05-12 repo state.
- Owner: backend/frontend maintainers + automation agents.
- Review Cadence: monthly or after student-system milestone changes.
- Status: `roadmap`.

## Purpose

- Keep the phased student-system direction stable.
- Show what is complete versus what still needs UX or operational hardening.

## Current Baseline

- student metadata CRUD is live
- profile revisions and binding history are live
- prompt lineage and drift metadata are live
- student timeline and job provenance are live
- dedicated student-area routes are live for `Overview`, `Learning`, `History`, and Schedule &
  Billing
- the legacy all-in-one workspace route remains as a compatibility/maintenance surface
- Schedule & Billing now owns lesson credits, payments, reminders, and operational scheduling
  state; teacher business dashboard views link back to each student's schedule-billing surface

## Return-To-Track Checklist

1. Confirm Postgres is enabled.
2. Run student backfill verification:
   - `pnpm --filter @esl-pipeline/batch-backend run student-system:backfill:dry`
   - `pnpm --filter @esl-pipeline/batch-backend run student-system:backfill`
   - `pnpm --filter @esl-pipeline/batch-backend run student-system:verify:oneoff`
3. Run `pnpm check:fast`.
4. Validate one assignment flow through draft -> publish -> rerun audio.

## Locked Decisions

1. Delivery stays phased (`A` through `H`).
2. Student/profile data is DB-backed source-of-truth.
3. Prompt templates/profiles are versioned artifacts, not only filesystem assets.
4. Legacy filesystem data is migration input, not runtime truth.
5. Explainability remains first-class.

## Phase Status

### Phase A: Canonical storage unification

- status: complete
- outcome:
  - canonical student/profile/binding tables
  - backfill tooling
  - DB-only runtime behavior
- runbook:
  - [`docs/reference/STUDENT_SYSTEM_PHASE_A_RUNBOOK.md`](STUDENT_SYSTEM_PHASE_A_RUNBOOK.md)

### Phase B: First-class prompt versioning

- status: complete
- outcome:
  - immutable revision lineage
  - activation lifecycle for templates/profiles
  - lineage API for prompt packages, including the canonical assignment-level inspection surface on
    `GET /prompt-packages/:id`

### Phase C: Historical student binding governance

- status: complete
- outcome:
  - time-aware binding history
  - actor/reason capture
  - replayable binding-at-creation semantics

### Phase D: End-to-end lineage and timeline

- status: complete
- outcome:
  - expanded timeline events
  - provenance endpoint
  - durable job-action audit trail

### Phase E: Student workspace UX

- status: complete / maintenance
- current outcome:
  - workspace route is live
  - profile/binding management is live
  - assignment history, timeline, and provenance panels are live
- remaining focus:
  - keep the current workspace operational while traffic moves to the dedicated student-area pages
  - destructive-action guardrails
  - operator-facing chronology cleanup in memory overview panels
    - current `Recent homework memory` can look misleading after backfills because the backend
      overview selects by homework-memory generation recency while the UI displays assignment
      `publishedAt`
    - future UI pass should either sort that overview by `publishedAt DESC` or label the displayed
      timestamp semantics more explicitly
- active docs:
  - [`docs/plans/student-area-redesign/README.md`](../plans/student-area-redesign/README.md)

### Phase F: Teacher-verified profile enrichment

- status: planned
- target outcome:
  - starter teacher-authored profile at student creation
  - generated candidate durable profile facts from canonical student memory
  - teacher review before promotion into foundational profile revisions
- active plan:
  - [`docs/plans/student-profile-enrichment/README.md`](../plans/student-profile-enrichment/README.md)
  - [`docs/plans/student-area-redesign/phase-2-learning-page-and-structured-profile.md`](../plans/student-area-redesign/phase-2-learning-page-and-structured-profile.md)
  - [`docs/plans/student-area-redesign/phase-3-profile-generation-migration-and-prompt-packaging.md`](../plans/student-area-redesign/phase-3-profile-generation-migration-and-prompt-packaging.md)

### Phase G: Live transition and operator adoption

- status: planned
- target outcome:
  - safe mixed-state operation while legacy overloaded profiles still exist
  - one-student-at-a-time normalization into the new profile-plus-memory model
  - operator runbook for live adoption
- note:
  - this is a temporary transition layer, not a new permanent architecture tier
- active docs:
  - [`docs/plans/student-profile-enrichment/phase-5-live-transition-and-operator-adoption.md`](../plans/student-profile-enrichment/phase-5-live-transition-and-operator-adoption.md)
  - [`docs/operations/legacy-profile-normalization.md`](../operations/legacy-profile-normalization.md)

### Phase H: Student area redesign and operational expansion

- status: in progress
- current outcome:
  - dedicated student-area page model is live:
    - `Overview`
    - `Learning`
    - `Schedule & Billing`
    - `History`
  - route-level backend surfaces are live for overview, learning, history, and schedule-billing
  - schedule/billing records lesson credits, lessons, payments, recurrence preferences, and
    reminders
  - business schedule/stats views summarize operational state and deep-link into student
    schedule-billing pages
- remaining focus:
  - structured canonical learner profile replacing markdown authoring as the long-term product
    model
  - continued visual convergence across student-area pages
  - adoption cleanup as the old workspace becomes less central
- active docs:
  - [`docs/plans/student-area-redesign/README.md`](../plans/student-area-redesign/README.md)
  - [`docs/reference/SCHEDULE_BILLING_PRODUCT_DECISIONS.md`](SCHEDULE_BILLING_PRODUCT_DECISIONS.md)
  - [`docs/reference/TEACHER_BUSINESS_DASHBOARD_PRODUCT_DRAFT.md`](TEACHER_BUSINESS_DASHBOARD_PRODUCT_DRAFT.md)
  - [`docs/plans/student-area-redesign/phase-1-information-architecture-and-domain-boundaries.md`](../plans/student-area-redesign/phase-1-information-architecture-and-domain-boundaries.md)
  - [`docs/plans/student-area-redesign/phase-4-overview-page-and-cross-domain-summaries.md`](../plans/student-area-redesign/phase-4-overview-page-and-cross-domain-summaries.md)
  - [`docs/plans/student-area-redesign/phase-5-scheduling-billing-reminders-and-history.md`](../plans/student-area-redesign/phase-5-scheduling-billing-reminders-and-history.md)

## Cross-Phase Rules

1. Keep active routes backward-compatible unless explicitly versioned.
2. Preserve deterministic IDs and stable pagination/filter semantics.
3. Add tests with each phase slice.
4. Keep backend governance and frontend UX in sync.

## Related

- [`docs/reference/STUDENT_SYSTEM_PHASE_A_RUNBOOK.md`](STUDENT_SYSTEM_PHASE_A_RUNBOOK.md)
- [`docs/backend-frontend/backend-frontend-alignment.md`](../backend-frontend/backend-frontend-alignment.md)
- [`docs/plans/README.md`](../plans/README.md)
