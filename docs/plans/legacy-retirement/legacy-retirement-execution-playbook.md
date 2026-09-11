# Legacy Retirement Execution Playbook

## Meta

- Audience: maintainers and implementation agents.
- Authority Level: active execution playbook.
- Last Verified Against: 2026-05-17 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: after legacy-retirement workflow changes.
- Status: `active`.
- Exit Trigger: archive after the legacy-retirement backlog is complete or the workflow is promoted into durable repo guidance.
- Current Focus: use this file as the active per-item retirement workflow until it is promoted into durable repo guidance.

## Summary

This playbook defines the standard implementation workflow for each legacy retirement backlog item.
Use it with:

1. `docs/plans/legacy-retirement/legacy-retirement-backlog.md`
2. `docs/plans/legacy-retirement/legacy-retirement-inventory.md`

## Item Lifecycle Workflow

1. Select item
   - Confirm item is `queued` and dependencies are satisfied.
2. Lock contract decision
   - Confirm target end state and `breaking_level` match current SSOT and release policy.
3. Implement code changes
   - Keep change scoped to one backlog item unless an explicit dependency item is bundled.
4. Validate behavior
   - Run the item's required validation command(s).
5. Update docs and contracts
   - Update all paths in `docs_to_update` in the same PR.
6. Prepare PR
   - Use one release label required by the item.
7. Mark status
   - Move item to `done` only after merged PR and passing checks.

## DB-Canonical Boundary Rule

1. Runtime services should not use filesystem fallback for canonical data paths.
2. Migration/backfill tooling may read filesystem legacy sources when explicitly scoped to migration commands.
3. Retirement PRs must preserve the migration-tool boundary while removing runtime fallback/probe behavior.

## Required Acceptance Format (Per Item)

Every implementation PR MUST include these four sections in the description:

1. Required tests
   - Exact commands run and pass/fail result.
2. Expected error/response contract behavior
   - Explicitly state endpoint/shape/error code behavior before and after change.
3. Docs updates
   - List every updated doc path from `docs_to_update`.
4. Required release label
   - Exactly one label: `release:patch`, `release:minor`, or `release:major`.

For filesystem-fallback retirement items, include one additional subsection:

5. Migration boundary confirmation
   - State which migration tools still read filesystem inputs and confirm runtime paths no longer do.

## Release Label Decision Rules

Apply `docs/reference/VERSIONING_MODEL.md` exactly:

1. `release:patch`
   - Internal-only retirements, docs changes, warning hardening.
2. `release:minor`
   - Backward-compatible contract reductions or transitional changes.
3. `release:major`
   - Breaking removals in public API/env/manifest contracts.

## Implementation Checklist Template

Copy this block into each retirement PR:

```md
### Legacy Retirement Item

- ID: <LR-xxx>
- Surface: <name>
- Breaking Level: <none|additive|breaking>
- Required Release Label: <release:patch|release:minor|release:major>

### Required Tests

- [ ] <command 1>
- [ ] <command 2>

### Contract Behavior

- [ ] Expected response/error behavior validated and documented.

### Docs Updated

- [ ] <doc path 1>
- [ ] <doc path 2>

### Completion

- [ ] Inventory status updated to `done` after merge.
```

## Validation Gates

Before merging any item PR:

1. Item-specific test commands pass.
2. Focused checks for the retired surface pass; hosted PR CI and `CI gate` provide comprehensive
   validation.
3. `pnpm docs:check` passes when docs/contract text changed.
4. PR has exactly one release label and matches item requirement.

For items removing runtime filesystem fallback/probes:

5. Include targeted assertions that runtime no longer downgrades to filesystem under error conditions.
6. Include targeted assertions or smoke notes confirming migration tools still execute as documented.

## Rollout and Monitoring Expectations

1. For `public_api` and `env` items, include rollout notes and migration timeline in PR body.
2. For `breaking` items, include explicit removal date and impacted consumers.
3. For data-compat retirements, include evidence query/results proving migration readiness.
4. For filesystem-fallback retirements, include startup/worker log expectations showing explicit fail-fast or warning behavior without filesystem downgrade.
