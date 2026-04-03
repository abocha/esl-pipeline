# V1 Implementation Tracker

## Meta

- Audience: founder-maintainer and AI execution support.
- Read Time: 5 minutes.
- Authority Level: V1 execution source of truth.
- Last Verified Against: 2026-03-13 repo state.
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

- Active workstream: `Stabilization and gate review`
- Current objective:
  - verify WS2B + WS3/WS3.5 stability
  - confirm readiness drift and quota-window behavior
  - record the current WS5 go/no-go state explicitly
- Today `Now` slice:
  - run stabilization checks
  - update the go/no-go note
  - attach one evidence line

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
| WS5 cost and quota policy      | parked      | depends on stabilized usage telemetry |
| WS4 CRM-lite lesson ledger     | parked      | depends on stable assignment flow     |
| Stabilization and gate review  | in progress | current active lane                   |

## Current Gate Checks

Run as needed for the active lane:

```bash
pnpm check:fast
pnpm docs:check
```

Targeted follow-through depends on the current slice:

- readiness / quota / provider behavior:
  - inspect the relevant backend telemetry and UI signals
- workflow-specific implementation:
  - use the active plan/topic README rather than reopening archived history

## Next Routing

- preset and provider semantics:
  - [`docs/reference/PRESET_V2_SPEC.md`](PRESET_V2_SPEC.md)
  - [`docs/reference/GENERATION_PROVIDER_POLICY.md`](GENERATION_PROVIDER_POLICY.md)
- broader planning surfaces:
  - [`docs/plans/README.md`](../plans/README.md)
- weekly reset / low-energy continuity:
  - [`START_HERE.md`](../../START_HERE.md)
  - [`docs/playbooks/RESTART_TOMORROW.md`](../playbooks/RESTART_TOMORROW.md)
