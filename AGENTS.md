# Agent Handbook (v6)

## Meta

- Audience: AI agents and maintainers.
- Authority Level: router + compact operating contract.
- Last Verified Against: 2026-08-12 repository/workflow state and current Codex agent guidance.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly or after major workflow/tooling changes.
- Status: `router`.

This file is the always-loaded repository entrypoint. Keep it short, follow the smallest relevant
documentation route, and let task docs and SSOT carry subsystem detail.

If this file conflicts with [`docs/reference/agents-ssot.md`](docs/reference/agents-ssot.md), the
SSOT wins.

## Task Routing

1. For delegated work or execution from an approved plan, read
   [`.codex/ORCHESTRATION.md`](.codex/ORCHESTRATION.md), then
   [`.codex/PROJECT.md`](.codex/PROJECT.md).
2. Start with [`docs/README.md`](docs/README.md) for a known ESL task.
3. Use [`docs/reference/DOCS_IA_MAP.md`](docs/reference/DOCS_IA_MAP.md) only when the route is unclear.
4. Read the task-specific doc, active plan, or owning package README.
5. Read [`docs/reference/agents-ssot.md`](docs/reference/agents-ssot.md) when work touches contracts,
   invariants, validation policy, production, or repository administration.

## Non-Negotiables

- Do not bypass orchestrator contracts for pipeline behavior changes.
- Do not hardcode secrets.
- Do not silently change manifest, DTO, environment, or database contracts.
- Do not treat archive docs as current truth.
- Keep code, tests, active docs, and package READMEs aligned when behavior changes.
- When implementing from a plan, re-read that exact plan after context compaction.
- Treat the developer laptop as the primary development environment, Git/CI as the source of truth,
  and the Lightsail VPS as production runtime only.

## Instruction Scope

- Keep only durable repo-wide conventions, commands, constraints, review expectations, and
  completion criteria here.
- Put subsystem detail in the nearest package README or task-specific doc. Use nested `AGENTS.md`
  files only for repeated subtree-specific overrides.
- Put one-off outcomes and acceptance criteria in the task prompt or active plan.
- Put reusable procedures in skills and deterministic requirements in scripts, hooks, or CI.

## Workflow Selection

Choose the lightest workflow consistent with ambiguity and risk:

- **Direct execution:** use for obvious, isolated, low-risk changes. Do not require brainstorming, a
  specification, an implementation plan, a worktree, delegated implementation, or delegated review.
- **Targeted discipline:** use for contained bugs and behavior changes. Invoke only the relevant
  debugging, TDD, review, or verification workflow rather than the full design lifecycle.
- **Full design and planning:** use when behavior is unsettled or work crosses architecture,
  frontend/backend/database boundaries, migrations, authentication, authorization, persistent state,
  concurrency, data integrity, or production risk. Obtain approval for the design and plan before
  implementation.

Repository authorization overrides workflow-plugin defaults. Do not create worktrees, commits,
branches, pushes, pull requests, deployments, delegated writes, or external mutations unless the
user explicitly authorizes that action. The user prompt or an approved task plan may further narrow
the workflow.

## GitHub Issue Workflow

- GitHub Issues is the only canonical engineering backlog.
- When selecting work, use open issues labeled `status:ready` by default and match `effort:*` to the
  maintainer's available time and quota.
- Read the complete issue before editing. Validate the reported behavior first; proposed causes and
  fixes are hypotheses until evidence confirms them.
- `status:inbox` means captured but not yet actionable; `status:blocked` means a stated dependency,
  missing evidence, or required decision prevents progress.
- Use `Fixes #N` only when the linked issue's acceptance criteria are genuinely satisfied.

The detailed intake and selection procedure is in
[`docs/operations/github-issue-intake-and-codex-work-selection.md`](docs/operations/github-issue-intake-and-codex-work-selection.md).

## Complexity Discipline

- Do not introduce structural complexity without a concrete reason grounded in requirements,
  repository contracts, correctness/risk, or an evidenced constraint whose retrofit cost matters.
  Prefer the simplest adequate design, not the smallest diff or fewest files.
- Use `$complexity-discipline` only when that structural-complexity judgment is non-trivial. Typical
  triggers include new abstractions/helper layers, dependencies, configuration surfaces, compatibility
  mechanisms, generalized extension points, duplicated repository/platform/standard-library capability,
  substantial newly discovered work, or deciding whether a difficult-to-reverse known future constraint
  should be handled now.
- Do not invoke it for straightforward pattern-following work whose design is already established and
  unambiguous. Do not apply YAGNI mechanically. The discipline does not expand task scope, role
  authority, mutation authorization, or architectural authority.

## Ownership and Project Roles

- The primary agent owns decomposition, integration, repository accountability, repository-level
  validation, separately authorized Git mutations, and the final result.
- Delegated implementation is opt-in. It requires explicit scope, file or responsibility ownership,
  acceptance criteria, validation, and a named project role.
