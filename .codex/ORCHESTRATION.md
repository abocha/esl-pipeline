# Codex Orchestration Standard

## Purpose

This document defines how an approved implementation plan or Goal Contract, as applicable, is
translated into delegated Codex work. For plan-backed execution, the approved implementation plan is
the scope and acceptance contract. For goal-backed orchestration, the approved Goal Contract is the
durable scope and completion contract, while the current implementation plan/strategy is revisable
beneath it. Direct execution and targeted discipline remain available under root [`AGENTS.md`](../AGENTS.md);
delegation is not automatic.

This document controls delegation granularity, role routing, context economy, review routing, and
primary-agent integration. [`.codex/PROJECT.md`](PROJECT.md) adapts these mechanics to ESL Pipeline,
while [`docs/reference/agents-ssot.md`](../docs/reference/agents-ssot.md) remains the product/runtime
SSOT.

The intended delegated workflow is:

```text
approved task or plan
        -> Codex primary
        -> smallest useful set of fresh registered-role children
        -> primary integration + ESL repository validation
```

The primary agent always owns decomposition, integration, repository accountability,
repository-level validation, authorized Git mutations, and the final result.

## 0. Goal-backed orchestration

Plan-backed execution remains the default execution variant within ESL's `Full design and planning`
path. Use the approved implementation plan as the scope and acceptance contract when the desired
behavior is stable, the implementation path is sufficiently known, and durable goal state would add
more ceremony than information.

Goal-backed orchestration is optional and requires explicit user selection or approval. Use it only
when the outcome and acceptance boundary are already stable and verifiable, the implementation
strategy is expected to adapt materially as repository evidence emerges, several dependent ownership
boundaries or root turns may be needed, durable outcome state across a long-lived primary agent is
useful, and outcome-level completion is meaningfully different from exhausting the current task list.
Do not infer goal-backed mode from work being large, multi-step, delegated, difficult, or long-running.
If WHAT success means or WHETHER to pursue the outcome remains unresolved, continue interactive
design/exploration instead of creating a durable goal.

### Root goal lifecycle

The primary agent owns exactly one durable root goal for a goal-backed run. At intake or resumption, it
should:

1. read the repository instructions, approved Goal Contract/handoff, relevant ESL SSOT/routed docs,
   and [`.codex/PROJECT.md`](PROJECT.md);
2. inspect the current thread goal with `get_goal` when goal tools are available;
3. create the explicitly approved concise objective only when there is no unfinished active goal;
4. reuse a matching active goal rather than duplicate it;
5. escalate a conflicting active goal or materially changed desired outcome rather than silently
   replacing or redefining the scope; and
6. derive the current plan, tasks, and child routing from fresh repository evidence under the stable
   goal.

Runtime semantics are capability-dependent. When available, Codex may expose `get_goal`,
`create_goal`, and `update_goal`: creation is explicit-request-only, an unfinished active goal
prevents duplicate creation, and updating changes goal status rather than rewriting the objective.
Omit a token budget unless the user explicitly requests one. Follow the runtime's supported lifecycle
for statuses such as `complete` or `blocked`; do not hard-code a transient blocked threshold or other
runtime-specific implementation detail into repository policy.

The persisted runtime objective is a concise representation of the approved outcome, not a replacement
for the richer Goal Contract. The goal is stable unless the human intentionally changes the desired
outcome. Approved architecture, behavioral, contract, and risk-sensitive decisions remain stable
unless new evidence reaches an approval boundary. The implementation plan and current task/child
routing are revisable strategy owned by the primary. A material objective change is escalation, not
normal plan mutation; never mark an unfinished goal complete merely to replace it.

### Children and outcome audits

The primary agent is the sole owner of durable goal state for the run. Children do not create durable
subgoals. Luna, Terra, and reviewer assignments remain ordinary compressed ownership-boundary
assignments with local acceptance criteria, stop conditions, and only the mutation authority explicitly
granted by the existing ESL workflow and repository instructions. Goal-backed execution grants no extra
write, architecture, commit, deployment, review, or other authority to the primary or children. Existing
ESL role contracts remain unchanged. A human
may deliberately start a separate goal-backed root thread later; that is outside the current run.

