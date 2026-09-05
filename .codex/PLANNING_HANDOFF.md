# ChatGPT -> Codex Planning Handoff

## Purpose

This document defines how interactive design work should be turned into an implementation plan or
Goal Contract that a Codex primary agent can execute efficiently when ESL's full design and planning
path requires an orchestrated handoff.

The planning model should be detailed about behavior, contracts, risks, and validation. It should be
deliberately less prescriptive about runtime agent choreography. Root [`AGENTS.md`](../AGENTS.md)
decides when full design and planning is proportionate; this file does not make planning mandatory.

## 0. Confirm that an orchestrated handoff is the right next step

Before writing an implementation plan or Goal Contract, confirm that:

- the desired outcome is sufficiently stable;
- acceptance criteria can be stated without depending on another open investigation;
- several implementation steps or ownership boundaries now need coordination; and
- preserving one approved plan, or one approved durable outcome with an adaptive strategy, is cheaper
  and safer than continuing interactive design/exploration one result at a time.

If WHAT success means or WHETHER to pursue the outcome is unresolved, continue interactive
design/exploration instead of creating a durable goal or launching an orchestrated handoff.

When the work is ready, carry forward the approved decisions, rejected alternatives, current
repository evidence, deferred items, and explicit non-goals. Do not carry forward every exploratory
transcript.

### 0.1 Choose the execution handoff

ESL's `Full design and planning` path has two execution handoffs. This is a routing refinement, not a
fourth top-level workflow category.

#### Plan-backed execution (default)

Use plan-backed execution when the desired behavior is stable, the implementation path is sufficiently
known, and an approved implementation plan is an appropriate top-level scope and acceptance contract.
The plan remains the primary agent's strategy and completion checklist. Durable goal state would add
more ceremony than information.

#### Goal-backed orchestration (optional)

Use goal-backed orchestration only when the user explicitly selects or approves it. It is appropriate
when:

- the desired outcome and acceptance boundary are already stable and verifiable;
- the implementation strategy is expected to adapt materially as repository evidence emerges;
- several dependent ownership boundaries or root turns may be needed;
- durable outcome state across a long-lived primary agent is useful; and
- outcome-level completion is meaningfully different from exhausting the current task list.

The handoff does not need fake certainty about every future implementation task. It must establish the
approved stable outcome, known behavioral/architecture/contract decisions, current repository
evidence, scope and non-goals, validation expectations, candidate ownership boundaries, unresolved
decisions requiring human approval, and the current plan/strategy to the extent currently justified.
Goal-backed execution permits adaptive implementation strategy, not autonomous redefinition of
approved architecture, contracts, product behavior, or acceptance criteria. A material change to the
objective is escalation, not ordinary plan drift.

### Goal Contract

For a goal-backed handoff, include a concise contract shaped like:

```md
## Goal Contract

Mode: goal-backed

Objective: <single concise outcome>

Completion evidence:

- <observable evidence or validator>
- ...

Scope:

- in: ...
- out: ...

Stop/escalation conditions:

- ...
```

The Goal Contract is the richer human/ChatGPT/Codex handoff contract and durable completion
semantics. The persisted Codex runtime objective, when goal tools are available, is only a concise
representation of that approved outcome. Do not assume ChatGPT itself has Codex goal-tool runtime
semantics. Do not invent numerical precision merely for appearance; use a meaningful threshold when
the domain supports one and otherwise use the strongest honest binary validator.

Reject activity goals such as “make progress,” “keep investigating,” or “work on X.” The objective
must state what concrete thing will be true, how completion will be proved, and what should cause the
primary to stop or escalate rather than grind. Goal-backed mode is not appropriate while WHAT success
means or WHETHER to pursue the outcome remains under investigation.

## 1. Plan where the evidence is

ChatGPT is the default discussion environment. A bounded Codex investigation may develop the recommendation when repeated local inspection is needed. Return to ChatGPT when further discussion helps; routine execution needs no mandatory round trip. Suggest manual evidence commands only when convenient for the maintainer. See `WORKFLOW_MODES.md` for revisable model-selection defaults.