- Project roles are narrow and non-default:
  - `luna_implementer`: GPT-5.6 Luna at xhigh for bounded coherent, pattern-following or otherwise
    sufficiently specified implementation with explicit acceptance criteria and targeted validation.
    High is only a fallback when quota or cost materially matters or measured current-environment
    latency justifies it. Stop before architecture, security or authorization, privacy,
    persistent-data integrity, migrations, concurrency, public contracts, or production decisions.
  - `terra_workhorse`: GPT-5.6 Terra at high for predetermined implementation requiring substantial
    semantic coupling or integration judgment. Route by interaction complexity rather than size;
    signals include cross-process state, concurrency, transactional or rollback semantics, several
    mutually dependent ownership surfaces, or correctness located primarily in component interactions.
  - `terra_explorer`: GPT-5.6 Terra at low for conditional read-only tracing of execution paths,
    ownership, contracts, tests, configuration, and active docs. Skip it when an active plan already
    supplies a fresh trustworthy map.
  - `terra_reviewer`: GPT-5.6 Terra at high for ordinary coherent correctness, integration,
    regression, failure-handling, and testing review.
  - `sol_reviewer`: GPT-5.6 Sol at high for narrow concrete exceptional-risk surfaces in the actual
    diff, including security or authorization, privacy, persistent-data integrity, destructive
    operations, migrations, concurrency, retry or idempotency, or comparable high-consequence behavior.
- `terra_explorer` must stop and return control when exploration reveals ambiguous ownership,
  contradictory contracts, implicit state transitions, concurrency, data-integrity implications, or
  architectural decisions.
- Use the smallest role set that materially improves the result. Give every role a bounded,
  non-overlapping question or responsibility. Do not duplicate an explorer's trace in the primary
  context; perform only the targeted verification needed to decide or validate the work.
- For heterogeneous delegated children, prefer fresh task contexts equivalent to
  `fork_turns = "none"` where supported. Select the registered project role, never silently substitute
  a generic/default child, and verify role, model, effort, and parent linkage from runtime metadata
  when available.

## Review Routing

- Review coherent subsystem and risk batches, not every implementation-plan checklist item.
- Use `terra_reviewer` at high reasoning for ordinary meaningful review batches.
- A dedicated local Terra review may be skipped only when the child boundary is small and bounded,
  risk is non-exceptional, focused and appropriate repository-level validation are green, no concrete
  independent review risk exists, and an independently justified final whole-branch Terra review is
  already planned to cover the boundary before final integration or release. Skipping must
  meaningfully avoid duplicate review or context cost; this is review deduplication, not avoidance.
- Reserve `sol_reviewer` at high reasoning for the narrow exceptional-risk surfaces named above. When
  the repo-wide automated gate is proportionate, run it first so Sol spends context on semantic risk
  rather than failures the normal suite already exposes.
- For substantial multi-boundary work, use one final Terra/high whole-branch review when
  cross-boundary regressions are genuinely plausible. Do not make this universal or stack broad
  review ceremony without a concrete unresolved reason.
- Send follow-up review of the same implementation context to the original reviewer when available
  so assumptions and unresolved findings carry forward. Use sibling or fresh reviewers only for
  genuinely independent scopes, such as separate Terra and Sol risk surfaces or a separately scoped
  final integration review.

## Evidence and Validation

- Prefer the lowest-cost reliable evidence path: the smallest relevant doc set, targeted search,
  focused test, or bounded specialist review. Stop when evidence is sufficient for the decision.
- During editing, run the narrowest relevant package, file, or related-test lane first.
- After focused tests, use `pnpm --silent run check:fast:agent` by default. Use
  `pnpm check:pre-pr` directly for broad, cross-cutting, shared-contract, or toolchain work, and use
  `pnpm check` when reproducing CI or changing DB, migration, worker, or integration behavior.
- Prefer existing `:agent` commands. Read their cited artifacts under `tmp/check-logs/...` or
  `tmp/test-logs/...` before any diagnostic rerun. Allow at most one isolated rerun per unchanged
  failure; rerun the complete gate only after relevant state changes.
- Clearly docs-only work may use `pnpm docs:generate:indexes`, `pnpm format`, and
  `pnpm docs:check`. Follow [`docs/reference/TESTING_GUIDELINES.md`](docs/reference/TESTING_GUIDELINES.md)
  for test-lane details.
- `PASS_WITH_CI_REQUIREMENTS` permits PR creation, not merge. Every selected hosted job and `CI gate`
  must pass before merge.
- Migration, schema-baseline, and contract-version changes also require the verification commands in
  [`docs/reference/agents-ssot.md`](docs/reference/agents-ssot.md).
- Production Compose remains pull-based with SHA-tagged images and deployment state outside the
  checkout. Do not reintroduce production builds, local tags, `pull_policy: never`, `up --build`,
  backend Docker socket mounts, or long-running backend Docker/AWS CLIs.

## Definition of Done

- The requested outcome is implemented without widening scope or silently changing contracts.
- Relevant tests and validation have fresh evidence, and the final handoff lists commands run.
- Behavior docs, package READMEs, plans, and generated indexes are synchronized where affected.
- Deployment and other external mutations occur only when explicitly requested.

## Repository Administration

- Use short-lived feature branches; avoid direct pushes to `main`.
- Use Conventional Commit style: `<type>(<scope>): <short imperative summary>`.
- Every PR to `main` needs exactly one release label selected under
  [`docs/reference/VERSIONING_MODEL.md`](docs/reference/VERSIONING_MODEL.md).
- PR validation text must list commands actually run.
- Follow [`docs/reference/agents-ssot.md`](docs/reference/agents-ssot.md) and
  [`docs/operations/pr-style-release-notes.md`](docs/operations/pr-style-release-notes.md) for the
  complete PR workflow.
