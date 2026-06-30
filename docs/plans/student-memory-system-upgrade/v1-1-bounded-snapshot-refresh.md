# Student Memory v1.1 Bounded Snapshot Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make normal student-memory snapshot refresh bounded, observable, and safe before Closed
Alpha without refactoring the stable assignment-generation path.

**Architecture:** Keep v1 memory artifacts and deterministic backend retrieval. Change the normal
snapshot-refresh worker from full-history rebuild to previous snapshot + trigger source + bounded
supporting context, while preserving explicit manual rebuild/backfill paths. Store v1.1 strategy,
coverage, metrics, and candidate-refresh decisions in typed `generation_notes` first.

**Tech Stack:** TypeScript, Node.js 24, pnpm, Vitest, Postgres-backed repositories, existing
batch-backend student-memory queue, existing batch-frontend Learning page.

---

## Meta

- Audience: implementation agents, founder-maintainer, backend/frontend maintainers.
- Status: `active`.
- Last Verified Against: 2026-07-01 repo state.
- Exit Trigger: archive after v1.1 is implemented, validated, and represented in the student-memory
  roadmap plus backend/frontend docs.
- Current Focus: execute Phases 0-4 before admitting the Closed Alpha cohort.
- Source Design: [`docs/reference/STUDENT_MEMORY_V1_1_DESIGN.md`](../../reference/STUDENT_MEMORY_V1_1_DESIGN.md).
- Release Anchor: [`docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`](../../reference/PRODUCT_NORTH_STAR_AND_READINESS.md).

## Release Schedule Mapping

| Readiness stage                    | v1.1 expectation                                                                                                                         | Required phases  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Gate A: Founder-Operator Stability | Founder can see snapshot cost/size and reproduce the existing full-history waste.                                                        | Phase 0          |
| Gate B: Pre-Alpha, 1 tutor         | Normal refresh is incremental, bounded, budget-guarded, and does not create avoidable candidate noise.                                   | Phases 1-3       |
| Gate C: Closed Alpha, 3-5 tutors   | Founder/operator can inspect stale/failed/expensive memory state in-app without using OpenAI Platform logs as the primary debug surface. | Phase 4          |
| Closed Alpha follow-up             | Improve display polish and optional grouping/diff views only after tutor evidence shows need.                                            | Phase 5          |
| Beta or later                      | Embeddings, semantic ranking, public explainability, lifecycle/privacy workflows, and memory editing UX.                                 | Not in this plan |

## File Map

Backend application:

- Modify: `packages/batch-backend/src/application/process-student-memory-snapshot-job.ts`
- Modify: `packages/batch-backend/src/application/student-memory-snapshot-prompt.ts`
- Modify: `packages/batch-backend/src/application/student-memory-snapshot-generation.ts`
- Modify: `packages/batch-backend/src/application/request-student-memory-snapshot-refresh.ts`
- Modify: `packages/batch-backend/src/application/student-memory-inspection.ts`
- Modify: `packages/batch-backend/src/application/student-profile-candidates.ts`
- Modify: `packages/batch-backend/src/application/process-student-profile-candidate-refresh-job.ts`
- Modify: `packages/batch-backend/src/tools/refresh-student-memory-snapshots.ts`
- Maybe modify: `packages/batch-backend/src/application/student-memory-snapshot-backfill.ts`

Backend domain and config:

- Modify: `packages/batch-backend/src/domain/student-memory-snapshot-model.ts`
- Modify: `packages/batch-backend/src/domain/student-memory-snapshot-repository.ts`
- Modify: `packages/batch-backend/src/domain/lesson-memory-repository.ts` only if source-id lookup
  helpers are missing.
- Modify: `packages/batch-backend/src/domain/homework-memory-repository.ts` only if source-id lookup
  helpers are missing.
- Avoid initially: `packages/batch-backend/schema.sql`, unless implementation proves explicit
  columns are necessary.

Frontend:

- Modify: `packages/batch-frontend/src/utils/api.ts`
- Modify: `packages/batch-frontend/src/ui/students/StudentLearningPage.tsx`
- Modify: `packages/batch-frontend/src/ui/students/StudentLearningPage.test.tsx`
- Maybe modify: `packages/batch-frontend/src/ui/students/WorkspaceInspectionPanel.tsx`

Tests:

- Modify: `packages/batch-backend/tests/application.process-student-memory-snapshot-job.test.ts`
- Modify: `packages/batch-backend/tests/application.student-memory-snapshot-generation.test.ts`
- Modify: `packages/batch-backend/tests/application.request-student-memory-snapshot-refresh.test.ts`
- Modify: `packages/batch-backend/tests/application.student-memory-inspection.test.ts`
- Modify: `packages/batch-backend/tests/application.student-profile-candidates.test.ts`
- Modify: `packages/batch-frontend/src/utils/api.student-memory.test.ts`

