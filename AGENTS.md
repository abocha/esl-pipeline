# Agent Handbook

## Purpose

This file is the always-loaded repository entrypoint for AI agents and maintainers. Keep it as a
compact router plus repo-wide operating contract. Let task docs, package READMEs, skills, scripts,
CI, and the SSOT own detail.

For product/runtime contracts and invariants, `docs/reference/agents-ssot.md` is authoritative when
it conflicts with this file.

## Routing

Use the smallest current route that answers the task.

- Start from the task itself and this file.
- Use `docs/README.md`, the owning package README, active plan, or task-specific doc for normal
  repository work.
- Use `docs/reference/DOCS_IA_MAP.md` only when the documentation route is unclear.
- Read `docs/reference/agents-ssot.md` when work touches contracts, invariants, persistence,
  security/auth, validation policy, production, or repository administration.
- For delegated execution, approved plans/Goal Contracts, role routing, context reuse, or review
  mechanics, use `.codex/WORKFLOW_MODES.md`, `.codex/ORCHESTRATION.md`, and `.codex/PROJECT.md` as
  applicable.
- Invoke project skills only when their narrow trigger applies. Do not load adjacent skills merely
  because they exist.

Current code/configuration and live Git/CI/GitHub state outrank dated plans, evidence records, and
archive material for facts that can change.

## Repo-wide invariants

- Do not bypass orchestrator contracts for pipeline behavior changes.
- Do not hardcode secrets.
- Do not silently change manifest, DTO, environment, database, or other public/durable contracts.
- Treat archive and historical evidence as history, not current procedure.
- Keep behavior, tests, owning docs, and package READMEs aligned when the change affects them.
- Preserve unrelated or unknown user work. Do not overwrite or clean it up as a side effect.

Put subsystem-specific detail in its owning package/doc. Put reusable optional procedures in skills.
Put deterministic requirements in code, scripts, hooks, or CI rather than relying on prose alone.

## Workflow and authorization

Choose the lightest workflow that fits current ambiguity and risk. Detailed workflow/model routing
belongs in `.codex/WORKFLOW_MODES.md` and `.codex/ORCHESTRATION.md`.

Do not manufacture planning, delegation, review, or Goal Contracts for bounded work. Material
architecture, contract, security/privacy, persistence, concurrency, migration, or production design
decisions require the approval expected by the current workflow. Goal-backed orchestration is
explicit opt-in.

Do not create worktrees, commits, branches, pushes, pull requests, releases, deployments, destructive
operations, production mutations, or other external mutations unless the user/task authorization
covers that action and scope. Authorization persists while its action and scope remain unchanged; it
does not expand through delegation or broad OS/tool access.

## Execution and delegation

The primary agent owns repository accountability, integration, validation decisions, authorized Git
mutations, and the final result.

Delegation is optional. Delegate by coherent ownership boundary when it materially helps; do not
spawn agents per checklist item or merely to create independence. Use registered project roles and
their current routing rules rather than inventing substitutes.

Let a capable worker own its local inspect/edit/test loop. Treat worker completion as evidence, not
automatic acceptance, but do not shadow or repeat its investigation without a concrete unresolved
risk.

Use the project complexity discipline only when structural-complexity judgment is genuinely
non-trivial. Straightforward pattern-following work does not need a complexity ritual.

## Evidence and validation

Prefer the lowest-cost reliable evidence path and stop when it answers the decision.

- Focused local evidence is the default while editing and before handoff.
- Do not automatically run a repository-wide local gate. Use broader local/service-backed evidence
  only for a concrete plausible wider failure, environment behavior under test, unavailable hosted
  equivalent, or reproduction/diagnosis of a specific hosted-CI failure.
- Hosted PR CI is the comprehensive merge gate. A focused local pass can make work ready for hosted
  CI; it does not make a PR merge-ready.
- Diagnose hosted failures from the exact selected job and its logs/artifacts. Do not substitute a
  neighboring summary or unrelated broad local run.
- Inspect existing retained evidence before rerunning. Do not repeatedly rerun unchanged failures to
  obtain a green result; allow at most one isolated rerun when it can resolve a real uncertainty.
- Follow `docs/reference/TESTING_GUIDELINES.md` and owning package scripts for current commands.
  Invoke `esl-pipeline-validation-evidence` only when its validation-system trigger applies.

All hosted checks required by current repository policy must pass before merge.

## Review

Review follows residual semantic risk, not diff existence, file count, delegation, or ceremony.

Use the current review routing in `.codex/ORCHESTRATION.md`. Once an invariant has been convincingly
closed, later review should focus on the new fix and direct regressions unless evidence reopens it.
Do not stack reviewers or whole-branch review without a concrete remaining cross-boundary risk.

## GitHub and repository administration

GitHub Issues is the canonical engineering backlog. Read the complete issue before acting and treat
proposed causes/fixes as hypotheses until evidence supports them. Follow
`docs/operations/github-issue-intake-and-codex-work-selection.md` for current intake/status rules.

Use short-lived feature branches and avoid direct pushes to `main`. Use Conventional Commit style.
Every PR to `main` must have exactly one release label allowed by current versioning policy, and PR
validation text must list evidence actually obtained. Follow the current PR/versioning docs rather
than copying their mutable details here.

For PR metadata, hosted-CI follow-up, validation-system changes, or deployment work, use the matching
project skill when its trigger applies.

## Definition of done

- The requested outcome is implemented without silently widening scope or changing unapproved
  contracts.
- Relevant evidence is current enough for the changed surface and is reported accurately.
- Required docs/generated references are synchronized where affected.
- Remaining hosted, manual, environment, deployment, or authorization-owned steps are stated
  explicitly rather than implied complete.