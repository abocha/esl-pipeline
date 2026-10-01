# ESL Pipeline Project Orchestration Adapter

This is the sole ESL-specific adapter for the portable Codex workflow. Portable workflow mechanics
belong in `WORKFLOW_MODES.md`, `ORCHESTRATION.md`, and `PLANNING_HANDOFF.md`; durable repository and
product policies belong in root `AGENTS.md` and the ESL SSOT.

## Authority and routing

- Repository instructions: root [`AGENTS.md`](../AGENTS.md) is the compact router and repo-wide
  operating contract.
- Product/runtime authority: [`docs/reference/agents-ssot.md`](../docs/reference/agents-ssot.md)
  owns ESL contracts and invariants and wins conflicts with router docs or package READMEs.
- Documentation: start with [`docs/README.md`](../docs/README.md); use
  [`docs/reference/DOCS_IA_MAP.md`](../docs/reference/DOCS_IA_MAP.md) only when that category route is
  unclear, then read the task-specific active document or owning package README.
- Validation and CI: use
  [`docs/reference/TESTING_GUIDELINES.md`](../docs/reference/TESTING_GUIDELINES.md) with current
  repository scripts, manifests, test configuration, and hosted workflow configuration.
- Release/deployment: use
  [`docs/backend-frontend/DEPLOYMENT.md`](../docs/backend-frontend/DEPLOYMENT.md), the applicable
  current [`docs/operations/`](../docs/operations/) runbook, and the SSOT production rules.

Current code, configuration, and live Git/CI state outrank dated plans, evidence records, and
archive material for facts that can change.

## Portable workflow source

The portable authority is `abocha/codex-workflow`. Use a verified-current local or sibling checkout
when available; otherwise use current upstream repository state. Reconcile the standard documents
and portable role definitions from that authority instead of maintaining ESL-specific forks. Keep
ESL facts in this adapter, root `AGENTS.md`, authoritative ESL documentation, or a narrowly
triggered repository skill.

## Validation mapping

### Focused local evidence

Use the narrowest reliable route owned by `docs/reference/TESTING_GUIDELINES.md` and the affected
package or tool: a focused test when it protects a plausible regression, `vitest related --run`, or
the owning package's test, typecheck, lint, or build command. Reversible, low-impact changes do not
need tests that merely mirror the edit. Docs-only work uses the repository-owned documentation lane:

```text
pnpm docs:generate:indexes
pnpm format
pnpm docs:check
```

### Broader local evidence

Broader local or service-backed evidence is conditional, not automatic. Use it only for a concrete
suspected cross-package/environment failure, an unavailable hosted equivalent, or reproduction of a
specific hosted-CI failure. `pnpm test:backend:db:worker` is a narrow PostgreSQL/Redis diagnostic,
not a comprehensive local CI gate.

### Hosted / CI-owned evidence

- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) owns comprehensive PR validation and
  each selected job's exact commands and prerequisites.
- Every job required by current repository policy must pass; the fail-closed `CI gate` owns the
  aggregate merge result. Focused local evidence does not establish merge readiness.

### Manual or environment-owned evidence

Runtime, provider, browser, media, migration, and deployment checks remain manual or
environment-owned when their current guide says so. Destructive install, upgrade, migration,
restore, and data checks require an explicitly suitable disposable or operator-approved environment.

For ESL live production, apply the portable evidence/closure and context-economy rules through the
[`deployment checklist skill`](../.agents/skills/esl-pipeline-deployment-change-checklist/SKILL.md)
and the applicable current operations runbook's authorized rollout/rollback and completion criteria.

## Common ownership boundaries

- Orchestrator/manifest semantics: `packages/orchestrator`; route through
  `docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md`,
  `docs/reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md`, and
  `docs/reference/pipeline-manifest.md`.
- Public contracts: `packages/contracts` and transport consumers; `@esl-pipeline/contracts`,
  manifest compatibility rules, and the ESL SSOT remain authoritative.
- Backend workflow/persistence: `packages/batch-backend` owns PostgreSQL, Redis, queues, workers,
  auth, operational orchestration, and durable workflow state; start with its README.
- Frontend workflow: `packages/batch-frontend` is the operator UI over backend-owned persisted
  truth; start with its README.
- Provider/runtime adapters: `provider-runtime`, `tts-*`, `stt-*`, shared runtime utilities, and
  provider adapters; route through `docs/reference/GENERATION_PROVIDER_POLICY.md`,
  `docs/reference/env.md`, and orchestrator capability contracts.
- Publishing: `html-publisher`, `storage-uploader`, rendered/stored artifacts, and publication
  consumers; preserve orchestrator, manifest, and backend-persisted publication truth.

These are repository maps, not mandatory child assignments.

## Exceptional-risk surfaces

- Migrations/schema: use versioned migrations; include `packages/batch-backend/schema.sql` and
  current contract verification when applicable.
- Public contracts: treat DTO, manifest, compatibility, and versioning changes explicitly; route
  release compatibility through `docs/reference/VERSIONING_MODEL.md`.
- Auth/privacy: preserve authenticated backend/operator boundaries, secret handling, and fail-safe
  environment defaults.
- Durable state/data integrity: PostgreSQL/backend persistence, action history, lineage,
  publication truth, replay, backup, and restore remain backend-owned.
- Concurrency/idempotency: cover queue workers, retries, mutual exclusion, rollback, and competing
  operation orderings for affected shared mutable state.
- Provider credentials/configuration: preserve namespaced environment contracts, capabilities,
  quotas, and fail-safe defaults.
- Production/destructive operations: use the deployment guide, applicable current operations
  runbook, and the narrowly triggered deployment checklist skill.

Portable review routing remains owned by `ORCHESTRATION.md`; these entries identify ESL risk, not a
second review choreography.

## Mutation and operational boundaries

- Root `AGENTS.md` controls repository and external mutation authorization. Preserve dirty or
  unrelated user work; complete ordinary local repository operations within the authorized task
  scope while keeping consequential external and destructive actions within their separate boundaries.
- The developer laptop is the normal edit, debug, test, integration, and migration-test
  environment. Git commits plus required hosted CI are the source of deployable code.
- The AWS Lightsail VPS is production runtime, not a normal development/full-test environment.
  Deployment is a separate operator action using reviewed migrations, pull-based immutable images,
  recorded versions, health checks, and current runbooks.
- Keep production data outside the application checkout; do not make server-local application edits
  or manually mutate files in running containers as normal procedure.
- Broad local OS access such as `danger-full-access` does not expand behavioral or mutation
  authority. The instruction chain, role contract, and task authorization remain controlling, and
  user-level Codex configuration is outside repository-task scope.

## Repository-specific execution notes

Historical evidence and archives do not preserve retired commands or gates. Re-discover current
validation, release, and operational procedure from the active owners above.
