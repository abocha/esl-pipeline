# Workflow Modes

## Purpose

Choose the control loop before choosing agents.

Use the lightest mode that can produce the next useful evidence-backed result.

| Mode                     | Use when                                                                                                                          | Default control loop                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Atomic task**          | One bounded question, investigation, edit, or report can produce the useful result.                                               | One coherent task -> one result.                                                                       |
| **Exploratory campaign** | Several related questions share an umbrella, but each result determines what is worth investigating or changing next.             | Maintainer + ChatGPT steer; Codex owns bounded probes or consequences.                                 |
| **Goal execution**       | The desired outcome and acceptance boundary are stable enough, and several dependent implementation boundaries need coordination. | Approved handoff -> primary orchestration -> coherent implementation/review boundaries -> integration. |

`PLANNING_HANDOFF.md` and `ORCHESTRATION.md` primarily govern Goal execution.

Do not manufacture a plan, durable goal, primary orchestrator, delegation, or review simply because the workflow supports them.

## Model and environment selection

Model selection is a revisable operating default, not an ownership or authorization rule.

Use GPT-6.1 Sol as the ordinary capable model for discussion and planning when it fits the maintainer's access and quota. Select reasoning effort for the uncertainty and consequence of the decision.

Use GPT-6.1 Sol for ordinary Codex coordination and repository or integration judgment. Start with medium effort for a typical coherent task; use low for clear, bounded coordination, and high or higher for tangled evidence, coupled contracts, or consequential decisions. Reassess effort as the work changes rather than fixing one level for the entire run.

The registered `bounded_implementer` uses GPT-6 Luna at xhigh effort for specified, pattern-following work. Its effort may be adjusted when the bounded task warrants it; route work that needs repository or integration judgment to Sol. The explorer, integration workhorse, and reviewers use Sol at efforts suited to their assigned risk. The role configuration holds portable launch defaults; target repositories may deliberately adapt them.

Use Codex GPT-6 Astra selectively for difficult repository-grounded decisions, contradictory evidence, elusive bugs, or consequential design questions requiring repeated local inspection.

Choose Astra effort proportionately: low or medium may fit a contained difficult assessment, while interacting-component investigations or consequential design decisions may warrant high or higher. These are operating defaults, not measured rankings or quota guarantees. Do not require a cheaper failed attempt before using Astra on an already clearly difficult problem, and do not create a mandatory Astra review layer.

Once difficult uncertainty is resolved, routine implementation and tool execution can normally move to Sol or the bounded Luna role. Keep Astra active when continued high-level judgment, changing evidence, or preservation of expensive decision state materially justifies that context.

Planning may happen where the evidence is. Return to ChatGPT when discussion, synthesis, prioritization, or approval benefits from it. Routine execution needs no mandatory round trip.

Use manual commands when they are genuinely the cheapest path for the maintainer. Use Codex when evidence gathering and interpretation form a coherent repository investigation.

Do not infer Plus/Codex quota from API pricing or logged token counts, and do not manufacture repository work for model benchmarking.

## 1. Select from uncertainty, not task size

### Atomic task

Use Atomic task when the next useful result is already clear and bounded.

A small diff can require expensive reasoning, while a large mechanical change can be straightforward once uncertainty is removed. Route by discovery cost, semantic coupling, and consequence rather than expected file count or diff size.

Atomic work does not require strict red-green TDD.

Choose the cheapest reliable evidence loop for the actual risk:

- use test-first reproduction when a bug or durable behavior change has subtle or expensive regression risk;
- use a small working vertical slice first for exploratory tools, prototypes, one-off automation, or behavior whose useful shape is still being discovered;
- use deterministic fixtures, compilation, linting, existing coverage, documentation checks, or another direct oracle when they provide sufficient evidence for a bounded change.

Do not invoke strict TDD merely because code is being written or a generic skill exists. Repository policy and actual risk control validation.

### Exploratory campaign

Use Exploratory campaign when the umbrella is clear but a truthful implementation plan cannot yet be written because the next useful question depends on current evidence.

Typical examples include maintenance triage, repository archaeology, tooling simplification, migration feasibility, elusive bug investigation, or deciding whether suspicious architecture should change at all.

The result of an exploratory probe may be implementation, another investigation, KEEP, or DEFER. Exploration is not required to produce a diff.

### Goal execution

Use Goal execution when the desired outcome and acceptance boundary are stable enough that dependent implementation can proceed without repeatedly reopening WHAT success means.

If WHAT success means or WHETHER to pursue it remains unresolved, stay exploratory.

Goal execution has two variants.

**Plan-backed execution** is the default when the implementation path is sufficiently known and an approved implementation plan is a useful scope and acceptance contract.

