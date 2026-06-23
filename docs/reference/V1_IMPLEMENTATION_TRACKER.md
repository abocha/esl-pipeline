# V1 Implementation Tracker

## Meta

- Audience: founder-maintainer and AI execution support.
- Read Time: 5 minutes.
- Authority Level: V1 execution source of truth.
- Last Verified Against: 2026-06-23 alpha-readiness planning state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: weekly while V1 execution remains active.
- Status: `roadmap`.

## Purpose

- Keep current execution state visible without re-reading historical delivery notes.
- Point returning sessions at the active workstream, current gate, and next evidence to collect.

## Use This Quickly

1. Read `Current Focus`.
2. Do only the `Now` slice.
3. Run the listed checks.
4. Record one evidence line.
5. Stop after one meaningful slice.

Historical shipped detail moved to:

- [`docs/archive/reference/2026-03/v1-implementation-tracker-history.md`](../archive/reference/2026-03/v1-implementation-tracker-history.md)

## Scope Lock

1. MVP ships one trusted preset content track only: `general-english`.
2. Prompt governance is immutable snapshots plus stable aliasing.
3. Provider/model control remains separate from preset semantics.
4. Reliability and guardrails take priority over feature breadth when readiness signals are red.

## Current Focus

- Active workstream: `Pre-alpha tutor evidence and UI distillation`
- Current objective:
  - make the one-tutor core flow calm, legible, and repeatable
  - convert reproduced tutor friction into narrow fixes
  - admit the 3–5 tutor closed-alpha cohort only from observed evidence
- Today `Now` slice:
  - execute Chunk 12 in `docs/plans/2026-06-23-alpha-readiness.md`
  - record the next tutor session against the canonical readiness scorecard
  - if two or more readiness metrics are red, treat the next slice as reliability-only

## Delivery Rules

1. One active workstream at a time.
2. If blocked for 20 minutes, shrink scope instead of switching.
3. If two or more readiness metrics are red, the next session is reliability-only.

## Workstream Status

| Workstream                     | Status      | Gate / Note                            |
| ------------------------------ | ----------- | -------------------------------------- |
| WS0 delivered foundations      | complete    | historical baseline                    |
| WS1 CEFR baseline presets      | complete    | shipped                                |
| WS6 readiness instrumentation  | complete    | shipped                                |
| WS2A preset plumbing MVP       | complete    | shipped                                |
| WS2B direct LLM generation     | complete    | shipped                                |
| WS3 TTS abstraction + fallback | complete    | shipped                                |
| WS5 cost and quota policy      | complete    | MVP guardrails shipped; monitor usage  |
| WS4 CRM-lite lesson ledger     | complete    | MVP student/business surfaces shipped  |
| Stabilization and gate review  | complete    | current release-tip checks passed      |
| MVP readiness evidence         | complete    | founder-operator proof passed          |
| Pre-alpha tutor evidence       | in progress | one-tutor core-flow proof and Chunk 12 |

## Latest Evidence

- 2026-05-12 release-tip stabilization:
  - `pnpm docs:check` passed on `v6.5.1`.
  - `pnpm check:fast` passed on `v6.5.1`:
    - orchestrator boundary guard passed
    - contract-version consistency passed (`db: 0.12.0`, latest migration `0028_student_lesson_recurrence_core`)
    - workspace build and lint passed
    - prebuilt fast unit lanes passed:
      - orchestrator: 19 files / 75 tests
      - batch-frontend: 35 files / 193 tests
      - batch-backend: 100 files / 563 tests
