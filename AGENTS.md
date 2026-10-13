# Agent Handbook

## Meta

- Audience: AI agents and maintainers.
- Authority Level: router + compact operating contract.
- Last Verified Against: 2026-10-01 repository/workflow state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly or after major workflow/tooling changes.
- Status: `router`.

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
- For documentation audits, consolidation, or cutovers that invalidate scattered guidance, use
  `.agents/skills/esl-pipeline-docs-gardening/SKILL.md` and the gardening playbook's scoped route.
- For local validation, start with the
  [evidence decision route](docs/reference/TESTING_GUIDELINES.md#choose-the-evidence-route), then the
  owning package's execution recipe. Load validation-system or test-audit skills only for their triggers.
- Read `docs/reference/agents-ssot.md` when work touches contracts, invariants, persistence,
  security/auth, validation policy, production, or repository administration.
- For delegated execution, approved plans/Goal Contracts, role routing, context reuse, or review
  mechanics, use `.codex/WORKFLOW_MODES.md`, `.codex/ORCHESTRATION.md`, and `.codex/PROJECT.md` as
  applicable.
- Invoke project skills only when their narrow trigger applies. Do not load adjacent skills merely
  because they exist.
- Explicit current task instructions take precedence over optional skill guidance unless a
  controlling repository contract requires otherwise. If a skill or workflow rule would pause or
  leave requested work unfinished, identify the controlling requirement and explain why it applies.

Current code/configuration and live Git/CI/GitHub state outrank dated plans, evidence records, and
archive material for facts that can change. Remembered context can locate decisions and owners;
verify remembered commands and mutable facts against those current sources.

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

An authorized implementation outcome includes ordinary local repository operations reasonably needed
to complete it, within the task scope and repository restrictions. Consequential external or
destructive mutations still require the authorization specified by task and repository policy.
Authorization persists within its scope; delegation and broad OS/tool access do not expand it.

## Execution and delegation

The primary agent owns integration, validation decisions, and the final result. It remains
accountable for repository state and authorized mutations performed by workers.

Delegation is optional. Delegate by coherent ownership boundary when it materially helps; do not
spawn agents per checklist item or merely to create independence. Use registered project roles and
their current routing rules rather than inventing substitutes.

Let a capable worker own its local inspect/edit/test loop. Treat worker completion as evidence, not
automatic acceptance, but do not shadow or repeat its investigation without a concrete unresolved
risk.

Use the project complexity discipline only when structural-complexity judgment is genuinely
non-trivial. Straightforward pattern-following work does not need a complexity ritual.

## Evidence and validation

Focused local evidence is the default; hosted PR CI is the comprehensive merge gate. Prefer the
lowest-cost reliable evidence and stop when it answers the decision. All required hosted checks
must pass before merge.

The [testing guide](docs/reference/TESTING_GUIDELINES.md#choose-the-evidence-route) owns evidence
selection, broader-check conditions, hosted diagnosis, reuse and completion. Package READMEs own
execution recipes; scripts and test configuration own current commands and prerequisites. Validation
contracts remain in the [SSOT](docs/reference/agents-ssot.md#runtime-and-verification-baseline).
Invoke `esl-pipeline-validation-evidence` only when changing or diagnosing the validation system itself.

## Review

Review follows residual semantic risk, not diff existence, file count, delegation, or ceremony.

Use the current review routing in `.codex/ORCHESTRATION.md`. Once an invariant has been convincingly
closed, later review should focus on the new fix and direct regressions unless evidence reopens it.
Do not stack reviewers or whole-branch review without a concrete remaining cross-boundary risk.

## Planning, GitHub, and repository administration

Linear is the canonical planning backlog and durable working memory. Use the `Abocha` team for
ideas, investigations, product/design decisions, roadmaps, prioritization, and deferred work.

GitHub Issues is the repository-native execution ledger. New bounded implementation, migration,
rollout, incident-remediation, CI/release, or similar execution work should be created in the Linear
`ESL Execution` team and allowed to sync to this repository through the configured two-way GitHub
Issues integration. Do not manually create a duplicate on both sides. Existing GitHub execution
issues that predate this split may finish in place.

Do not create a GitHub issue merely to remember a thought or future possibility. Promote planning
work to execution only when a concrete repository contract, acceptance criteria, or PR/CI/release/
deployment linkage is useful. Read the complete execution issue before acting and treat proposed
causes/fixes as hypotheses until evidence supports them. Follow
`docs/operations/github-issue-intake-and-codex-work-selection.md` for the current boundary.

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
- Completed execution context follows the plan lifecycle; preserve unique current guidance and
  repair affected routes before archiving it.
- Remaining hosted, manual, environment, deployment, or authorization-owned steps are stated
  explicitly rather than implied complete.