Docs:

- Modify after implementation: `docs/plans/student-memory-system-upgrade/README.md`
- Modify after implementation: `docs/backend-frontend/backend-frontend-alignment.md` if API/UI
  behavior changes.
- Modify after implementation: `packages/batch-backend/README.md` if CLI/tool semantics change.

## Phase 0: Confirm And Instrument

Release tie: Gate A and Gate B entry. This phase is behavior-preserving.

- [ ] Add typed snapshot generation-note helpers for v1.1 metadata.
  - `strategy` initially records `full_rebuild_v1` for current normal behavior.
  - `trigger`, `triggerSourceKind`, `triggerSourceEntryId`, `included*Ids`, `covered*Ids`,
    `inputTokenEstimate`, `promptByteLength`, and `materialChange` are represented in one typed
    helper.
- [ ] Reuse `estimateGenerationTokens` from the existing generation-budget path for snapshot prompt
      estimates.
- [ ] Record prompt byte length, estimated input tokens, source counts, strategy, and trigger before
      the provider call.
- [ ] Preserve current prompt content and current full-history behavior.
- [ ] Expose the new metrics through the existing memory snapshot list/overview records.
- [ ] Add tests that prove current normal refresh records `full_rebuild_v1` and all included source
      counts without changing generator inputs.
- [ ] Run:
  - `pnpm --filter @esl-pipeline/batch-backend exec vitest run --config ../../vitest.config.ts tests/application.process-student-memory-snapshot-job.test.ts tests/application.student-memory-snapshot-generation.test.ts tests/application.student-memory-inspection.test.ts`

Exit criteria:

- A real or fixture-backed active student can show the approximate prompt size and all included
  lesson/homework source counts.
- Assignment generation, lesson memory, and homework memory behavior are unchanged.

## Phase 1: Incremental Snapshot Default

Release tie: Gate B blocker. This phase changes normal snapshot behavior.

- [ ] Add dependency seams in `process-student-memory-snapshot-job.ts` for:
  - latest ready snapshot lookup,
  - lesson-memory source lookup by `sourceEntryId`,
  - homework-memory source lookup by `sourceEntryId`,
  - recent ready lesson memory limited to 2,
  - recent ready homework memory limited to 1.
- [ ] Add `buildIncrementalStudentMemorySnapshotPrompt` and
      `buildIncrementalStudentMemorySnapshotEnvelope`.
- [ ] Add bootstrap prompt behavior with strategy `bootstrap_incremental_v1_1` when no previous
      ready snapshot exists.
- [ ] Keep the existing full-history prompt builder, but route it only through explicit manual
      rebuild/backfill strategy.
- [ ] Store included source ids separately from covered source ids in `generation_notes`.
- [ ] Update the refresh/backfill tool so manual replay requires or derives an explicit strategy and
      operator reason.
- [ ] Add tests proving normal `lesson-memory-ready` and `homework-memory-ready` jobs do not call the
      full-history list-all path.
- [ ] Add tests proving incremental prompts include previous snapshot, trigger source, and bounded
      supporting context.
- [ ] Run:
  - `pnpm --filter @esl-pipeline/batch-backend exec vitest run --config ../../vitest.config.ts tests/application.process-student-memory-snapshot-job.test.ts tests/application.request-student-memory-snapshot-refresh.test.ts tests/application.student-memory-snapshot-generation.test.ts`

Exit criteria:

- Normal lesson/homework memory completion triggers `incremental_v1_1` or
  `bootstrap_incremental_v1_1`, never implicit full-history rebuild.
- Manual rebuild remains available and explicit.
- Normal active-student snapshot prompt size is targeted at roughly 15k-30k input tokens.

## Phase 2: Hard Budgets And Safe Failure

Release tie: Gate B blocker. This phase prevents silent regressions.

- [ ] Add configurable constants or env-backed config for:
  - incremental target input tokens: 25,000,
  - incremental hard input tokens: 35,000,
  - full rebuild warning input tokens: 60,000.
- [ ] Preflight incremental prompts before provider calls.
- [ ] Drop optional supporting context before failing an oversized incremental prompt.
- [ ] Fail the pending snapshot with a clear diagnostic if the hard budget is still exceeded.
- [ ] Warn but allow explicit manual rebuilds over the full-rebuild warning threshold.
- [ ] Store budget decision and failure details in `generation_notes`.
- [ ] Add tests proving oversized incremental prompts fail before provider execution.
- [ ] Run:
  - `pnpm --filter @esl-pipeline/batch-backend exec vitest run --config ../../vitest.config.ts tests/application.process-student-memory-snapshot-job.test.ts tests/application.student-memory-generation-pacing.test.ts`

