# ESL Pipeline Codex Adapter

This file maps the portable orchestration mechanics in [`ORCHESTRATION.md`](ORCHESTRATION.md) onto
ESL Pipeline. It is a concise adapter, not a second product or testing manual.

## Authority and routing

Read selectively in this order; this is a reading route, not descending authority. User/task
authorization controls scope. The ESL SSOT wins conflicts with repository instruction documents.

1. user/task authorization and an approved plan where applicable;
2. root [`AGENTS.md`](../AGENTS.md), the ESL router and operating contract;
3. [`.codex/ORCHESTRATION.md`](ORCHESTRATION.md), portable delegation and review mechanics;
4. this ESL-specific adapter;
5. [`docs/README.md`](../docs/README.md) and
   [`docs/reference/DOCS_IA_MAP.md`](../docs/reference/DOCS_IA_MAP.md) for progressive routing;
6. the task-specific active doc or owning package README;
7. [`docs/reference/agents-ssot.md`](../docs/reference/agents-ssot.md), which remains the canonical
   ESL product/runtime contract and wins on product/runtime conflicts.

## Workflow source and adaptation

Portable source: `D:/code/codex-workflow`. `WORKFLOW_MODES.md` is copied from the portable
standard. The installed `ORCHESTRATION.md` and `PLANNING_HANDOFF.md` retain reviewed ESL
adaptations; compare and reconcile upstream changes rather than overwriting them with `-Force`.
Keep new ESL-specific policy here or in root `AGENTS.md`. Role and skill differences should be
reviewed separately from formatting-only differences. Model defaults live in `WORKFLOW_MODES.md`.

## Major ownership boundaries

Use current ESL docs and code as source of truth. Common boundaries are:

- `@esl-pipeline/orchestrator`: canonical pipeline semantics and manifest behavior; route through
  [`docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md`](../docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md),
  [`docs/reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md`](../docs/reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md),
  and [`docs/reference/pipeline-manifest.md`](../docs/reference/pipeline-manifest.md).
- `@esl-pipeline/contracts`: public request, response, and transport DTOs.
- `@esl-pipeline/batch-backend`: durable workflow state, persistence, queueing, authentication, and
  operational orchestration; start with
  [`packages/batch-backend/README.md`](../packages/batch-backend/README.md).
- `@esl-pipeline/batch-frontend`: operator UI over backend-owned state; start with
  [`packages/batch-frontend/README.md`](../packages/batch-frontend/README.md).
- provider/runtime packages: provider capability, selection, and adapters, including
  `provider-runtime`, `tts-*`, `stt-*`, and shared runtime utilities; route provider policy through
  [`docs/reference/GENERATION_PROVIDER_POLICY.md`](../docs/reference/GENERATION_PROVIDER_POLICY.md).
- publishing packages: rendered and stored artifacts, including `html-publisher` and
  `storage-uploader`; preserve orchestrator and manifest contracts.

These are common ownership boundaries, not mandatory child assignments.

## Validation routing

Use [`docs/reference/TESTING_GUIDELINES.md`](../docs/reference/TESTING_GUIDELINES.md) and the runtime
verification baseline in [`docs/reference/agents-ssot.md`](../docs/reference/agents-ssot.md):

- run the narrowest focused tests first;
- use `pnpm --silent run check:fast:agent` as the default affected gate;
- use `pnpm check:pre-pr` directly for broad, cross-cutting, shared-contract, or toolchain work;
- use `pnpm check` for DB, migration, worker, integration behavior, or local CI reproduction;
- use existing `:agent` lanes and inspect their cited artifacts before diagnostic reruns;
- keep selected PostgreSQL and Redis requirements visible as CI-owned evidence;
- treat `PASS_WITH_CI_REQUIREMENTS` as permission to create a PR, never to merge; every selected
  hosted job and `CI gate` must pass before merge.

Docs-only harness changes use the docs-specific lanes selected by `AGENTS.md`; do not run broad
application or service integration merely for ceremony.

## Exceptional-risk surfaces

Route narrow Sol review only when the actual diff contains a concrete risk. High-signal ESL routes
include:

- migrations or schema: versioned migrations, `packages/batch-backend/schema.sql`, and contract
  verification requirements in `agents-ssot.md`;
- public DTOs and contracts: `@esl-pipeline/contracts`, manifest fields, compatibility, and
  [`docs/reference/VERSIONING_MODEL.md`](../docs/reference/VERSIONING_MODEL.md);
- auth, security, and privacy: authenticated backend/operations surfaces, secret handling, and
  [`docs/reference/env.md`](../docs/reference/env.md);
- durable workflow state and data integrity: backend persistence, action history, lineage, backup,
  restore, and replay paths;
- concurrency and idempotency: queue workers, retries, mutual exclusion, rollback, and both relevant
  operation orderings for shared mutable state;
- provider credentials and configuration: namespaced environment contracts, provider capabilities,
  quotas, and fail-safe defaults;
- production, deployment, or destructive operations:
  [`docs/backend-frontend/DEPLOYMENT.md`](../docs/backend-frontend/DEPLOYMENT.md) and the applicable
  runbook under [`docs/operations/`](../docs/operations/).

## Mutation authorization

- Delegated workers may edit only when the task explicitly authorizes delegated writes and only
  within their assigned files or responsibility.
- Workers never create worktrees, commits, branches, pushes, pull requests, releases, deployments,
  destructive operations, or external mutations by default.
- The primary owns integration, repository-level validation, and any Git or external mutation that
  the user separately authorizes.
- Preserve dirty and unrelated user work. Stop before overlapping or overwriting unknown changes.

## Local sandbox policy

The maintainer currently accepts `danger-full-access` for ordinary local development as a deliberate
convenience/risk tradeoff. Role mutation boundaries, the active instruction chain, and task
authorization remain controlling even when effective OS sandbox permissions are broader.

Do not assume explorer or reviewer read-only behavior is technically enforced solely by sandbox
metadata. Their role contract still prohibits repository or external mutation. Full Access is not
equivalent in safety to restricted modes; the maintainer may choose restricted or approval modes for
more sensitive work.

Do not change user-level Codex configuration from repository tasks.

## Primary integration notes

- For plan-backed execution, treat the approved implementation plan as the scope and acceptance
  contract, not a mandatory agent-per-task script. For goal-backed orchestration, the approved Goal
  Contract is the durable scope and completion contract; the current implementation plan is revisable
  strategy.
- Prefer the smallest useful role set and fresh child contexts for heterogeneous registered roles.
- Run the proportionate ESL repository gate before expensive Sol review when applicable.
- Use a final whole-branch Terra review only for substantial multi-boundary work where cross-boundary
  regressions are genuinely plausible.
- Report actual validation, CI-owned requirements, manual checks, and unresolved runtime ambiguity.
