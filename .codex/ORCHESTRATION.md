# Codex Orchestration Standard

## Purpose

This document defines how an approved implementation plan, when applicable, is translated into
delegated Codex work. Direct execution and targeted discipline remain available under root
[`AGENTS.md`](../AGENTS.md); delegation is not automatic.

The task authorization and approved plan remain the scope and acceptance contract. This document
controls delegation granularity, role routing, context economy, review routing, and primary-agent
integration. [`.codex/PROJECT.md`](PROJECT.md) adapts these mechanics to ESL Pipeline, while
[`docs/reference/agents-ssot.md`](../docs/reference/agents-ssot.md) remains the product/runtime SSOT.

The intended delegated workflow is:

```text
approved task or plan
        -> Codex primary
        -> smallest useful set of fresh registered-role children
        -> primary integration + ESL repository validation
```

The primary agent always owns decomposition, integration, repository accountability,
repository-level validation, authorized Git mutations, and the final result.

## 1. Parent plan versus child assignment

Detailed implementation plans are written for the primary agent. They may contain fine-grained TDD,
edit, validation, sequencing, and commit steps.

Do not mechanically copy every fine-grained plan step into a delegated child's prompt.

A child assignment should normally contain:

- the coherent ownership boundary;
- exact files or responsibility when known;
- required outcomes;
- acceptance criteria;
- targeted validation;
- explicit stop or escalation conditions;
- mutation and commit authorization when applicable.

The primary retains the full plan checklist and verifies that all requirements were satisfied after
delegated work returns.

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

Prefer fresh child context for heterogeneous-model delegation (`fork_turns = "none"` when supported).

Avoid sending children:

- unrelated plan sections;
- broad conversation history;
- repository history that is not needed for the assignment;
- duplicated exploration already available through routed source-of-truth documents.

Prefer giving a child paths to authoritative local documents over pasting large copies of those
documents into its task prompt when the runtime can read them directly.

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

1. checks the integrated diff against the full approved task or plan;
2. verifies ownership boundaries were respected;
3. resolves or routes review findings;
4. runs the repository-level validation selected by [`.codex/PROJECT.md`](PROJECT.md) and the ESL
   validation SSOT;
5. performs environment or manual validation required by the plan;
6. reports actual commands, outcomes, remaining gaps, and unperformed environment-owned checks.

Delegated validation is evidence, not a substitute for primary integration responsibility.

Do not turn a manual validation requirement into an unsafe experiment. If a destructive or upgrade
smoke check would touch real user data or a real installation and no disposable environment is
available, report that check as manual/environment-owned rather than improvising against the real
target.

## 10. Measurement and tuning

Periodically inspect rollout metadata for:

- actual role and model selected;
- reasoning effort;
- child-parent linkage;
- token-event count;
- cached and uncached input;
- output and reasoning tokens;
- duration;
- repeated context loading;
- unnecessary tool-turn choreography.

If a root Codex thread contains several user tasks, scope measurement to the root turn being
evaluated. Root-session token counters are cumulative across turns, so later-turn metrics must
subtract the token snapshot immediately before the selected `task_started` event; descendant
sessions should be attributed to the turn in which they were spawned.

Use measurements to tune assignment granularity, exploration frequency, review routing, and role
choice.

Do not encode fixed token quotas, arbitrary model-call limits, or runtime-specific token thresholds
as durable repository policy.

Do not optimize a numeric metric at the expense of correctness. A costly exceptional-risk review
that finds a real high-consequence defect has earned its cost.
