# Codex Orchestration Standard

## Purpose

This document defines how approved Goal execution work is translated into coordinated Codex execution.

Use `WORKFLOW_MODES.md` to decide whether Goal execution is appropriate. Atomic tasks and exploratory campaigns should not manufacture orchestration merely because agents are available.

For plan-backed execution, the approved implementation plan is the scope and acceptance contract. For explicitly approved goal-backed orchestration, the Goal Contract is the durable completion contract and the current implementation plan is revisable strategy beneath it.

This document owns delegation boundaries, role routing, context economy, evidence sufficiency and closure, review routing, and primary-agent integration. Repository-specific validation, contracts, mutation policy, and operational procedure belong to the target repository and its adapter.

The primary agent owns decomposition, integration, validation decisions, and the final result. It
remains accountable for repository state and authorized mutations performed by workers.

## 1. Goal-backed execution

Plan-backed execution remains the normal Goal-execution default.

Use goal-backed orchestration only when it is explicitly approved and the outcome is already stable and verifiable while the implementation strategy is expected to adapt materially from repository evidence.

Do not infer goal-backed mode merely because work is large, difficult, long-running, multi-step, or delegated.

The primary owns one durable root outcome for the run. When runtime goal tracking is available:

- reuse a matching unfinished root goal rather than creating a duplicate;
- create goal state only for the explicitly approved outcome;
- do not silently replace or redefine an unfinished goal;
- treat material changes to the desired outcome as escalation;
- do not let children create durable subgoals for their assignments.

Runtime goal tooling and status APIs may change. Preserve these semantics without hard-coding transient tool names or lifecycle implementation details into portable policy.

The persisted runtime objective is only a concise representation of the richer approved Goal Contract.

Before claiming goal completion, map the required outcome and acceptance criteria to actual evidence and account for required repository, hosted, manual, or environment-owned evidence. Task-list exhaustion is not outcome completion.

Goal-backed execution grants no additional architecture, mutation, deployment, review, or other authority.

## 2. Primary plan and child assignments

Detailed plans are for the primary agent. Do not mechanically copy the complete parent plan into each child prompt.

Delegate by coherent ownership boundary or responsibility rather than by numbered checklist item.

A child assignment should normally provide:

- the owned boundary or responsibility;
- required outcomes and acceptance criteria;
- important task-specific invariants;
- relevant files or surfaces when useful;
- targeted validation expected from that child;
- stop or escalation conditions;
- task scope and any consequential mutation boundary the child needs to know.

Adjacent plan items may share one worker when they materially share subsystem, files, contracts, and implementation context.

Do not combine unrelated work merely to reduce child count, and do not spawn a new child when an existing owner still has the relevant context and remains the right owner.

Delegation does not transfer the primary's integration or completion responsibility.

## 3. Exploration is conditional

Use an explorer only when discovery is genuinely needed to resolve repository structure, ownership, execution paths, contracts, configuration, tests, or implementation uncertainty.

Skip redundant exploration when current evidence already provides a sufficiently reliable map.

If implementation exposes meaningful drift or uncertainty, introduce focused exploration then.

Do not make the primary repeat a broad delegated trace merely to verify that it occurred. Verify specific ambiguous or high-risk facts when they matter to integration.

Exploration may validly conclude that no implementation change is justified.

## 4. Implementation routing

Route implementation according to the judgment and semantic coupling required by the complete deliverable, not superficial task or diff size.

Use the registered bounded implementer for well-specified, coherent, pattern-following work with explicit acceptance criteria.

Use the registered integration/workhorse role when implementation requires substantial interaction judgment across coupled state, contracts, processes, transactional behavior, rollback, concurrency, or other mutually dependent surfaces.

Do not push work into a bounded implementer when it requires new architecture, security, authorization, privacy, persistent-data integrity, migration strategy, public-contract, concurrency, or production decisions beyond that role's authority.

Conversely, do not use a more expensive integration role merely because a task contains many files when the complete ownership boundary is mechanically specified.

Use the registered explorer for discovery, not as a mandatory prelude to implementation.

