# ChatGPT -> Codex Planning Handoff

## Purpose

This document defines what interactive planning should preserve when work is ready to become coordinated Codex Goal execution.

Use `WORKFLOW_MODES.md` to decide whether Goal execution is appropriate. Atomic tasks and exploratory campaigns should not manufacture implementation plans merely because several related questions exist.

This file owns the handoff contract between planning and execution. Runtime delegation, role routing, review routing, context selection, and primary-agent integration belong in `ORCHESTRATION.md`.

## 1. When a handoff is ready

Create an implementation handoff when the desired outcome is stable enough to implement, material design and scope decisions have the required human approval, acceptance can be stated in observable terms, and dependent implementation work benefits from one shared completion contract.

If WHAT success means or WHETHER to pursue it is still unresolved, continue exploration.

Carry forward the decisions and evidence needed for correct implementation, not the exploratory transcript.

## 2. Choose the Goal-execution contract

### Plan-backed execution

Plan-backed execution is the default when the desired behavior is stable and the implementation path is sufficiently known.

The approved implementation plan is the primary agent's scope and acceptance contract. It may contain known files or symbols, implementation sequence, task-specific validation requirements, checkpoints, and stop conditions where those details materially reduce execution ambiguity.

### Goal-backed orchestration

Use goal-backed orchestration only when explicitly approved.

It fits a stable and verifiable outcome whose implementation strategy is expected to adapt materially as repository evidence emerges, especially when several dependent ownership boundaries or root turns may be required and completion is meaningfully different from exhausting the current task list.

The Goal Contract owns WHAT must become true. The implementation plan and task routing remain revisable HOW beneath it.

Goal-backed execution does not authorize changes to approved product behavior, architecture, contracts, acceptance criteria, or mutation scope.

## 3. Goal Contract

A goal-backed handoff should contain a concise objective, observable completion evidence, explicit in-scope and out-of-scope boundaries, and material stop or escalation conditions.

The persisted runtime goal, when goal tooling is available, is only a concise representation of this richer contract.

Reject activity goals such as "make progress", "continue investigating", or "work on X". Use an observable completion criterion that establishes the approved outcome without inventing numerical precision or maximizing proof.

## 4. What planning should preserve

A useful handoff captures the desired outcome and acceptance criteria, approved behavior or architecture decisions, explicit non-goals, important rejected alternatives whose rationale prevents likely re-litigation, task-specific invariants and risk boundaries, current repository evidence that materially constrains implementation, unresolved decisions requiring human approval, environment or manual evidence required for completion, and mutation authorization that differs from repository defaults.

Prefer references to authoritative repository sources over copied content when the executing agent can read those sources directly.

Do not duplicate generic workflow, role, review, validation, authorization, or repository instructions already owned by the target repository and portable orchestration standard.

## 5. Evidence and uncertainty

Planning may happen in ChatGPT or in a bounded Codex investigation where the useful evidence lives.

Verify repository-specific facts when they materially affect the proposed design. Prefer current code, configuration, Git/CI state, and authoritative project documentation over memory or dated artifacts.

Use Codex for coherent multi-step repository investigation rather than turning the maintainer into the default command runner. A short manual command remains appropriate when it is genuinely the cheapest evidence path.

When the plan depends on a moving external premise, verify that premise from a current authoritative source before hard-coding it.

When planning introduces non-trivial structural complexity or decides whether to account now for a difficult-to-reverse known future constraint, apply the installed `$complexity-discipline` skill when available. Preserve its necessity-chain and reversibility reasoning rather than copying that procedure into this document.

## 6. Implementation detail

Include implementation detail when it is already known and materially useful.

A plan may identify exact files, symbols, reproduction steps, sequence constraints, focused validation, or environment checks. Do not invent such detail merely to make the plan look complete.

Avoid procedural scripts that prescribe every edit, read, or test cycle unless that exact sequence is itself part of the correctness requirement.

Task-specific validation belongs in the plan when it defines acceptance. Generic repository validation procedure does not.

Express task-specific evidence as observable acceptance criteria: what must hold, what evidence establishes it, and what failure would require further investigation. Avoid open-ended obligations to maximize proof. Reserve terms such as "exhaustive", "exact", or "fully prove" for criteria whose required strength is actually part of the contract. Apply [ORCHESTRATION.md's decision-bounded evidence and closure rule](ORCHESTRATION.md#decision-bounded-evidence-and-closure) rather than restating it in each plan.

## 7. Ownership boundaries

A substantial handoff may identify candidate coherent ownership boundaries when they clarify implementation structure.

These describe responsibilities such as one API contract, persistence boundary, frontend workflow, provider integration, or deployment surface. They are not mandatory child assignments.

Do not encode one child per numbered task. The executing primary owns decomposition and role selection using current repository state and `ORCHESTRATION.md`.

If expensive repository discovery has already produced a useful map, the handoff may state what evidence is fresh enough to reuse and what remains uncertain.

## 8. Keep execution mechanics out of task semantics

Model, reasoning effort, root fresh-versus-continued context, quota considerations, and similar launcher settings are operator/runtime decisions, not implementation-plan semantics.

Do not put launcher instructions such as `use Sol/high`, `use Astra/medium`, `start fresh`, or `continue this thread` into the implementation plan or runnable root prompt unless the executing agent itself must act on that information.

Likewise, do not pre-script child or reviewer topology merely because roles exist. Record a genuine independence or ownership requirement when one is part of the task; otherwise let `ORCHESTRATION.md` govern dispatch.

For a continuing worker, communicate the delta rather than replaying context it already owns. External decisions or evidence that the worker has not seen must still be supplied when needed.

## 9. Root launch prompt

When the repository already contains the approved artifacts, the runnable prompt should stay task-oriented.

For plan-backed execution, identify the approved plan and ask the primary to implement it through completion, treating it as scope and acceptance contract and following the repository's current orchestration and authorization rules.

For goal-backed execution, identify the approved Goal Contract and ask the primary to execute toward its outcome, adapt implementation strategy from current evidence, preserve approved decisions and authorization boundaries, and continue until completion evidence exists or a real stop/escalation condition is reached.

Make the stopping rule explicit without duplicating validation procedure: complete the approved acceptance criteria and repository-required gates, then close. Do not ask for extra compatibility investigation, repeated validation, or adjacent-surface tracing solely to increase confidence after those criteria are satisfied.

Add task-specific context, new decisions, and mutation authorization only when they are not already available through the repository or active context.

## 10. Handoff quality

Before treating the handoff as ready, confirm that the work genuinely belongs in Goal execution, the plan-backed default or explicitly approved goal-backed variant is clear, the outcome and acceptance criteria are observable, material design decisions have the required approval, non-goals constrain likely scope creep, repository-specific claims are current enough or explicitly uncertain, external evidence unavailable to the execution context is captured, structural complexity has a concrete rationale where relevant, and ordinary repository or orchestration procedure has not been duplicated into the task contract.

The primary must retain enough freedom to adapt implementation strategy to current repository evidence without redefining the approved outcome.
