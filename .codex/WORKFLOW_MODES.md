# Workflow Modes

## Purpose

Choose the control loop before choosing agents.

The workflow has three useful modes. Do not force a bounded question into a multi-agent plan, and do not run a large known implementation as a sequence of disconnected one-off probes.

| Mode                     | Use when                                                                                                                                                                      | Default control loop                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Atomic task**          | One bounded question, investigation, edit, or report can produce a useful result.                                                                                             | One prompt -> one result. Use the lightest capable model/thread.                               |
| **Exploratory campaign** | Several related questions sit under one umbrella, but each answer determines what is worth asking or changing next.                                                           | Maintainer + ChatGPT steer; Codex threads are bounded probes or implementers.                  |
| **Goal execution**       | The desired outcome and acceptance boundary are stable enough, and reaching them requires several dependent implementation steps. The path may be known or expected to adapt. | Approved design/plan -> Sol-medium primary orchestrator -> smallest useful delegated role set. |

`ORCHESTRATION.md` and `PLANNING_HANDOFF.md` primarily govern **Goal execution**. Atomic tasks and exploratory campaigns should not manufacture an implementation plan or primary orchestrator merely to conform to that workflow.

## Model and environment selection

Model selection is a revisable operating default, not an ownership or authorization rule.
Keep ChatGPT Sol High as the default discussion and planning environment when it fits the
maintainer's access and quota. Keep Codex Sol Medium as the initial ordinary coordination
default and retain the registered Luna/Terra implementation and Terra/Sol review roles.

Use Codex Astra selectively for difficult repository-grounded decisions, contradictory evidence,
elusive bugs, or consequential design questions that need repeated local inspection. Start with
Low for bounded assessments; try Medium for difficult interacting-component investigations.
These are trial defaults, not measured rankings or guarantees about Plus quota. Increase effort
when the reasoning problem warrants it. Do not require a cheaper failed attempt before choosing
Astra for an already clearly difficult problem, or add a mandatory Astra review layer.

Once the difficult uncertainty is resolved, normally hand routine implementation and tool execution
to cheaper roles. This is a default, not an invariant: Astra may remain the root orchestrator while
continued Astra-level judgment, newly changing evidence, or preservation of expensive decision state
materially warrants its active-context carrying cost.

Let planning happen where the evidence is. A bounded Codex investigation may develop an
evidence-backed recommendation; return to ChatGPT when discussion benefits from it, without
requiring a round trip for routine execution. The human retains approval of material design
and scope decisions. Suggest manual commands when quick and convenient for the maintainer;
use Codex when gathering and interpreting evidence forms a coherent investigation.

Evaluate naturally occurring tasks by uncertainty resolved, rework avoided, and maintainer
intervention. Quota observations are useful but token counts and API prices are not exact
Plus-usage conversions. Do not manufacture work for benchmarking or change registered roles
merely to try Astra as the primary.

## 1. Select the mode from uncertainty, not task size

Use **Atomic task** when the next useful result is already clear and bounded.

Use **Exploratory campaign** when the umbrella is clear but a truthful task list cannot be written yet because the next question depends on current evidence. Typical examples include maintenance triage, toolchain simplification, repository archaeology, migration feasibility, and deciding whether suspicious architecture should change at all.

### Atomic implementation discipline

Atomic work does not imply strict red-green TDD. Choose the cheapest reliable feedback loop for the
actual risk and uncertainty.

- Prefer test-first work for reproducible bug fixes and durable behavior changes where a regression
  would be costly or subtle, especially contracts, state transitions, persistence, concurrency,
  authentication/authorization, money, data integrity, or edge-case-heavy business logic.
- For small standalone tools or scripts, exploratory utilities, spikes/prototypes, one-off automation,
  or code whose useful shape is still being discovered, prefer a smallest working vertical slice
  against real inputs first. Validate observable behavior, then add focused regression tests around
  stable or expensive-to-break logic before treating it as durable.
- Documentation, configuration, mechanical edits, existing sufficient regression coverage, deterministic
  fixture/output checks, compilation, linting, or another cheaper direct oracle may provide the
  proportionate evidence for a bounded change.
- Do not invoke strict TDD solely because code is being written or a generic TDD skill is available.
  Repository policy, task risk, and the lowest-cost reliable evidence path control the discipline.

Use **Goal execution** when the desired outcome and acceptance boundary are stable enough that implementation can be decomposed without repeatedly reopening what success means. The full future implementation path does not need to be known when the path is expected to adapt under a stable outcome. If the desired outcome or whether to pursue it is still unresolved, remain in **Exploratory campaign**.