After meaningful implementation or review phases, the primary should audit progress against the root
outcome rather than only checking whether the current task list is empty. Before marking the root goal
complete, perform the existing final-integration checks plus an outcome audit:

- map every required outcome and acceptance criterion to actual evidence;
- inspect the integrated repository state and diff;
- run required repository-level ESL validators;
- account for required CI, manual, or environment-owned evidence;
- identify any required item still outstanding; and
- confirm that task exhaustion has not been mistaken for outcome completion.

If required evidence is missing, do not claim completion. Material goal or scope conflicts must be
escalated through the runtime-supported path. All existing complexity-discipline, role-routing,
review, mutation, authorization, and final-integration rules below remain unchanged.

## 1. Parent plan versus child assignment

Detailed implementation plans are written for the primary agent. They may contain fine-grained TDD,
edit, validation, sequencing, and commit steps. In a goal-backed run, the current plan/strategy may
remain partial and is revised from repository evidence beneath the stable Goal Contract.

Do not mechanically copy every fine-grained plan step into a delegated child's prompt.

A child assignment should normally contain:

- the coherent ownership boundary;
- exact files or responsibility when known;
- required outcomes;
- acceptance criteria;
- targeted validation;
- explicit stop or escalation conditions;
- mutation and commit authorization when applicable.

For plan-backed execution, the primary retains the full plan checklist and verifies that all
requirements were satisfied after delegated work returns. For goal-backed orchestration, the primary
retains and revises the current strategy/checklist beneath the Goal Contract, then verifies the
outcome requirements after delegated work returns.

## 2. Delegate by ownership boundary

Delegate by coherent subsystem or responsibility rather than one child per numbered plan task.

Adjacent approved-plan tasks may share one worker when they substantially share:

- subsystem;
- files;
- contracts;
- implementation context.

Keep distinct acceptance criteria, validation, and commit checkpoints where the plan requires them.

Do not combine unrelated work merely to reduce the number of agents.

Do not spawn a new child when the current child already owns the same coherent implementation
boundary and retaining its context is useful.

## 3. Exploration is conditional

Use `terra_explorer` when the primary genuinely needs repository, execution-path, ownership,
contract, configuration, or test discovery.

Skip a fresh explorer pass when the approved plan already contains a current and sufficiently exact
map of the relevant files, contracts, tests, and commands.

If implementation reveals meaningful drift from the plan, introduce exploration at that point.

Do not duplicate a delegated explorer's broad trace in the primary context. Verify only the specific
high-risk or ambiguous facts needed for integration.

## 4. Implementation routing

Choose the implementation role based on the judgment and semantic coupling the complete deliverable
requires. Reduce avoidable context and workflow duplication before lowering the default
implementation reasoning effort.

Prefer `luna_implementer` at xhigh for a well-specified, bounded, coherent implementation ownership
with explicit acceptance criteria and targeted validation. Luna high is an optional fallback only
when quota or cost constraints materially matter, or when a measured latency constraint in the
current environment justifies it; it is not the normal default. This is an asymmetric-downside choice
under current economics, not a claim that xhigh has proven causal quality superiority.

Use `terra_workhorse` at high when predetermined work requires substantial semantic coupling or
integration judgment, even if the task looks small. Typical signals include cross-process state,
concurrency, transactional or rollback behavior, several mutually dependent ownership surfaces, or
correctness that is primarily in their interactions.

Escalation is based on the decisions the task requires, not superficial file count or task size.

Do not push work into Luna when it requires architecture, security, authorization, privacy,
persistent-data integrity, concurrency, migration strategy, public-contract, or production decisions.

Do not use Terra merely because a task is large if Luna can execute the bounded deliverable safely
from explicit requirements. Conversely, do not use Luna merely because a task is small when
interaction correctness is the real risk.

### Complexity discipline during execution

Complexity must have a traceable reason. Prefer the simplest adequate design rather than the smallest diff or the fewest files.

When the project-local `$complexity-discipline` skill is available, use it when implementation or decomposition introduces non-trivial new structural complexity, especially:

- a new abstraction, dependency, configuration surface, compatibility layer, generic extension point, or custom framework/helper mechanism;
- machinery that may duplicate repository, existing-dependency, platform, or standard-library capability;
- substantial newly discovered work that was not clearly present in the approved plan;
- a decision about whether to account now for a known future constraint whose retrofit may be expensive or difficult to reverse.

