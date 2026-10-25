# ESL Pipeline Project Orchestration Adapter

This is the ESL-specific adapter for the installed Codex Workflow plugin. Shared methods live in
`abocha/codex-workflow`; durable repository and product policies belong in root `AGENTS.md` and
the ESL SSOT. Keep local facts and useful routes here rather than copied workflow procedures.

## Authority and routing

- Repository instructions: root [`AGENTS.md`](../AGENTS.md) is the compact router and repo-wide
  operating contract.
- Product/runtime authority: [`docs/reference/agents-ssot.md`](../docs/reference/agents-ssot.md)
  owns ESL contracts and invariants and wins conflicts with router docs or package READMEs.
- Documentation: start with [`docs/README.md`](../docs/README.md); use
  [`docs/reference/DOCS_IA_MAP.md`](../docs/reference/DOCS_IA_MAP.md) only when that category route is
  unclear, then read the task-specific active document or owning package README.
- Documentation drift and lifecycle: use `codex-workflow:docs-gardening` for the shared method;
  the [playbook](../docs/reference/DOCS_GARDENING_PLAYBOOK.md) owns ESL governance/tooling routes.
- Planning: select repository work through the
  [`issue intake runbook`](../docs/operations/github-issue-intake-and-codex-work-selection.md);
  Linear owns backlog and durable decisions. Use [`docs/plans/README.md`](../docs/plans/README.md)
  for approved repository execution-plan lifecycle, and the generated index only as a lookup aid.
- Validation and CI: use
  [`docs/reference/TESTING_GUIDELINES.md`](../docs/reference/TESTING_GUIDELINES.md) with current
  repository scripts, manifests, test configuration, and hosted workflow configuration.
- Release/deployment: use
  [`docs/backend-frontend/DEPLOYMENT.md`](../docs/backend-frontend/DEPLOYMENT.md), the applicable
  current [`docs/operations/`](../docs/operations/) runbook, and the SSOT production rules.

Current code, configuration, and live Git/CI state outrank dated plans, evidence records, and
archive material for facts that can change.

## Shared workflow and project integration

The canonical source is [abocha/codex-workflow](https://github.com/abocha/codex-workflow).
Install/select the Codex Workflow plugin; do not copy its skills or references into this repository.
Use its workflow skill for modes, substantial handoffs, authorized coordination, context, review
and evidence/closure methods. Use its focused `pr-ci`, `test-audit`, `docs-gardening` and
`complexity-discipline` skills only when their task triggers apply. Setup/reconciliation is an
explicit use of `codex-workflow-setup`, not an automatic phase of ordinary work.

For PR work, combine the shared method with the current [PR template](../.github/pull_request_template.md),
[versioning policy](../docs/reference/VERSIONING_MODEL.md) and
[PR/release style](../docs/operations/pr-style-release-notes.md). ESL requires exactly one allowed
release label; shared guidance does not choose or change this project's gates.

Registered role definitions remain in `.codex/agents/`. Their presence here preserves the existing
host configuration; plugin installation alone is not registration. Reconcile future role updates
against the canonical source without overwriting deliberate adaptations or changing personal config.
If a skill or runtime capability is unavailable, root `AGENTS.md` and local owners still control;
report the limitation instead of making up execution evidence or restoring a forked workflow.

## Validation mapping

Use the [evidence decision route](../docs/reference/TESTING_GUIDELINES.md#choose-the-evidence-route)
for focused local work and conditions for broader evidence. Follow its
[docs-only recipe](../docs/reference/TESTING_GUIDELINES.md#docs-only-changes),
[hosted failure route](../docs/reference/TESTING_GUIDELINES.md#hosted-pr-ci-job-reproduction), and
[evidence applicability/completion rules](../docs/reference/TESTING_GUIDELINES.md#evidence-and-merge-boundary)
as applicable. Package READMEs own local execution recipes; manifests, test configuration and the
selected [CI job](../.github/workflows/ci.yml) own exact commands and prerequisites.

### Manual or environment-owned evidence

Runtime, provider, browser, media, migration, and deployment checks remain manual or
environment-owned when their current guide says so. Destructive install, upgrade, migration,
restore, and data checks require an explicitly suitable disposable or operator-approved environment.

For ESL live production, apply the portable evidence/closure and context-economy rules through the
[`deployment checklist skill`](../.agents/skills/esl-pipeline-deployment-change-checklist/SKILL.md)
and the applicable current operations runbook's authorized rollout/rollback and completion criteria.

## Common ownership boundaries

- Orchestrator/manifest semantics: `packages/orchestrator`; route through
  `packages/orchestrator/README.md`, `docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md`, and
  `docs/reference/pipeline-manifest.md`; use `docs/reference/agents-ssot.md` for cross-package
  ownership and invariants.
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

Shared review routing belongs to the plugin; these entries identify ESL risk rather than a
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
