# ChatGPT -> Codex Planning Handoff

## Purpose

This document defines how interactive design work should be turned into an implementation plan that
a Codex primary agent can execute efficiently when ESL's workflow selection requires a plan.

The planning model should be detailed about behavior, contracts, risks, and validation. It should be
deliberately less prescriptive about runtime agent choreography. Root [`AGENTS.md`](../AGENTS.md)
decides when full design and planning is proportionate; this file does not make planning mandatory.

## 1. Use ChatGPT for design, not remote micromanagement

The interactive planning phase should establish:

- the problem and desired outcome;
- scope and explicit non-goals;
- alternatives considered and important tradeoffs;
- architecture or contract decisions that require human approval;
- acceptance criteria;
- repository evidence that materially affects the design;
- validation and environment/manual checks required for confidence.

If local repository evidence is missing, stale, or cheaper for the user to obtain than for the
planning model to guess, ask for it.

Useful evidence requests include:

- current `AGENTS.md` and nested instruction files;
- package/CI commands;
- a focused repository trace;
- relevant source files or diffs;
- recent Codex rollout metadata;
- local command output;
- screenshots or runtime behavior when the problem is environment-specific.

Do not fill a repository-specific gap with generic assumptions when a small evidence request can
resolve it.

When interactive planning introduces non-trivial structural complexity or decides whether to account now for a known future constraint, apply the **complexity-discipline procedure**. When the installed source is available, read `.agents/skills/complexity-discipline/SKILL.md` and use its reasoning procedure; do not assume the ChatGPT planning environment supports Codex `$skill-name` invocation semantics. Require a concrete necessity chain and consider reversibility/retrofit cost rather than treating YAGNI as a universal veto. Prefer the simplest adequate design, but preserve architecture, risk controls, and difficult-to-reverse evidenced constraints when the evidence justifies them.

## 2. The implementation plan is the primary-agent contract

A good implementation plan may be detailed enough to include:

- exact files and symbols when known;
- test-first or reproduction steps;
- implementation sequence;
- validation commands;
- commit/checkpoint boundaries;
- manual or environment-owned verification;
- explicit stop conditions.

That detail is for the Codex primary agent. It does not imply one child agent per task or one child
tool call per checklist item.

## 3. Include orchestration-relevant metadata without freezing orchestration

For substantial plans, include a short `Execution Orchestration` section containing:

### Repository map freshness

State whether the relevant file/contract/test map is:

- `fresh-enough`: implementation can normally skip a new broad explorer pass;
- `partial`: a focused explorer pass is likely useful;
- `unknown`: exploration is required before editing.

State what evidence supports that judgment and when it was observed.

### Candidate ownership boundaries

Describe coherent implementation boundaries such as:

- API + authorization contract;
- one frontend workflow;
- persistence/migration path;
- packaging/release mechanics;
- one Windows/runtime integration boundary.

These are candidate delegation units, not mandatory agent-per-task assignments.

### Likely role routing

Use recommendations such as:

- `Luna candidate`: bounded, coherent, pattern-following or otherwise sufficiently specified
  implementation (configured xhigh by default; high only when quota or cost constraints materially
  matter, or a measured current-environment latency constraint justifies it);
- `Terra workhorse candidate`: integration-heavy predetermined implementation, including small
  changes whose correctness is primarily in interacting state or contracts;
- `Terra review`: expected for a substantial or independently risky ordinary boundary; conditional
  when an independently justified final whole-branch review is already planned and will cover a
  small validated boundary before final integration or release;
- `Sol review candidate`: expected exceptional-risk surface if the implementation actually touches it.

The Codex primary owns final routing from current repository state and the actual diff.

### Validation gates

List focused checks, repository-level gates, CI-owned evidence, and manual/environment checks
separately. Discover exact ESL commands through [`.codex/PROJECT.md`](PROJECT.md) and the routed ESL
documentation rather than copying the full validation manual into a plan.

## 4. Do not pre-script unnecessary children

Avoid plans whose orchestration section says:

> Spawn agent A for Task 1, agent B for Task 2, agent C for Task 3...

unless those tasks are genuinely independent ownership boundaries.

Prefer:

> Tasks 1 and 2 form one Windows-hosting ownership boundary and may share one integration worker.
> Task 3 is a separate mechanical release boundary suitable for the bounded implementation role.

Likewise, do not require an explorer merely because the workflow has an explorer role, do not
require Sol review merely because the design discussed a risky possibility, and do not require a
dedicated ordinary Terra review when its coverage would be duplicated by an independently justified
final whole-branch review already planned to cover the boundary before final integration or release.

## 5. Child prompts are compressed at execution time

The implementation plan can retain fine-grained steps. The Codex primary should translate a coherent
boundary into a shorter child assignment containing:

- ownership;
- required outcomes;
- acceptance criteria;
- targeted validation;
- important invariants;
- stop/escalation conditions;
- explicit mutation/commit authorization.

The planning document should not attempt to fully write every future child prompt unless an unusual
task needs exact wording for safety.

## 6. Recommended implementation-plan section

Use a section shaped like this:

```md
## Execution Orchestration

Apply the repository's portable orchestration standard.

### Repository map freshness

Status: fresh-enough | partial | unknown
Evidence: ...
Explorer guidance: ...

### Candidate ownership boundaries

1. `<boundary>`
   - scope: ...
   - likely role: Luna | Terra workhorse | primary
   - files/responsibility: ...
   - stop/escalation condition: ...

2. `<boundary>`
   - ...

### Review routing

- Terra review: expected | conditional | unnecessary (state whether a final whole-branch review
  supplies the conditional coverage)
- Exceptional-risk candidate: ...
- Sol review only if the actual diff contains: ...

### Validation ownership

- child-focused checks: ...
- primary repository gate: ...
- CI-owned checks: ...
- manual/environment checks: ...
```

## 7. Recommended Codex launch prompt

A compact launch prompt is usually enough when the repository already contains the approved
artifacts:

> Read the active `AGENTS.md`, `.codex/ORCHESTRATION.md`, `.codex/PROJECT.md`, and the approved
> design/implementation plan. Implement the plan as the primary orchestrator. Treat the plan as scope
> and acceptance contract, but group delegation by coherent ownership boundary rather than numbered
> task. Use actual registered custom roles with fresh heterogeneous-model child contexts. Skip
> redundant exploration when the plan's repository map is still fresh. Give children compressed
> deliverables, acceptance criteria, validation, and stop conditions rather than replaying every
> parent-plan micro-step. Route ordinary coherent review to Terra and exceptional-risk review to Sol
> only when the actual diff warrants it; deduplicate a small validated local Terra review only when
> an independently justified final whole-branch Terra review is already planned and will cover that
> boundary before final integration or release. Preserve ESL authorization boundaries for commits,
> pushes, PRs, releases, deployments, and destructive operations.

Add repository-specific mutation authorization explicitly when needed.

## 8. Planning quality check before handoff

Before calling a plan ready, confirm:

- the human approved the design decisions that materially affect behavior or contracts;
- acceptance criteria are observable;
- non-goals prevent obvious scope creep;
- repository-specific facts are evidence-backed or clearly marked unknown;
- validation commands are discovered rather than guessed;
- non-trivial structural complexity has a concrete necessity chain, and known future constraints were judged using reversibility/retrofit cost rather than mechanical YAGNI;
- orchestration recommendations describe boundaries, not ceremony;
- the plan leaves the Codex primary enough freedom to adapt to current repository state without
  redesigning the approved behavior.