Exit criteria:

- A normal incremental snapshot refresh cannot silently send a 120k-token prompt.
- Manual full rebuild can still run only through an explicit higher-risk path.

## Phase 3: Candidate Refresh Gating

Release tie: Gate B blocker, with direct support-load impact before Gate C.

- [ ] Add exact normalized hash helpers for snapshot personal facts and whole snapshot content where
      needed.
- [ ] Gate profile-candidate refresh after snapshot generation using:
  - trigger source contains non-transient profile-worthy `studentFacts`, or
  - personal-facts hash changed, or
  - durable preferences/constraints changed, or
  - manual replay explicitly requested candidate refresh.
- [ ] Stop inserting duplicate/stale candidate records by default.
- [ ] Return and record skipped duplicate/stale/no-profile-worthy-delta counts.
- [ ] Preserve a future debug/audit seam, but do not expose rejected duplicates as first-class review
      artifacts by default.
- [ ] Add tests proving candidate refresh is skipped when no profile-worthy delta exists.
- [ ] Add tests proving existing pending/approved/promoted candidates suppress duplicate insertion.
- [ ] Run:
  - `pnpm --filter @esl-pipeline/batch-backend exec vitest run --config ../../vitest.config.ts tests/application.process-student-memory-snapshot-job.test.ts tests/application.student-profile-candidates.test.ts`

Exit criteria:

- Candidate refresh no longer runs blindly after every snapshot.
- Duplicate/stale candidate rows stop inflating the candidate review surface by default.

## Phase 4: Operator Memory Observability

Release tie: Gate C entry. This phase makes supervised alpha support practical.

- [ ] Extend `student-memory-inspection.ts` to return a compact memory health/debug payload.
- [ ] Include latest snapshot strategy, trigger, parent id, prompt metrics, included counts, covered
      counts, content hash, material-change status, latest failed reason, and candidate refresh counts.
- [ ] Extend `packages/batch-frontend/src/utils/api.ts` types and fetch helpers.
- [ ] Extend the Learning page memory section with a collapsed support/details section for
      operator-facing memory details.
- [ ] Keep manual full rebuild hidden from normal tutor-facing UI. Gate B rebuild remains CLI-only;
      a guarded operator app action can be considered no earlier than Gate C.
- [ ] Add frontend tests for the rendered support details and fallback states.
- [ ] Run:
  - `pnpm --filter @esl-pipeline/batch-backend exec vitest run --config ../../vitest.config.ts tests/application.student-memory-inspection.test.ts`
  - `pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/utils/api.student-memory.test.ts src/ui/students/StudentLearningPage.test.tsx`

Exit criteria:

- Founder/operator can answer why a student's memory is stale, failed, expensive, or not producing
  candidates from the Learning page support details without starting in OpenAI Platform logs.
- Normal tutor UI remains focused on the Learning task.

## Phase 5: Closed Alpha Follow-Up Polish

Release tie: during Closed Alpha only if tutor/operator evidence justifies it.

- [ ] Reassess whether the Learning page support/details section has become noisy enough to move
      behind a stronger admin gate or separate internal route.
- [ ] Add candidate grouping/filtering only if rejected/stale history remains useful after Phase 3.
- [ ] Add snapshot diff display only if support sessions repeatedly need it.
- [ ] Consider explicit columns only if operators need cross-student filtering, sorting, or cost
      reports.
- [ ] Keep memory editing UX, semantic retrieval, embeddings, public explainability, and
      data-lifecycle workflows out of this phase.

Exit criteria:

- Follow-up work is based on Gate B/C evidence, not speculative dashboard completeness.

## Final Validation Before Handoff

- [ ] Run docs checks after plan/doc edits:
  - `pnpm docs:generate:indexes`
  - `pnpm docs:check`
- [ ] Run behavior checks after implementation phases:
  - `pnpm --silent run check:fast:agent`
- [ ] Run broader validation before PR if Phases 1-4 land together:
  - `pnpm check:pre-pr`
- [ ] If migrations or `schema.sql` are touched, also run:
  - `pnpm release:verify:contracts`
  - `pnpm --filter @esl-pipeline/batch-backend run db:verify-baseline`

## Locked Founder Product Decisions

These decisions are locked for v1.1 and should not block backend Phases 0-3:

1. Put operator memory details directly on the student Learning page behind a collapsed
   support/details section. Defer a separate internal route unless the Learning surface becomes noisy
   after Gate C.
2. Keep memory stale/failed states founder/operator-only for v1.1. Do not expose technical memory
   health labels to normal tutors until Closed Alpha evidence shows tutor-facing value.
3. Keep manual full rebuild CLI-only during Gate B. Consider a guarded operator app action no earlier
   than Gate C; normal tutor-facing rebuild controls are out of scope.