### Goal execution variants

Goal execution has two variants; it is still one top-level workflow mode.

**Plan-backed execution** remains the normal default. Use it when the desired change is contained, the implementation path is sufficiently known, and an approved implementation plan is a good scope and acceptance contract. Durable goal state would add more ceremony than information.

```text
approved design + implementation plan
        -> Sol-medium primary
        -> coherent implementation/review boundaries
        -> final integration and validation
```

**Goal-backed orchestration** is optional and requires explicit user selection or approval. Use it when the outcome is already stable and verifiable, but the execution strategy is expected to change materially as repository evidence emerges; several dependent ownership boundaries or root turns may be needed; durable outcome state across a long-lived primary agent is useful; and outcome-level completion is distinct from exhausting the current task list.

```text
approved Goal Contract + known decisions + current plan/evidence
        -> goal-backed Sol-medium primary
        -> adaptive plans, tasks, and coherent children
        -> periodic outcome audits
        -> final outcome evidence and goal completion
```

Goal-backed orchestration is not a reason to promote a fuzzy umbrella prematurely, and ordinary bounded or merely multi-step work should not create a durable goal. The goal is the stable completion boundary; the plan and current task routing remain revisable strategy under it. See `PLANNING_HANDOFF.md` and `ORCHESTRATION.md` for the handoff and execution rules.

A three-line change can require expensive exploration. A large implementation can become mechanical once uncertainty is removed. Route by **discovery cost and semantic coupling**, not expected diff size.

## 2. Change modes when the problem changes

Modes are not sticky.

Promote an exploratory campaign to Goal execution when:

- a concrete desired outcome and acceptance boundary have emerged;
- several dependent edits now need coordinated implementation;
- integration, sequencing, or shared contracts have become the main risk;
- preserving one approved plan, or one approved durable outcome with an adaptive strategy, is cheaper than continued human-by-human steering.

Do not keep probing after the work has crystallized. Stop, capture the approved behavior and acceptance boundary, choose the appropriate Goal-execution variant, and launch it. Perfect knowledge of every future implementation step is not required for goal-backed execution, but fuzzy WHAT/WHETHER questions still belong in Exploratory campaign.

Conversely, do not preserve orchestration ceremony when a remaining task has collapsed into one independent bounded action.

## 3. Exploratory campaigns use ChatGPT as the controller/notebook

In an exploratory campaign, the stable control plane is normally the maintainer + ChatGPT conversation. A bounded local investigation may own successive evidence-dependent probes and recommendations when this avoids repeated manual handoffs; the maintainer still controls priorities and material decisions.

Use it to retain:

- the umbrella goal;
- what has already been investigated;
- decisions and rejected alternatives;
- deferred items and reconsideration triggers;
- branch/commit state;
- which Codex threads hold useful active context or recoverable historical evidence;
- the next question worth spending effort on.

Codex tasks in this mode are normally **one prompt, one result**. They may investigate or implement a bounded consequence, but they do not need a Sol primary orchestrator simply because several probes belong to the same maintenance umbrella.

The maintainer is part of the scheduler, not merely an authorization gate. Human judgment about whether two changes belong in one PR, whether a context is still hot, or whether another probe is worth its cost is valid routing evidence.

## 4. Choose context from working-set economics

Distinguish the active working context that the model must carry through the next response from
historical evidence that remains recoverable without staying continuously active. Depending on
runtime support and the task, choose among:

- continuing the active context;
- reducing or rolling over the active working set while preserving recoverable history; or
- starting a fresh independent context.

Choose from active-context carrying cost, rediscovery cost, historical recoverability, the value of
independence, and model cost. Do not encode token or context-size crossover thresholds as policy.

Continue an existing active context when:

- it already owns the evidence needed for the next step;
- the next step is a direct, bounded consequence of its finding;
- scope and authorization are clear;
- rediscovery would dominate the work.

Examples: an investigator implements its own tiny cleanup recommendation; a repository-debris auditor removes only the approved artifacts it already proved obsolete; a context-holding worker composes the final PR summary.

Prefer a fresh independent context when:

- the problem changes domain or ownership boundary;
- independent skepticism is materially valuable;
- the current context is stale, confused, or overloaded;
- a different model capability is actually needed.

Use rollover or active-working-set reduction when the current decision state remains valuable but
carrying the whole active context no longer does. Reuse context for execution; buy fresh context for
skepticism only when skepticism is worth buying.

### Continuation prompts are deltas

A fresh thread needs a self-contained assignment.

An active continuation usually needs only:

