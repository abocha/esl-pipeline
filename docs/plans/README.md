# Plans Directory

## Meta

- Audience: maintainers and AI agents working from plan docs.
- Read Time: 4 minutes.
- Authority Level: planning router.
- Last Verified Against: 2026-03-13 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: monthly or after major planning-topology changes.
- Status: `router`.

## Purpose

- Route readers to active implementation plans, long-lived roadmaps, backlog surfaces, and completed historical plans.
- Clarify where a new plan should live and when a plan should be superseded, moved, or archived.

## Plan Types

### Topic router

- A directory `README.md` that explains the scope, phase index, and assumptions for a plan topic.

### Phase/detail plan

- A concrete implementation or verification slice under a topic directory.
- Best when work can be delegated or reviewed phase-by-phase.

### Standalone active plan

- A one-file plan used when the topic is cohesive and does not need a full subdirectory.

### Completed plan

- Historical execution truth moved under `docs/plans/completed/` for traceability without cluttering active routing.

## Lifecycle Rules

1. Create a new topic directory when a workstream will span multiple phases or follow-up docs.
2. Use a standalone plan file only when the topic is small enough to stay coherent in one document.
3. Supersede a plan when:
   - a newer plan replaces its execution truth, or
   - the work has moved into SSOT/runbooks and the plan is now historical.
4. Move completed execution plans under `docs/plans/completed/` instead of leaving them mixed with active work.
5. Update this router whenever a new active plan topic or standalone plan becomes part of normal execution flow.

## Active Plan Routes

### Topic directories

1. `docs/plans/postgres-hardening-offline-migration/README.md`
2. `docs/plans/harness-agentic-docs-upgrade/README.md`
3. `docs/plans/orchestrator-library-only-roadmap/README.md`
4. `docs/plans/stt-multi-provider-refactor/README.md`
5. `docs/plans/telegram-ops-control-panel-hardening/README.md`
6. `docs/plans/student-memory-system-upgrade/README.md`
7. `docs/plans/backlog/README.md`

### Standalone active plans

1. `docs/plans/versioning-private-contracts-overhaul.md`
2. `docs/plans/legacy-retirement/legacy-retirement-backlog.md`
3. `docs/plans/legacy-retirement/legacy-retirement-inventory.md`
4. `docs/plans/legacy-retirement/legacy-retirement-execution-playbook.md`

## Historical and Generated Aids

- Completed plans: [`docs/plans/completed/README.md`](completed/README.md)
- Generated plan inventory: [`docs/generated/plans-index.md`](../generated/plans-index.md)

## Related

- [`docs/reference/DOCS_GARDENING_PLAYBOOK.md`](../reference/DOCS_GARDENING_PLAYBOOK.md)
- [`docs/generated/README.md`](../generated/README.md)