For newly discovered work, require a necessity chain back to the approved goal/plan. It should normally be direct outcome work, a necessary enabler, required risk/validation control, or an evidenced constraint. If it fits none of these, leave it optional/out of scope rather than silently growing the implementation.

Do not invoke the discipline for straightforward pattern-following work whose design is already established. Do not use YAGNI as a mechanical veto: a known constraint can justify preserving a seam or invariant now even when the full future feature should remain unbuilt.

## 5. Child prompt granularity

Give workers enough information to own the deliverable, not instructions for every keystroke.

Prefer a prompt shaped like:

> Implement the approved `<ownership boundary>`. Own `<files/responsibility>`. Achieve `<required
outcomes>`. Preserve `<important contracts>`. Update focused coverage, run `<targeted validation>`,
> inspect the final diff, and stop if the work crosses into `<higher-risk boundary>`.

Avoid unnecessarily decomposing straightforward work into repeated instructions such as:

> edit one value -> run test -> edit next value -> run test -> inspect one file -> run the same test
> again

Fine-grained TDD steps remain useful in the parent-facing plan when behavior or risk warrants them.

## 6. Context economy

Minimize the cost of obtaining the next useful, evidence-backed decision while preserving
correctness. Cost includes model capability and price, active working-set size, model callbacks,
tool/probe churn, rediscovery, delegation, validation, and maintainer attention.

Prefer fresh child context for heterogeneous-model delegation (`fork_turns = "none"` when supported) when a new ownership boundary or independent perspective materially helps. Reuse an existing owner for a direct bounded continuation when it retains expensive relevant evidence. Use a delta prompt stating new intent, authorization, boundaries, and validation instead of replaying its findings.

Avoid sending children:

- unrelated plan sections;
- broad conversation history;
- repository history that is not needed for the assignment;
- duplicated exploration already available through routed source-of-truth documents.

Prefer giving a child paths to authoritative local documents over pasting large copies of those
documents into its task prompt when the runtime can read them directly.

Batch related independent searches and reads when practical. Use bounded reads sized to the evidence
needed, and avoid a read -> truncation -> reread loop. Before another probe, identify the unresolved
decision or evidence gap its result can change. Stop investigating when the available evidence is
sufficient for the current decision.

After delegating a coherent ownership boundary, let the child own its local tool, edit, and test loop.
The primary should review returned evidence and changed artifacts in proportion to residual risk
rather than shadowing each child callback. A worker's completion claim and summary are evidence, not
acceptance.

Optimize primarily by reducing unnecessary context loading, repeated exploration, duplicate
validation, and tool-turn churn before reducing model capability.

Do not spawn agents merely because roles are available. Every child has a non-trivial context
bootstrap cost.

## 7. Role routing integrity

Select the actual registered custom role through the runtime's agent-role selector. A task name or
natural-language label is not evidence that the role was selected.

Never silently substitute another model or a generic/default child when a requested custom role
cannot be selected.

If named-role routing fails, either perform the work in the primary agent or report the routing
failure.

When runtime metadata is available, use it to verify role, model, reasoning effort, and parent-child
linkage before claiming that a configured role actually ran.

## 8. Review routing

These rules govern warranted delegated implementation and independent review. Direct execution retains its exemption; the existence of a diff alone does not require a reviewer. Model defaults live in `WORKFLOW_MODES.md`; primary responsibilities apply regardless of the selected model.

When a Terra review is already justified and the actual diff added meaningful structural machinery, include a proportional complexity check: ask whether any new abstraction, dependency, configuration mechanism, duplicated capability, or generalized extension point lacks a concrete necessity chain. Do not create a dedicated complexity reviewer by default.

Use `terra_reviewer` for a coherent ordinary implementation batch with meaningful correctness,
integration, regression, failure-handling, or testing risk.

A dedicated ordinary Terra review may be skipped for a small, bounded, non-exceptional-risk child
only when its focused and repository-level validation appropriate to the boundary are green, there is
no concrete independent risk, an independently justified final whole-branch Terra review is already
planned and will cover that boundary before final integration or release, and skipping avoids
meaningful duplicate review/context cost. This permits review deduplication; it does not permit
avoiding review generally. Retain the dedicated review when the boundary itself is substantial or
independently risky.