**Goal-backed orchestration** is optional and requires explicit approval. Use it when the outcome is stable and verifiable but the implementation strategy is expected to adapt materially from repository evidence, several dependent boundaries or root turns may be needed, durable outcome state is useful, and outcome completion is meaningfully different from exhausting the current task list.

The goal defines the stable completion boundary. Plans and task routing remain revisable strategy beneath it.

See `PLANNING_HANDOFF.md` for the handoff contract and `ORCHESTRATION.md` for execution mechanics.

## 2. Change modes when the problem changes

Modes are not sticky.

Promote exploration to Goal execution when:

- a concrete desired outcome and acceptance boundary have emerged;
- dependent implementation boundaries now need coordination;
- integration or shared contracts have become the main execution risk; and
- preserving one approved completion contract is cheaper and safer than continued one-result-at-a-time steering.

Do not keep probing merely because exploration has momentum.

Conversely, when remaining work collapses into one bounded independent action, stop paying orchestration overhead and treat it atomically.

Goal-backed execution does not require perfect knowledge of every future implementation step. It does require stable WHAT and WHY.

## 3. Exploratory campaigns

The stable control plane for an exploratory campaign is normally the maintainer + ChatGPT conversation.

Use it to preserve:

- the umbrella question;
- important evidence already obtained;
- decisions and rejected alternatives;
- deferred items and reconsideration triggers;
- useful repository or branch state;
- which active contexts retain expensive relevant evidence;
- the next question worth spending effort on.

A bounded Codex investigation may own several successive evidence-dependent probes when keeping that local context is cheaper than repeated handoffs.

The maintainer remains part of the scheduler and controls material product, design, scope, and priority decisions.

### KEEP, CHANGE, and DEFER

An investigation succeeds when it reduces uncertainty.

Valid outcomes are:

- **KEEP:** current behavior or tooling remains the best fit;
- **CHANGE:** a bounded improvement is justified;
- **DEFER:** the direction may be valid, but present value, evidence, or risk does not justify implementation.

Preserve counterintuitive or expensive KEEP/DEFER rationale when it is likely to recur. Record concrete reconsideration triggers rather than archiving an entire investigation transcript.

### Stopping rule

Before another probe, identify what unresolved decision or evidence gap its result can change.

Continue while the expected value of the next probe is meaningfully positive.

Stop when available evidence is sufficient for the current decision. Do not turn exploration into permanent repository archaeology.

## 4. Context economics

Choose context from the cost of the next useful decision rather than fixed token thresholds.

Consider:

- active-context carrying cost;
- rediscovery cost;
- historical recoverability;
- value of independent skepticism;
- model capability;
- tool/delegation churn;
- maintainer attention.

Continue an active context when it already owns expensive relevant evidence and the next step is a direct bounded consequence.

Prefer fresh context when the problem moves to a different ownership boundary, meaningful independent skepticism is useful, the existing context has become stale or confused, or another model capability is genuinely needed.

When runtime support allows reducing the active working set while retaining recoverable history, use that option when the decision state remains valuable but carrying all active context does not.

Freshness is a tool, not a ritual. Reuse context for execution when rediscovery would dominate; buy fresh context when independence is worth buying.

### Continuation prompts are deltas

A fresh thread needs a self-contained assignment.

An active continuation normally needs only:

- the new decision or authorization;
- the exact next deliverable;
- changed or narrowed scope;
- new external evidence the context has not seen;
- task-specific completion or validation requirements.

Do not replay the context's own findings back to it as a long prompt.

## 5. Time-sensitive premises

When implementation depends on a moving external fact such as a current stable release, runtime, model, API, or platform capability, verify that premise from an authoritative current source before freezing it into a plan or change.

Prefer requirements such as "upgrade to the current stable release; verify the target first" when the exact version may change before execution.

Do not replace repository or external evidence with remembered version numbers.

## 6. Review follows residual risk

A completed diff does not automatically require an independent reviewer.

Review is valuable when meaningful semantic uncertainty remains, especially around interacting components, failure handling, security/authorization, privacy, persistent data, migrations, concurrency, retry/idempotency, destructive operations, or other high-consequence behavior.

Strong focused evidence and mechanically constrained implementation may make dedicated review low-value for a bounded task.

Do not create a fresh implementer merely to manufacture independence. When independent challenge is useful, obtain it at review time.

For substantial work, cumulative cross-boundary risk may justify integration review even when individual changes were each locally simple.

Detailed delegated-review routing belongs in `ORCHESTRATION.md`.

## 7. Keep the modes asymmetric

The three modes solve different problem shapes:

```text
bounded result already clear
    -> Atomic task

next useful question depends on evidence
    -> Exploratory campaign

stable outcome + dependent implementation
    -> Goal execution
```

Do not turn a useful workflow into ceremony by applying its most expensive machinery outside the problem shape it was designed for.
