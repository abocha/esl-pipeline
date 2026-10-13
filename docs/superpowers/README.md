# Named-Task Execution Context

## Meta

- Audience: maintainers and agents working from an explicitly named task artifact.
- Read Time: 1 minute.
- Authority Level: task-local context.
- Last Verified Against: 2026-08-12 repository and Git history.
- Owner: task author and implementing change owner.
- Review Cadence: when a named task concludes.
- Status: `reference`.

## Scope

`docs/superpowers/**` is a temporary workspace for a named design, review, or implementation task.
It is not a backlog or a durable planning hierarchy. Linear owns the planning backlog and durable
decisions; the [`intake runbook`](../operations/github-issue-intake-and-codex-work-selection.md)
routes work selection. Approved repository execution plans, when useful for multi-step work, follow
the [`plans lifecycle`](../plans/README.md). Current behavior remains owned by code, package READMEs,
references, and runbooks.

An artifact here is authoritative only when the task that explicitly names it is active. Its presence
does not establish current repository truth or an active backlog item.

## Lifecycle

When a named task concludes, the responsible change must decide one of these outcomes:

1. promote durable conclusions to their real current owner;
2. delete the artifact when it has no durable value; or
3. move useful design/execution history to a clearly historical archive and repair inbound links.

Do not create per-file metadata or route ordinary work here merely to preserve notes. The tracked
pre-overhaul corpus is non-current: its named implementation work is followed by corresponding code
or closeout commits. It remains in place for now because current design and incident records still
link to selected artifacts; a move requires repairing those inbound routes in the same change.

## Use

- Open a file here only when an approved task, review, or handoff names it.
- After implementation, verify behavior against current code and the relevant current docs.
- For historical rationale that is no longer task-local, use [`docs/archive/`](../archive/README.md).