Use `sol_reviewer` only when the actual implementation contains a concrete exceptional-risk surface
such as:

- security or authorization;
- privacy;
- persistent-data integrity;
- destructive filesystem or data operations;
- migrations;
- concurrency;
- retry or idempotency;
- comparable high-consequence behavior.

A plan may identify an expected exceptional-risk candidate, but final review routing follows the
actual diff.

Route Sol only the exceptional-risk surface that requires it when a narrower review is sufficient.

When Terra and Sol reviews are both useful, prefer sibling review assignments from the primary
rather than making one reviewer merely review the other's conclusions. The primary owns synthesis
and resolution.

When the repository-wide automated gate is proportionate, prefer running it before an expensive
exceptional-risk review. A high-capability reviewer should spend its context on semantic risk, not on
stale integration expectations that the normal suite can report cheaply.

For substantial changes spanning several ownership boundaries, one coherent final whole-branch
`terra_reviewer` pass is often useful when cross-boundary regressions are plausible. This is not
permission for repeated broad review ceremony: keep task-local reviews scoped, use one final
integration review, and add another broad review only for a concrete unresolved reason.

For concurrent mutable state, review and tests should consider both operation orderings when either
interleaving can change correctness. Proving one direction does not establish mutual exclusion or
idempotency in the reverse direction.

Re-review fixes with the reviewer that found them when practical. Use sibling or fresh reviewers for
genuinely independent scopes, including independent Terra and Sol surfaces or a separately scoped
final integration review.

## 9. Final integration

Delegated workers do not own final completion.

After delegated implementation returns, the primary agent:

1. checks the integrated diff against the approved implementation plan for plan-backed execution, or
   against the approved Goal Contract/outcome requirements and current implementation strategy for
   goal-backed orchestration;
2. verifies ownership boundaries were respected;
3. resolves or routes review findings;
4. runs the repository-level validation selected by [`.codex/PROJECT.md`](PROJECT.md) and the ESL
   validation SSOT;
5. performs environment or manual validation required by the approved implementation plan for
   plan-backed execution, or by the Goal Contract/outcome requirements and current implementation
   strategy for goal-backed orchestration;
6. reports actual commands, outcomes, remaining gaps, and unperformed environment-owned checks.

For goal-backed orchestration, the outcome audit in section 0 remains authoritative for completion;
this section does not replace it with task-list exhaustion.

Delegated validation is evidence, not a substitute for primary integration responsibility.

Run validation appropriate to the change and complete required repository gates. Broaden or repeat
validation when relevant code, configuration, or environment state changed; a failure needs diagnosis;
unresolved concerns remain; or integration/final confidence requires it. Do not run broad formatting,
test, or check passes as ritual for narrow work when repository policy does not require them. Reuse
still-fresh evidence when its relevant inputs have not changed.

Do not turn a manual validation requirement into an unsafe experiment. If a destructive or upgrade
smoke check would touch real user data or a real installation and no disposable environment is
available, report that check as manual/environment-owned rather than improvising against the real
target.

## 10. Measurement and tuning

Periodically inspect rollout metadata for:

- model response/callback count;
- active input/context trajectory;
- cached and uncached input;
- output and reasoning tokens;
- context rollover, compaction, and historical retrieval when observable;
- actual role, model, and reasoning effort selected;
- parent-child linkage and overlapping activity;
- duration;
- quota snapshots;
- unnecessary tool-turn choreography.

If a root Codex thread contains several user tasks, scope measurement to the root turn being
evaluated. Root-session token counters are cumulative across turns, so later-turn metrics must
subtract the token snapshot immediately before the selected `task_started` event; descendant
sessions should be attributed to the turn in which they were spawned.

Use measurements to tune assignment granularity, exploration frequency, review routing, and role
choice.

Quota telemetry is account-level. Do not naively attribute overlapping thread quota deltas to one
parent or child. Logged tokens, API pricing, published credit weights, and ChatGPT/Codex allowance
are related measurement lenses, not interchangeable units or formulas.

Do not encode fixed token quotas, arbitrary model-call limits, or runtime-specific token thresholds
as durable repository policy.

Do not optimize a numeric metric at the expense of correctness. A costly exceptional-risk review
that finds a real high-consequence defect has earned its cost.