Current model and effort defaults belong in `WORKFLOW_MODES.md` and registered role configuration. The configured effort is a launch default; choose a supported different effort when the assigned uncertainty and consequence warrant it, without treating a role name as a model constraint.

### Complexity discipline

When implementation or decomposition introduces non-trivial structural complexity, use the installed `$complexity-discipline` skill when available.

Typical triggers include a new abstraction, dependency, configuration surface, compatibility mechanism, generalized extension point, duplicated platform capability, substantial newly discovered work, or a difficult-to-reverse future-constraint decision.

Do not invoke the skill for straightforward pattern-following work whose design is already established.

The skill may justify the proposed complexity as-is. Its purpose is disciplined judgment, not automatic simplification.

Newly discovered work must remain traceable to the approved outcome, a necessary enabler, required risk/control work, or an evidenced constraint. Otherwise leave it out of scope or escalate rather than silently expanding the implementation.

## 5. Child prompt granularity

Give workers enough information to own their deliverable without scripting every keystroke.

State outcomes, boundaries, relevant invariants, acceptance criteria, validation, and stop conditions. Let the worker discover ordinary repository mechanics from the active instruction chain and authoritative local sources.

An authorized worker may complete ordinary local repository operations reasonably needed for its
assigned outcome within repository and task restrictions; the parent need not enumerate each step.

Do not turn a simple implementation into repeated micro-instructions such as edit one value, run one check, edit another value, rerun the same check.

Fine-grained sequencing remains appropriate when that sequence itself protects correctness.

For a fresh ownership context, provide a self-contained assignment.

For a continuing owner, send a delta: what changed, the exact next deliverable, new authorization or scope, and external decisions or evidence that context has not seen. Do not replay its own investigation back to it.

## 6. Context economy

Optimize for the next useful evidence-backed decision.

Consider:

- rediscovery cost;
- active-context carrying cost;
- value of independence;
- model capability;
- delegation/bootstrap cost;
- tool and validation churn;
- maintainer attention.