Recommend one execution or routing choice by default. Surface alternatives only when they materially
differ in correctness, cost or quota, independence, or required maintainer involvement. The
maintainer approves consequential design and scope decisions; routine model topology and dispatch
remain execution mechanics.

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

## 2. The execution-variant contract

For plan-backed execution, the approved implementation plan is the primary agent's scope and
acceptance contract. It may be detailed enough to include files, implementation sequence, validation,
checkpoints, and explicit stop conditions.

For goal-backed orchestration, the approved Goal Contract is the durable primary-agent scope and
completion contract. The current implementation plan may remain detailed and useful, but it is
revisable strategy beneath the Goal Contract; plan or task exhaustion does not define goal completion.

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

Apply [`.codex/ORCHESTRATION.md`](ORCHESTRATION.md) and [`.codex/PROJECT.md`](PROJECT.md). Root
[`AGENTS.md`](../AGENTS.md) and [`docs/reference/agents-ssot.md`](../docs/reference/agents-ssot.md)
remain authoritative for ESL routing, product/runtime contracts, validation, and mutation boundaries.

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
artifacts.

### Plan-backed launch

> Read the active `AGENTS.md`, `.codex/ORCHESTRATION.md`, `.codex/PROJECT.md`, and the approved
> design/implementation plan. Implement the plan as the primary orchestrator. Treat the plan as scope
> and acceptance contract, but group delegation by coherent ownership boundary rather than numbered
> task. Use actual registered custom roles with fresh heterogeneous-model child contexts when a fresh
> context materially helps; skip redundant exploration when the plan's repository map is still fresh.
> Give children compressed deliverables, acceptance criteria, validation, and stop conditions rather
> than replaying every parent-plan micro-step. Route ordinary coherent review to Terra and
> exceptional-risk review to Sol only when residual semantic risk in the actual diff warrants it;
> deduplicate a small validated local Terra review only when an independently justified final
> whole-branch Terra review is already planned and will cover that boundary before final integration or
> release. Preserve ESL authorization boundaries for commits, pushes, PRs, releases, deployments, and
> destructive operations.

### Goal-backed launch

> This is a goal-backed orchestration run. Read the active `AGENTS.md`, `.codex/ORCHESTRATION.md`,
> `.codex/PROJECT.md`, the relevant ESL SSOT/routed task docs, and the approved handoff. Use the
> approved Goal Contract as the durable completion boundary. Explicitly use goal tracking when the
> Codex runtime provides it: inspect or reuse the current thread goal, and create the approved concise
> objective only if there is no unfinished active goal. Keep exactly one root goal. Adapt the
> implementation strategy from repository evidence, delegate coherent ownership boundaries, audit
> progress against the goal, and do not mark it complete until outcome-level evidence exists and no
> required work remains. Escalate material goal conflicts rather than redefining success. Preserve
> existing ESL mutation, role, review, architecture, contract, and authorization boundaries.

Add repository-specific mutation authorization explicitly when needed.

## 8. Planning quality check before handoff

Before calling a plan ready, confirm:

- the work actually belongs in the full design and planning path rather than direct execution or
  targeted discipline;
- the selected handoff is plan-backed by default or explicitly approved goal-backed orchestration;
- goal-backed handoffs have a stable, verifiable outcome and a complete Goal Contract rather than an
  activity goal;
- the human approved the design decisions that materially affect behavior or contracts;
- acceptance criteria are observable;
- non-goals prevent obvious scope creep;
- repository-specific facts are evidence-backed or clearly marked unknown;
- validation commands are discovered rather than guessed;
- non-trivial structural complexity has a concrete necessity chain, and known future constraints were judged using reversibility/retrofit cost rather than mechanical YAGNI;
- orchestration recommendations describe boundaries, not ceremony;
- the plan leaves the Codex primary enough freedom to adapt to current repository state without
  redesigning the approved behavior.