- 2026-05-12 MVP founder-operator evidence:
  - Fixed auto-publish draft materialization so `autoPublish: true` uses
    `approveJobForPipeline`, which both approves and enqueues the BullMQ worker job.
  - Timed live probe passed in 56.7 seconds end to end on the local Docker stack:
    - prompt package: `95029b01-f856-4a37-9ba2-7c61f8828293`
    - draft: `6a01b870-bff7-481e-afc8-1ef89288260e`
    - job: `1fcd83a2-a18f-44ed-9ac9-41946ae3409e`
    - provider/model: `google_ai_studio` / `gemini-3-flash-preview`
    - publish TTS: Google `chirp3_hd`
    - validation errors: `0`
    - final state: `succeeded`
    - published HTML:
      `https://esl-notion-tts.s3.ap-southeast-1.amazonaws.com/audio/assignments/materials/html/artifacts/d959f87c5227a9536a7b5c7cdd335cc68bba21536af86b43e1173e1661bbffed.html`
  - Lesson-credit/payment tracking probe on a disposable archived student:
    - package/payment recorded: 4 purchased, 0 consumed, 4 remaining
    - completed lesson recorded: 4 purchased, 1 consumed, 3 remaining
    - schedule-billing surface returned matching balance and reminders
    - disposable probe student archived during cleanup

## MVP Completion Audit

Prompt-to-artifact checklist for the current MVP definition:

| Requirement                                                                                      | Evidence                                                                                                                                                                                                     | State                         |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| Guided assignment flow from recording/transcript to draft, validation, publish, and job tracking | Live probe created a prompt package, generated a draft, validated it with 0 errors, materialized/auto-published, and observed job `1fcd83a2-a18f-44ed-9ac9-41946ae3409e` reach `succeeded` with an HTML URL. | MVP evidence passed           |
| One trusted `general-english` preset content track and DB-canonical prompt governance            | Product scope and prompt-gallery docs route to `hw_prompt_definitive.md`; prompt catalog runtime is DB-canonical in alignment tracker.                                                                       | Implemented                   |
| Direct LLM draft generation through backend API and guided UX                                    | `POST /generation/drafts`, `GenerateDraft*` DTOs, generation provider/model selection, and quota UI tests are present.                                                                                       | Implemented                   |
| Low-cost/non-premium TTS fallback plus provider abstraction                                      | Alignment tracker marks direct generation, TTS fallback, and safety guardrails shipped; contract/provider tests are in fast lane.                                                                            | Implemented                   |
| Cost/quota guardrails for generation                                                             | `GenerationQuotaView`, budget counters, quota-window helper/tests, and backend budget guard are present; release-tip fast checks passed.                                                                     | MVP complete; monitor usage   |
| CRM-lite lesson ledger and remaining lesson visibility                                           | Schedule & Billing records lesson credits/payments/lessons/reminders; business schedule/stats link to student schedule-billing surfaces.                                                                     | Implemented                   |
| Objective readiness proof against North Star (`<=12 min`, no manual fallback, reliable tracking) | Live Docker-stack probe completed in 56.7 seconds with direct generation, validation, Google TTS publish, job tracking, and lesson-credit/payment tracking evidence.                                         | MVP evidence passed           |
| Broader beta readiness evidence from real tutors                                                 | Product readiness doc requires real repeated tutor use and two green weeks before broadening beta.                                                                                                           | Not achieved; post-MVP gating |

## Current Gate Checks

Run as needed for the active lane:

```bash
pnpm check:fast
pnpm docs:check
```

Targeted follow-through depends on the current slice:

- readiness / quota / provider behavior:
  - inspect the relevant backend telemetry and UI signals
- founder-operator MVP proof:
  - record one timed assignment flow and lesson-credit tracking pass/fail in this tracker
- workflow-specific implementation:
  - use the active plan/topic README rather than reopening archived history

## Next Routing

- preset and provider semantics:
  - [`docs/reference/PRESET_V2_SPEC.md`](PRESET_V2_SPEC.md)
  - [`docs/reference/GENERATION_PROVIDER_POLICY.md`](GENERATION_PROVIDER_POLICY.md)
- broader planning surfaces:
  - [`docs/plans/README.md`](../plans/README.md)
  - [`docs/plans/2026-06-23-alpha-readiness.md`](../plans/2026-06-23-alpha-readiness.md)
- weekly reset / low-energy continuity:
  - [`docs/playbooks/RESTART_TOMORROW.md`](../playbooks/RESTART_TOMORROW.md)
