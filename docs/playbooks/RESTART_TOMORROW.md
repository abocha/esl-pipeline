# Resume Work Safely

## Meta

- Audience: maintainers and AI agents resuming repository work.
- Read Time: 2 minutes.
- Authority Level: recovery procedure.
- Last Verified Against: 2026-08-12 repository workflow.
- Owner: founder-maintainer + automation agents.
- Review Cadence: after workflow changes.
- Status: `playbook`.

## Purpose

Recover current work from authoritative sources. This playbook intentionally records no current
chunk, release state, task priority, or next implementation step.

## Recovery Procedure

1. Inspect the current branch, worktree status, and recent commits. Preserve unrelated changes.
2. Read [`AGENTS.md`](../../AGENTS.md), [`docs/README.md`](../README.md), and the applicable
   task-specific route.
3. For planned work, identify the editable entrypoint in [`docs/plans/README.md`](../plans/README.md)
   and re-read the exact active plan. Do not infer current work from task artifacts or archive notes.
4. For backlog selection, inspect the canonical GitHub issue workflow in
   [`docs/operations/github-issue-intake-and-codex-work-selection.md`](../operations/github-issue-intake-and-codex-work-selection.md).
5. Verify volatile state—CI, releases, deployments, incidents, or live evidence—from its stated
   source, current runbook, and current repository state; do not reuse old handoff claims.
6. State the first bounded next action and its validation before editing. End the session by leaving
   durable conclusions in their canonical owner, not in this playbook.

## Related

- [`docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`](../reference/PRODUCT_NORTH_STAR_AND_READINESS.md)
- [`docs/operations/README.md`](../operations/README.md)
- [`docs/archive/plans/standalone/2026-06-15-production-readiness-restart-chunks.md`](../archive/plans/standalone/2026-06-15-production-readiness-restart-chunks.md)
