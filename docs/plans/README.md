# Plans Directory

## Purpose

`docs/plans` is the home for implementation plans that are intended to be executed in this repository.

## Conventions

1. Keep one subdirectory per plan topic.
2. Include a plan-level `README.md` with summary, scope, and phase index.
3. Split execution detail by phase so implementation can be delegated safely.
4. Include explicit runbook and acceptance criteria files when data migrations are involved.

## Current Plans

1. `docs/plans/postgres-hardening-offline-migration/README.md`  
   PostgreSQL hardening, schema governance, and offline data-preserving migration plan.
2. `docs/plans/harness-agentic-docs-upgrade/README.md`  
   Next phases for harness-aligned docs governance rollout (enforcement expansion + gardening calibration).
3. `docs/plans/versioning-private-contracts-overhaul.md`  
   Private monorepo versioning overhaul with merge-driven release automation and explicit contract-version registry.
4. `docs/plans/orchestrator-library-only-roadmap/README.md`  
   Ownership-driven medium-scale roadmap to make orchestrator library-only and retire CLI/wizard/path-picker surfaces.
5. `docs/plans/legacy-retirement/legacy-retirement-backlog.md`  
   Canonical legacy-contract retirement backlog index with deterministic prioritization and wave sequencing.
6. `docs/plans/legacy-retirement/legacy-retirement-inventory.md`  
   Itemized inventory of confirmed live legacy contracts mapped to backlog IDs.
7. `docs/plans/legacy-retirement/legacy-retirement-execution-playbook.md`  
   Standard implementation workflow, acceptance format, and release-label rules for retirement items.
8. `docs/plans/stt-multi-provider-refactor/README.md`
   STT provider-architecture parity plan (`core + adapters`), Google STT V2 onboarding, and transcript-provider persistence cutover.
9. `docs/plans/telegram-ops-control-panel-hardening/README.md`
   Gap inventory + execution timing for Telegram ops bot hardening (`Now`, `After Manual V1`, `V2/Defer`).