- the decision/authorization that changed;
- the exact next deliverable;
- any narrowed scope or non-goals;
- required validation or commit boundary.

Do not replay the agent's own investigation back to it as a long contract.

## 5. Investigation is allowed to conclude KEEP or DEFER

An investigation is successful when it reduces uncertainty, not when it produces a diff.

Useful outcomes are:

- **KEEP**: current behavior/tooling remains the best fit;
- **CHANGE**: a bounded improvement is justified;
- **DEFER**: a direction may be valid, but current evidence, value, or risk does not justify implementation now.

A good exploratory report should provide enough decision information to choose the next move:

- finding and confidence;
- current evidence;
- cost/benefit;
- remaining uncertainty;
- recommendation;
- plausible next action;
- reason not to act.

Counterintuitive or expensive KEEP/DEFER decisions should be preserved in lightweight repository documentation when they are likely to recur. Record the reason and concrete triggers for reconsideration rather than archiving the whole investigation.

## 6. Verify time-sensitive premises before hard-coding them

When the task depends on `latest`, `current stable`, a current runtime, or another moving external fact, verify that premise from an authoritative current source before writing the implementation prompt.

Prefer prompts such as "upgrade to the current stable release; verify the target first" over hard-coded remembered versions when publication state can change between planning and execution.

## 7. Review follows residual semantic risk

A completed diff does not automatically deserve a reviewer.

Review is valuable when unresolved semantic risk remains: cross-component interaction, failure handling, security/auth, privacy, persistent-data integrity, migrations, concurrency, retry/idempotency, destructive operations, or similarly consequential behavior.

Strong focused tests, explicit before/after behavior, mechanically constrained edits, and repository-level validation can make a dedicated review low-value for a bounded change.

The same investigator may implement its own low-risk recommendation. If independent challenge matters, obtain it at review time rather than forcing a fresh implementer solely to manufacture independence.

Before final integration, also consider **cumulative branch risk**. Several individually safe commits can collectively cross enough ownership boundaries that one whole-branch review becomes useful. File count alone is not the criterion.

## 8. Commit boundaries are cheaper than PR boundaries

Use separate commits when work has a distinct rationale, rollback unit, or review story.

Use separate PRs when risk, review requirements, release/deployment sequencing, merge independence, or reviewability materially differ.

Do not pay branch -> PR -> CI -> merge -> resync overhead for every small coherent cleanup merely because it deserves its own commit.

## 9. Treat flaky broad-gate evidence honestly

When a broad gate hits a known timing-sensitive/interference failure:

1. record the actual broad failure;
2. isolate the failing test or narrow boundary once;
3. if the isolated result and surrounding evidence support the known-flake classification, report that evidence;
4. do not repeatedly rerun the broad suite only to obtain a green summary.

If the isolated test also fails, or the changed area plausibly caused the failure, investigate normally.

## 10. Exploratory campaigns need a stopping rule

Do not ask "have we inspected everything?" Ask whether the **expected value of the next probe is still clearly positive**.

Before another round, identify:

- what signal suggests something useful remains;
- what class of improvement the probe is looking for;
- what result would make the campaign stop.

An optional final closure sweep can be useful when there is a concrete signal, such as obvious repository/tooling residue. It should remain bounded rather than becoming permanent archaeology.

### Repository-debris audit pattern

For a read-only junk/residue sweep, classify candidates as:

- **SAFE TO DELETE**: strong evidence of no current consumer;
- **PROBABLY DELETE, VERIFY ONE THING**: one explicit uncertainty remains;
- **SUSPICIOUS BUT KEEP**: looks stale but still has a purpose or meaningful deletion risk;
- **NOT JUNK / FALSE POSITIVE**: tempting artifact that is clearly intentional.

For each deletion candidate, establish origin/owner, current callers or references, behavioral effect of deletion, and confidence. "No grep result" alone is not enough for manual operational artifacts.

## 11. Keep the modes asymmetric

Superpowers-style design, implementation planning, and a Sol primary orchestrator are powerful when a substantial **Goal execution** problem needs them. Plan-backed execution is the default; goal-backed orchestration pays for its extra durable state only when adaptive, long-lived execution and outcome-level completion evidence justify it. Both are overhead when the work is atomic or when an exploratory campaign has not yet discovered what should be implemented.

The lightest safe workflow wins:

```text
bounded result known      -> Atomic task
next question depends on evidence -> Exploratory campaign
stable outcome + dependent implementation -> Goal execution
```

Do not turn a useful method into ceremony by applying it outside the problem shape it was designed for.
