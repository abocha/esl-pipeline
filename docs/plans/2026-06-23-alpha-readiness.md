# Alpha Readiness Plan

## Meta

- Audience: founder-maintainer and implementation agents.
- Status: `roadmap`.
- Last Verified Against: 2026-06-23 repository and launch-readiness state.
- Exit Trigger: archive after the product reaches v1 production-readiness or this plan is replaced by
  a later evidence-backed launch plan.
- Current Focus: Chunk 12 — tutor-facing UI distillation for the assignment and student workflows.

## Purpose

This is the active continuation of the completed production-readiness restart work. It preserves
the original chunk numbering while directing the next work toward evidence from real tutors, rather
than reopening already-delivered infrastructure or feature work.

The authoritative launch-stage policy is
[`docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`](../reference/PRODUCT_NORTH_STAR_AND_READINESS.md).

## Launch Stages

| Stage                   | Tutor cohort                        | Intent                                                                                  | Exit evidence                                                                          |
| ----------------------- | ----------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Pre-alpha               | 1 tutor                             | Prove the core flow with one real tutor and remove directly observed friction.          | The tutor can repeatedly complete the core flow with bounded support.                  |
| Closed alpha            | 3–5 tutors                          | Establish repeatable tutor value and reliability under supervised use.                  | Scorecard trends and tutor feedback support admitting a broader cohort.                |
| Closed beta             | 6–10 tutors                         | Confirm the product remains simple, reliable, and supportable across varied real usage. | The readiness scorecard is mostly green for two consecutive weeks.                     |
| v1 production readiness | Evidence-backed decision after beta | Decide whether the service is ready for a production launch.                            | Reliability, support load, and weekly tutor value meet the canonical readiness policy. |

## Completed And Deferred History

| Original chunk | State    | Record                                                                                                                      |
| -------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1–6            | complete | Production-worker, hotfix-parity, legacy-runtime, student/profile, assignment UX, and schedule/candidate work are shipped.  |
| 7              | complete | Pronunciation source correctness, selective audio reuse, and explicit regeneration are shipped.                             |
| 8              | deferred | Telegram tutor workflows and non-blocking invite polish are post-alpha work.                                                |
| 9              | complete | VPS deploys can read Caddy edge values from server-local `.env.batch-backend`.                                              |
| 10             | complete | Student-memory pacing, disabled Batch replay, canonical import, and live-eval evidence are shipped; Batch remains disabled. |
| 11             | complete | PR CI, release commits/tags, and post-release production image publishing are split.                                        |

The preceding intake map is preserved as historical context at
[`docs/archive/plans/standalone/2026-06-15-production-readiness-restart-chunks.md`](../archive/plans/standalone/2026-06-15-production-readiness-restart-chunks.md).

## Active Chunks

### Chunk 12: Tutor-Facing UI Distillation

Priority: P1.

Goal: remove redundant flavor text, repeated headings, static helper copy, and unnecessary visual
nesting from the tutor-facing assignment and student workflows so each current state makes one next
action obvious.

Scope:

- Begin with the minimal assignment workflow, including lesson source, transcript, learning context,
  draft, preview, and share stages.
- Keep dynamic guidance that changes with state, prevents an error, or explains a blocked action.
- Remove repeated static explanations that duplicate the stage title, field label, button label, or
  already-visible state.
- Preserve accessibility labels, error messages, and information needed for an informed tutor action.
- Do not turn this into a visual redesign, provider-control expansion, or backend behavior change.

Acceptance evidence:

- The primary lesson-source screen presents the stage title, the Student field, and one state-aware
  next-step message instead of repeating the same instruction in multiple headings and paragraphs.
- Each primary workflow stage has one clear primary action and only state-relevant instructional
  copy.
- Tutor-facing tests cover the retained dynamic guidance and the removed redundant copy.
- A focused visual review confirms the task hierarchy remains clear at desktop and narrow widths.

### Chunk 13: Target-Model Activation Configuration Hardening

Priority: P1.

Goal: make the evaluated OpenAI target-model ladder a clear, deterministic production configuration
instead of a flag whose effect can be hidden by explicit model overrides.

Scope:

- Define and test the precedence between `GEN_OPENAI_TARGET_MODELS_ENABLED` and every explicit
  `GEN_OPENAI_MODEL_*` value.
- Make the intended operator activation procedure accurate in environment examples and provider
  policy documentation.
- Keep `STUDENT_MEMORY_OPENAI_BATCH_ENABLED=false` independent of target-model activation.
- Do not activate a production environment or submit OpenAI Batch work in this implementation chunk.

Acceptance evidence:

- Tests prove the resolved production model ladder for both disabled and enabled states.
- Operator documentation names every required environment change, or a single authoritative switch
  if implementation makes that safe.
- Strict allowlists admit every target model that the enabled ladder can select.

### Chunk 14: Pre-Alpha Tutor-Flow Evidence

Priority: P1.

Goal: make the one-tutor pre-alpha loop observable and actionable before recruiting the closed-alpha
cohort.

Scope:

- Record a small, privacy-safe evidence set for invite acceptance, first student, lesson source,
  assignment generation, sharing, and follow-up.
- Turn a reproduced blocker into a narrowly scoped reliability or usability fix; do not build
  speculative features from one anecdote.
- Use the canonical readiness scorecard and capture the top tutor pain points after each session.

Acceptance evidence:

- Each tutor session records completion, failure/recovery, time-to-assignment, and needed support.
- The next admitted tutor is based on observed evidence, not a broad feature backlog.

### Chunk 15: Closed-Alpha Reliability Loop

Priority: P1, after the cohort reaches 3–5 tutors.

Goal: keep the service dependable and simple while it moves from one supervised tutor to a small
closed-alpha cohort.

Scope:

- Review the readiness scorecard weekly and prioritize reliability-only work when two or more
  metrics are red.
- Ship small fixes to concrete tutor blockers, then record whether the next session improved.
- Avoid broad new product surfaces until the core flow is repeatable with low support burden.

Acceptance evidence:

- Weekly evidence identifies the top three tutor pain points and the chosen follow-up.
- The team can make an explicit, evidence-backed decision to enter closed beta or remain in alpha.

## Deferred: Telegram And Invite Follow-Up

Telegram is intentionally deferred until after closed alpha. Reopen it only when several tutors
demonstrate a repeated communication or coordination need that the primary product cannot meet more
simply. Invite-registration polish is similarly evidence-led: investigate and fix a concrete
reproduction, not a remembered concern.

## Operating Boundaries

- Production deployment and production feature-flag changes require separate maintainer approval.
- `STUDENT_MEMORY_OPENAI_BATCH_ENABLED` remains false unless Batch operation is explicitly approved.
- Target-model activation is independent from Batch activation and follows the provider-policy and
  live-evaluation evidence requirements.
- Keep work focused: one active chunk at a time, with a recorded next stopping point.
