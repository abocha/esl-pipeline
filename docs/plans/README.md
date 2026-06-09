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

- Route readers only to plans that are still editable execution artifacts.
- Keep implemented or superseded plans out of active routing so agents do not patch stale intent.
- Clarify when a plan must be archived after a PR lands.

## Plan Types

### Topic router

- A directory `README.md` that explains the scope, phase index, and assumptions for a plan topic.

### Phase/detail plan

- A concrete implementation or verification slice under a topic directory.
- Best when work can be delegated or reviewed phase-by-phase.

### Standalone active plan

- A one-file plan used when the topic is cohesive and does not need a full subdirectory.

### Completed plan

- Historical execution truth moved under `docs/archive/plans/` for traceability without cluttering active routing.

## Lifecycle Contract

- Active plan statuses under `docs/plans/` are limited to `active`, `roadmap`, `backlog`, and
  `draft`.
- Completed and superseded plans belong under `docs/archive/plans/`.
- Active topic routers, backlog entries, and standalone plans must declare `Status`,
  `Last Verified Against`, `Exit Trigger`, and `Current Focus`.
- Active routers must point to editable topic, backlog, or standalone plans, not phase/detail docs.
- Phase/detail docs are historical by default after their implementation PR lands; archive them
  under `docs/archive/plans/`.
- Default exit trigger: archive the plan after the implementation PR merges unless it remains an
  explicit roadmap.
- PRs that implement a plan must either archive that plan or update its lifecycle metadata in the
  same branch.

## Lifecycle Rules

1. Create a new topic directory when a workstream will span multiple phases or follow-up docs.
2. Use a standalone plan file only when the topic is small enough to stay coherent in one document.
3. Supersede a plan when:
   - a newer plan replaces its execution truth, or
   - the work has moved into SSOT/runbooks and the plan is now historical.
4. Move completed execution plans under `docs/archive/plans/` instead of leaving them mixed with active work.
5. Keep each active topic README as the editable entry point and summarize archived phase detail
   under a short historical-trace section.
6. Update this router whenever a new active plan topic or standalone plan becomes part of normal execution flow.

## Active Plan Routes

### Topic directories

1. `docs/plans/postgres-hardening-offline-migration/README.md`
2. `docs/plans/harness-agentic-docs-upgrade/README.md`
3. `docs/plans/orchestrator-library-only-roadmap/README.md`
4. `docs/plans/stt-multi-provider-refactor/README.md`
5. `docs/plans/telegram-ops-control-panel-hardening/README.md`
6. `docs/plans/student-memory-system-upgrade/README.md`
7. `docs/plans/student-profile-enrichment/README.md`
8. `docs/plans/student-area-redesign/README.md`
9. `docs/plans/schedule-homework-followups/README.md`
10. `docs/plans/backlog/README.md`

### Standalone active plans

1. `docs/plans/versioning-private-contracts-overhaul.md`
2. `docs/plans/legacy-retirement/legacy-retirement-backlog.md`
3. `docs/plans/legacy-retirement/legacy-retirement-inventory.md`
4. `docs/plans/legacy-retirement/legacy-retirement-execution-playbook.md`
5. `docs/plans/2026-05-20-cross-workstream-change-intake.md`
6. `docs/plans/slice-1-private-hosted-environment.md`
7. `docs/plans/slice-2-invite-workspace-first-student.md`

## Historical and Generated Aids

- Archived plans: [`docs/archive/plans/`](../archive/plans/)
- Generated plan inventory: [`docs/generated/plans-index.md`](../generated/plans-index.md)

## Related

- [`docs/reference/DOCS_GARDENING_PLAYBOOK.md`](../reference/DOCS_GARDENING_PLAYBOOK.md)
- [`docs/generated/README.md`](../generated/README.md)
