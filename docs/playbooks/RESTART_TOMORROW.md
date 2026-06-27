# Restart Tomorrow

## Current Handoff (2026-06-23)

- Current launch stage: pre-alpha with one tutor. The progression is one tutor in pre-alpha, 3–5 in
  closed alpha, 6–10 in closed beta, then an explicit evidence-backed v1 production-readiness
  decision.
- Chunks 1–11 from the production-readiness restart wave are complete. Telegram and speculative
  invite polish are deferred until after closed alpha.
- Current implementation focus: Chunk 12 — tutor-facing UI distillation. Begin with the
  lesson-source screen, where stage headings and static help repeat the same instruction.
- Treat a reproduced tutor reliability blocker as higher priority than planned polish. Do not
  broaden scope from one anecdote.

## First Step Next Session

1. Read [`docs/plans/2026-06-23-alpha-readiness.md`](../plans/2026-06-23-alpha-readiness.md).
2. Open the current tutor-facing surface and choose one bounded Chunk 12 slice.
3. Preserve only state-aware guidance: text earns its place when it changes with state, prevents an
   error, or explains a blocked action.
4. Record the next tutor session against the scorecard in
   [`docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`](../reference/PRODUCT_NORTH_STAR_AND_READINESS.md).

## Core Files

1. [`docs/plans/2026-06-23-alpha-readiness.md`](../plans/2026-06-23-alpha-readiness.md)
2. [`docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`](../reference/PRODUCT_NORTH_STAR_AND_READINESS.md)
3. [`docs/reference/V1_IMPLEMENTATION_TRACKER.md`](../reference/V1_IMPLEMENTATION_TRACKER.md)
4. [`docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md`](WEEKLY_PRODUCT_REVIEW_TEMPLATE.md)

Historical context is retained in
[`docs/archive/plans/standalone/2026-06-15-production-readiness-restart-chunks.md`](../archive/plans/standalone/2026-06-15-production-readiness-restart-chunks.md).

## Scope Rules

1. One active chunk at a time.
2. Reliability-only work takes priority if two or more readiness metrics are red.
3. Do not activate production flags, deploy, or submit OpenAI Batch work without separate
   maintainer approval.
4. End each session with: what finished, the first next step, and any current blocker.
