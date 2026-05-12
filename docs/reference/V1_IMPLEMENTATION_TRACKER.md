# V1 Implementation Tracker

## Meta

- Audience: founder-maintainer and AI execution support.
- Read Time: 5 minutes.
- Authority Level: V1 execution source of truth.
- Last Verified Against: 2026-05-12 repo state.
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

- Active workstream: `MVP readiness evidence`
- Current objective:
  - collect founder-operator evidence against the North Star
  - verify one real assignment run can publish within the target time
  - confirm lesson-credit/payment tracking is usable from the student and business surfaces
- Today `Now` slice:
  - run one timed founder-operator assignment flow
  - record whether draft generation, validation, publish, audio, and lesson-credit tracking complete without manual fallback
  - attach one evidence line with timing, provider/model, and any support intervention

## Delivery Rules

1. One active workstream at a time.
2. If blocked for 20 minutes, shrink scope instead of switching.
3. If two or more readiness metrics are red, the next session is reliability-only.

## Workstream Status

| Workstream                     | Status      | Gate / Note                           |
| ------------------------------ | ----------- | ------------------------------------- |
| WS0 delivered foundations      | complete    | historical baseline                   |
| WS1 CEFR baseline presets      | complete    | shipped                               |
| WS6 readiness instrumentation  | complete    | shipped                               |
| WS2A preset plumbing MVP       | complete    | shipped                               |
| WS2B direct LLM generation     | complete    | shipped                               |
| WS3 TTS abstraction + fallback | complete    | shipped                               |
| WS5 cost and quota policy      | complete    | MVP guardrails shipped; monitor usage |
| WS4 CRM-lite lesson ledger     | complete    | MVP student/business surfaces shipped |
| Stabilization and gate review  | complete    | current release-tip checks passed     |
| MVP readiness evidence         | in progress | current active lane                   |

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

## MVP Completion Audit

Prompt-to-artifact checklist for the current MVP definition:

| Requirement                                                                                      | Evidence                                                                                                                                        | State                         |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Guided assignment flow from recording/transcript to draft, validation, publish, and job tracking | Backend/frontend alignment marks recording, prompt package, draft, publish approve, and job actions done; `pnpm check:fast` passed on `v6.5.1`. | Implemented; needs timed run  |
| One trusted `general-english` preset content track and DB-canonical prompt governance            | Product scope and prompt-gallery docs route to `hw_prompt_definitive.md`; prompt catalog runtime is DB-canonical in alignment tracker.          | Implemented                   |
| Direct LLM draft generation through backend API and guided UX                                    | `POST /generation/drafts`, `GenerateDraft*` DTOs, generation provider/model selection, and quota UI tests are present.                          | Implemented                   |
| Low-cost/non-premium TTS fallback plus provider abstraction                                      | Alignment tracker marks direct generation, TTS fallback, and safety guardrails shipped; contract/provider tests are in fast lane.               | Implemented                   |
| Cost/quota guardrails for generation                                                             | `GenerationQuotaView`, budget counters, quota-window helper/tests, and backend budget guard are present; release-tip fast checks passed.        | MVP complete; monitor usage   |
| CRM-lite lesson ledger and remaining lesson visibility                                           | Schedule & Billing records lesson credits/payments/lessons/reminders; business schedule/stats link to student schedule-billing surfaces.        | Implemented                   |
| Objective readiness proof against North Star (`<=12 min`, no manual fallback, reliable tracking) | No current real timed founder-operator run is recorded in this tracker.                                                                         | Missing; current active slice |
| Broader beta readiness evidence from real tutors                                                 | Product readiness doc requires real repeated tutor use and two green weeks before broadening beta.                                              | Not achieved; post-MVP gating |

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
- weekly reset / low-energy continuity:
  - [`docs/playbooks/RESTART_TOMORROW.md`](../playbooks/RESTART_TOMORROW.md)