Apply the context-selection guidance in [WORKFLOW_MODES.md §4](WORKFLOW_MODES.md#4-context-economics), including reassessment at materially different execution phases.

Reuse an active owner when it already holds expensive relevant evidence and the next step is a direct continuation.

Prefer references to authoritative repository sources over pasting large copies into child prompts when those sources are directly readable.

Do not send unrelated plan sections, broad conversation history, or repository history that does not affect the assignment.

After delegation, let the worker own its coherent local inspect/edit/test loop. The primary reviews returned evidence and artifacts in proportion to residual risk rather than shadowing every callback.

A worker's completion claim is evidence, not automatic acceptance.

Do not spawn agents merely because registered roles exist.

### Decision-bounded evidence and closure

Across workflow modes, before another probe, identify the concrete unresolved decision, acceptance criterion, failed invariant, or material anomaly its result can resolve. Additional confidence alone is insufficient justification. Stop when evidence is sufficient for that branch; reopen it only when new evidence changes its basis.

Reuse still-valid evidence while its relevant inputs and semantics remain unchanged. Later unrelated execution does not automatically invalidate earlier evidence. Refresh evidence whose validity depends on changed state or time, and follow required repository gates.

Safety, fidelity, rollback, and exact-evidence requirements define what must be established; they do not create an open-ended obligation to strengthen proof after the applicable criteria are satisfied. Preserve the rigor actually required by the completion contract.

Investigate unexpected anomalies in proportion to their possible effect on the decision. An explained benign delta may still warrant direct corroboration; exhaustive forensic reconstruction requires a plausible alternative explanation that could materially change the decision. Close the branch once sufficient evidence resolves it.

Once the completion contract is satisfied, enter closure: record and preserve existing evidence, report the result and limitations, and perform required finalization and cleanup. Treat satisfaction of the required acceptance criteria and repository-required gates as a phase transition, not an invitation to search for further confidence. In closure, do not start new repository-wide searches, adjacent-consumer or provider traces, compatibility audits, repeated validation passes, or other probes unless a newly failed invariant, unexplained material anomaly, or genuinely missing completion criterion gives that work a concrete decision to resolve.

A schema, domain-field, or compatibility change does not by itself justify tracing every downstream consumer or provider after the affected contract and identified material consumers are validated. Broaden that trace only when code evidence, a failed check, or a known dependency makes the adjacent surface material to completion.

## 7. Role routing integrity

Use the actual registered role when a specific project role is selected.

A task name or natural-language label is not evidence that the configured role ran.

Never silently substitute a generic/default child or a different registered role when the selected route cannot be used.

If role routing fails, either keep the work in the primary when appropriate or report the routing failure.

When reliable runtime metadata is available, use it before making claims about which role, model, effort, or parent-child route actually executed.

## 8. Review routing

Review follows residual semantic risk, not the existence of a diff, delegation, file count, or completion ceremony.

First decide whether review is warranted and whether it needs independent skepticism. Meaningful correctness, integration, regression, failure-handling, or testing risk can justify review, but non-zero residual risk does not by itself require spawning a reviewer child.

When independent ordinary review is warranted, route it to the registered ordinary reviewer.

Explicit current task ownership remains controlling. If the primary is asked to perform the review itself, keep that review with the primary unless independent review is explicitly requested by the maintainer or required by repository or task policy.

When independent review is warranted for a concrete high-consequence surface such as security or authorization, privacy, persistent-data integrity, destructive operations, migrations, concurrency, retry/idempotency, or a comparable risk, route that surface to the registered exceptional-risk reviewer.

Route exceptional review to the narrow risk surface when that is sufficient.

A plan may identify possible review risks, but final routing follows the actual implementation and remaining uncertainty.

A dedicated review may be unnecessary for a genuinely bounded, mechanically constrained change with strong focused evidence and no concrete independent semantic risk.

Do not create a fresh implementer merely to manufacture independence. Buy independent skepticism at review time when it is useful.

When an ordinary local review would duplicate an independently justified later integration review covering the same small validated boundary, it may be omitted if no separate unresolved risk justifies it.

For substantial work spanning several ownership boundaries, one coherent final integration review can be useful when cumulative cross-boundary regressions are plausible. Do not make whole-branch review universal.

When ordinary and exceptional reviewers are both useful, prefer independent sibling scopes owned and synthesized by the primary rather than reviewer chains that merely review one another.

When a review is already warranted and the diff adds meaningful structural machinery, include a proportional complexity check rather than creating a dedicated complexity reviewer by default.

For concurrent mutable state, review the operation orderings that can materially change correctness rather than proving only one convenient interleaving.

## 9. Final integration

Delegated workers do not own final completion.

Before final handoff, the primary:

1. checks the integrated state against the approved implementation plan or Goal Contract;
2. confirms ownership and scope boundaries were respected;
3. resolves or explicitly accounts for review findings;
4. selects and evaluates validation required by current repository policy and the actual change;
5. accounts for required hosted, manual, production, or environment-owned evidence;
6. reports actual evidence, unresolved gaps, and intentionally unperformed actions.

Delegated validation is evidence, not a substitute for primary integration judgment.

Do not broaden or repeat validation merely because delegation occurred. Apply [decision-bounded evidence and closure](#decision-bounded-evidence-and-closure) when composing validation evidence and finalizing the result.

Do not turn a manual or environment-owned check into an unsafe experiment against real data or production merely to close a checklist item.

For goal-backed execution, completion requires outcome-level evidence rather than an empty task list.

## 10. Workflow evolution

Measurement and experimentation with models, context behavior, callback counts, token usage, quotas, role economics, and adoption quality belong in workflow adoption/evidence tooling rather than every execution contract.

Use naturally occurring runs to improve routing and assignment granularity. Do not manufacture repository work solely to benchmark the orchestration system.

Do not encode fixed token thresholds, quota formulas, transient runtime APIs, or model-economics assumptions as permanent orchestration invariants.

When workflow evidence justifies a policy change, update the canonical portable owner and reconcile installed repository adaptations deliberately.
