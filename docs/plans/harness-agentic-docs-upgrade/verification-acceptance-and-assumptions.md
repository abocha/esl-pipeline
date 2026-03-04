# Verification, Acceptance, and Assumptions

## Acceptance Criteria

1. Phase 3: backend/frontend docs are in enforced scope and pass checks.
2. Phase 4: selected package READMEs are in enforced scope and pass checks.
3. Phase 5: rule-promotion loop is operating with documented changelog entries.
4. Weekly docs-gardening workflow produces actionable issue updates only when needed.

## Verification Commands

1. `pnpm docs:check`
2. `pnpm docs:health:report`
3. `pnpm docs:stale:active`

## Required Evidence Artifacts

1. `tmp/docs-health-report.json`
2. `tmp/docs-health-report.md`
3. `tmp/docs-stale-active.json`
4. `tmp/docs-stale-active.md`

## Assumptions

1. `AGENTS.md` remains a router + operating contract, not a full manual.
2. `docs/reference/agents-ssot.md` remains authoritative when conflicts exist.
3. Docs automation remains non-destructive for archival decisions.
4. Incremental rollout is preferred over wide one-shot enforcement.

## Deferred Follow-Ups

1. Optional additional enforcement scope for other package READMEs.
2. Optional richer graph-based routing analysis if needed later.

