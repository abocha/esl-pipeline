# Student System Roadmap

## Meta

- Audience: maintainers, backend/frontend agents.
- Authority Level: implementation roadmap.
- Last Verified Against: 2026-07-06 repo state.
- Owner: backend/frontend maintainers + automation agents.
- Review Cadence: monthly or after student-system milestone changes.
- Status: `roadmap`.

## Purpose

- Keep the phased student-system direction stable.
- Record phased implementation and product direction without treating source presence as proof of
  deployment, live activation, cohort readiness, or product-phase acceptance.

This roadmap contains historical phase labels and implementation observations. The labels have not
been reconciled against current product decisions or live operator evidence. Current source and
package owners establish implementation; product and operator evidence establish activation and
readiness. Use the [Linear product backlog](../../AGENTS.md#planning-github-and-repository-administration)
and the relevant operational owner for current status.

## Current Baseline

- repository source implements student metadata CRUD; profile revisions and binding history;
  prompt lineage and drift metadata; and student timeline and job provenance
- dedicated student-area routes exist in source for `Overview`, `Learning`, `History`, and
  Schedule & Billing; the legacy all-in-one workspace has been retired from the frontend source
- Schedule & Billing owns lesson credits, payments, reminders, and operational scheduling state in
  source; teacher business dashboard views link back to each student's schedule-billing surface
- source includes teacher-confirmed homework follow-ups for elapsed scheduled lessons; published
  homework retains `lessonId` lineage through assignment and memory records

## Return-To-Track Checklist

1. Confirm Postgres is enabled.
2. Run student backfill verification:
   - `pnpm --filter @esl-pipeline/batch-backend run student-system:backfill:dry`
   - `pnpm --filter @esl-pipeline/batch-backend run student-system:backfill`
   - `pnpm --filter @esl-pipeline/batch-backend run student-system:verify:oneoff`
3. Run focused checks for the changed student-system package(s), then rely on hosted PR CI and
   `CI gate` for comprehensive validation.
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
  - workspace route exists in source
  - profile/binding management exists in source
  - assignment history, timeline, and provenance panels exist in source
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

- status: implementation present; product phase completion and production activation unverified
- status boundary:
  - current source implements initial profile enrichment, candidate generation, and teacher review
  - source presence does not prove production activation, cohort readiness, or phase acceptance;
    confirm those states with product and operator evidence
- target outcome:
  - starter teacher-authored profile at student creation
  - automatic one-time evidence enrichment for an empty or tutor-seeded profile during the first
    eligible confirmed lesson, with optional correction on the Student Learning page
  - generated candidate durable profile facts from canonical student memory
  - teacher review before promotion into foundational profile revisions
- active plan:
  - [`docs/design/FIRST_PROFILE_ONBOARDING.md`](../design/FIRST_PROFILE_ONBOARDING.md)
  - [`docs/plans/student-profile-enrichment/README.md`](../plans/student-profile-enrichment/README.md)
  - archived phase rationale: [`phase 2`](../archive/plans/student-area-redesign/phase-2-learning-page-and-structured-profile.md)
  - archived phase rationale: [`phase 3`](../archive/plans/student-area-redesign/phase-3-profile-generation-migration-and-prompt-packaging.md)

### Phase G: Live transition and operator adoption

- recorded status: planned in the archived phase plan; current implementation and activation status
  are not established by that label
- target outcome:
  - safe mixed-state operation while legacy overloaded profiles still exist
  - one-student-at-a-time normalization into the new profile-plus-memory model
  - operator runbook for live adoption
- note:
  - this is a temporary transition layer, not a new permanent architecture tier
- active docs:
  - archived phase rationale: [`phase 5 live transition and operator adoption`](../archive/plans/student-profile-enrichment/phase-5-live-transition-and-operator-adoption.md)
  - [`docs/operations/legacy-profile-normalization.md`](../operations/legacy-profile-normalization.md)

### Phase H: Student area redesign and operational expansion

- recorded status: in progress; product-phase completion and live activation have not been
  reconciled against current product and operator evidence
- current outcome:
  - repository source contains the dedicated student-area page model:
    - `Overview`
    - `Learning`
    - `Schedule & Billing`
    - `History`
  - route-level backend surfaces exist for overview, learning, history, and schedule-billing
  - schedule/billing records lesson credits, lessons, payments, recurrence preferences, and
    reminders
  - business schedule/stats views summarize operational state and deep-link into student
    schedule-billing pages
  - source includes elapsed-lesson homework follow-ups across student and business schedule
    surfaces
- implementation owners:
  - [batch-frontend README](../../packages/batch-frontend/README.md)
  - [batch-backend README](../../packages/batch-backend/README.md)
- remaining focus:
  - structured canonical learner profile replacing markdown authoring as the long-term product
    model
  - continued visual convergence across student-area pages
  - adoption cleanup as the old workspace becomes less central
- active docs:
  - [`docs/plans/student-area-redesign/README.md`](../plans/student-area-redesign/README.md)
  - [`docs/reference/SCHEDULE_BILLING_PRODUCT_DECISIONS.md`](SCHEDULE_BILLING_PRODUCT_DECISIONS.md)
  - [`docs/reference/TEACHER_BUSINESS_DASHBOARD_PRODUCT_DRAFT.md`](TEACHER_BUSINESS_DASHBOARD_PRODUCT_DRAFT.md)
  - archived phase rationale: [`phase 1`](../archive/plans/student-area-redesign/phase-1-information-architecture-and-domain-boundaries.md)
  - archived phase rationale: [`phase 4`](../archive/plans/student-area-redesign/phase-4-overview-page-and-cross-domain-summaries.md)
  - archived phase rationale: [`phase 5 scheduling, billing, reminders, and history`](../archive/plans/student-area-redesign/phase-5-scheduling-billing-reminders-and-history.md)

## Cross-Phase Rules

1. Keep active routes backward-compatible unless explicitly versioned.
2. Preserve deterministic IDs and stable pagination/filter semantics.
3. Add tests with each phase slice.
4. Keep backend governance and frontend UX in sync.

## Related

- [`docs/reference/STUDENT_SYSTEM_PHASE_A_RUNBOOK.md`](STUDENT_SYSTEM_PHASE_A_RUNBOOK.md)
- [`docs/backend-frontend/backend-frontend-alignment.md`](../backend-frontend/backend-frontend-alignment.md)
- [`docs/plans/README.md`](../plans/README.md)
