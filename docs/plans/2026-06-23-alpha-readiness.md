# Alpha Readiness Plan

## Meta

- Audience: founder-maintainer and implementation agents.
- Status: `roadmap`.
- Last Verified Against: 2026-07-16 repo state and v9.11.0 deployment; 2026-07-14 manual main-flow
  smoke.
- Exit Trigger: archive after v1 production readiness or replacement by a later evidence-backed
  launch plan.
- Current Focus: collect clean invite-path evidence, continue supervised tutor feedback intake, and
  open reliability work only from reproduced evidence.

## Purpose

Route the remaining path from the current private deployment to a trustworthy closed alpha. This
document is a work router, not a diary of already-shipped implementation detail.

The authoritative launch-stage policy is
[`docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`](../reference/PRODUCT_NORTH_STAR_AND_READINESS.md).
Deployment evidence lives in
[`docs/operations/hosted-mvp-evidence.md`](../operations/hosted-mvp-evidence.md).

## Launch Stages

| Stage        | Tutor cohort   | Intent                                                        | Exit evidence                                                            |
| ------------ | -------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Pre-alpha    | 1 tutor        | Prove the core flow and remove observed friction.             | The tutor repeatedly completes the core flow with bounded support.       |
| Closed alpha | 3–5 tutors     | Establish repeatable value and reliability under supervision. | Scorecard trends and feedback support a broader cohort.                  |
| Closed beta  | 6–10 tutors    | Test simplicity and supportability across varied usage.       | The readiness scorecard is mostly green for two consecutive weeks.       |
| v1 readiness | Evidence-based | Decide whether the service is ready for production launch.    | Reliability, support load, and weekly tutor value meet canonical policy. |

## Current Work

### Chunk 14: Tutor-Flow Evidence

Status: active evidence intake.

- Record where real tutors hesitate, fail, or require founder help.
- Preserve exact route, action, visible message, and recovery path.
- Convert only repeated or launch-blocking evidence into implementation work.
- Keep the latest v9.10.0 manual main-flow smoke distinct from the v9.11.0 automated deployment
  checks and the still-open invite bootstrap smoke in
  [`slice-2-invite-workspace-first-student.md`](slice-2-invite-workspace-first-student.md).

Exit: the pre-alpha tutor can repeatedly complete invite/login, first-student setup, assignment
creation, publish/share, and the expected follow-up flow.

### Chunk 15: Closed-Alpha Reliability Loop

Status: gated until the 3–5 tutor cohort produces enough evidence.

- Track assignment success, latency, support interventions, and repeat weekly value.
- Prioritize the smallest correction to a reproduced failure or high-friction step.
- Keep speculative dashboards, generalized admin tooling, and premature scale work out of scope.

Exit: two consecutive supervised weeks are reliable enough to consider the next cohort.

### Chunk 21: Memory Support Source-Count Verification

Status: investigation on reproduction only.

- Reproduce any mismatch between visible memory-health counts and canonical stored sources.
- Distinguish capped summaries, stale snapshots, and actual persistence/retrieval defects.
- Implement only if the mismatch blocks support diagnosis or affects generated assignments.

Exit: either evidence confirms current behavior is correct and the chunk closes, or a bounded fix
and regression test land.

## Shipped And Deferred History

| Original chunks | State    | Durable outcome                                                                                                                            |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1–7             | complete | Production workers, runtime parity, student/profile and assignment UX, scheduling, candidate handling, and pronunciation controls shipped. |
| 8               | deferred | Telegram tutor workflows and non-blocking invite polish remain post-alpha.                                                                 |
| 9–11            | complete | Canonical VPS environment, student-memory pacing/evals, and split CI/release/image publishing shipped.                                     |
| 12–13           | complete | Tutor-facing UI distillation and target-model activation hardening shipped.                                                                |
| 16–18           | complete | Rerun theme preservation, profile draft revision repair, and student-name grounding shipped in PR #116.                                    |
| 19              | complete | Assignment-name instruction placement was corrected in the prompt contract.                                                                |
| 20              | complete | Candidate promotion status and link preservation were corrected.                                                                           |
| 22              | complete | The legacy student workspace was removed in PR #121.                                                                                       |

Later assignment-workflow remediation and the Step 1 redesign shipped separately and are represented
in current frontend behavior, tests, and release history rather than reopened here.

## Operating Boundaries

- Production deployment remains a separate, explicit operator action.
- Do not infer invite/account bootstrap success from a logged-in main-flow smoke.
- Do not widen closed-alpha evidence work into public signup, billing, team management, or broad
  platform redesign.
- Keep model/provider activation and external-service expansion behind their canonical configuration
  and approval gates.
- Update this roadmap when evidence changes the next action; move completed execution detail to the
  archive or durable subsystem docs.
