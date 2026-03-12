# Wave 3 - Schema Unification

## Goal

Finish the migration-first schema governance path by retiring or tightly quarantining the remaining legacy runtime patch fallback so startup behavior is deterministic and schema drift risk is minimized.

Success is:

1. Remaining legacy runtime schema patching is retired or strictly quarantined.
2. The existing versioned migration chain remains the single source of schema truth.
3. Startup path validates migration state predictably in both auto-migrate and manual-migrate modes.

## Included Items

1. `B2` - Unify DB schema evolution path.

Out of scope:

1. Non-database backend refactors from earlier waves.
2. New data model features unrelated to migration-system hardening.

## Implementation Steps

1. Inventory the remaining legacy schema patch arrays in `packages/batch-backend/src/infrastructure/db.ts` and map each patch to existing migration parity or an explicit temporary exception.
2. Define cutover policy on top of the current migration runner/status/verify workflow:
   new schema changes land only in migration files, while any remaining runtime patch path is read-only compatibility code until removed.
3. Add versioned migrations only for uncovered runtime-only changes that do not already have parity in the existing migration chain.
4. Tighten startup/manual-mode handling where drift states are still tolerated ambiguously, while preserving clear operator signaling.
5. Remove or sharply narrow runtime patch execution path once migration parity is confirmed.
6. Align schema docs and operational runbooks with the already-shipped migration-first workflow.
7. Add CI/verification guardrails that prevent new runtime schema patch additions outside approved migration flow.

## Risks and Rollback

1. Risk: migration order mismatches existing production state.
   Rollback: keep compatibility patches behind guarded mode for one release window while fixing migration sequencing.
2. Risk: startup fail-fast blocks service on previously tolerated drift.
   Rollback: temporary operator override for emergency boot with explicit warning, then immediate remediation.

## Acceptance Checklist

1. Every remaining legacy runtime schema patch has migration parity or a documented temporary exception.
2. `pnpm --filter @esl-pipeline/batch-backend db:status` and `pnpm --filter @esl-pipeline/batch-backend db:verify` report clean state in the target dev/test baseline.
3. Backend startup path behavior is deterministic for auto-migrate, manual-migrate, and incompatible drift states.
4. CI blocks new ad-hoc runtime schema patch additions.
5. `pnpm --filter @esl-pipeline/batch-backend typecheck` and `pnpm --filter @esl-pipeline/batch-backend test:db:migrations` pass.
6. `pnpm check:fast` passes before merge.
