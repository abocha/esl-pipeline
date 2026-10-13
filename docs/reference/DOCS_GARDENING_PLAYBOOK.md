# Docs Gardening Playbook

## Meta

- Audience: maintainers and AI agents resolving documentation drift.
- Authority Level: operational playbook.
- Last Verified Against: 2026-09-30 docs-gardening scripts and workflow.
- Owner: founder-maintainer + automation agents.
- Review Cadence: after ownership/tooling changes or recurring documentation confusion.
- Status: `reference`.

## Purpose and ownership

Make documentation support sound decisions for the task being reviewed. Resolve consequential
conflicts, confusing routes and lifecycle drift while preserving useful intent and history.
Completion is a semantic judgment supported by source evidence; check counts, age, coverage and
wording polish do not establish it.

This playbook owns the maintenance procedure. [Governance](DOCS_GOVERNANCE.md) owns documentation
policy and verification-date rules; the [testing guide](TESTING_GUIDELINES.md#docs-only-changes)
owns validation selection. The [gardening skill](../../.agents/skills/esl-pipeline-docs-gardening/SKILL.md)
selects a bounded entry route. Existing scripts and configuration own mechanical behavior.

## Change-driven upkeep

Use this route when an authorized change retires a concept, moves ownership, changes an interface
described in several places, or completes an execution plan. Ordinary isolated edits can update
their owner directly.

Start from the changed behavior and the agent task it affects. For example: “How would an agent
submit and publish a fresh assignment using this guidance?” Identify the source/contract owner,
then search active guidance for affected concepts, old names and inbound consumers. Follow concrete
dependencies; a cutover is not a reason to reread every document.

Update the owning guidance, replace competing copies of mutable facts with useful owner links,
and distinguish retained historical statements. At task closure, apply the
[plan lifecycle contract](../plans/README.md#lifecycle-contract): preserve any still-useful procedure
in its owner before archiving completed execution context, or retain an explicitly justified roadmap.
Repair routes in the same change. Do not archive based on age or missing inbound links alone.

## Scoped semantic review

Begin with the named claim, confusing task route or subsystem. State the decision the review could
change and what evidence would support leaving the guidance alone. Walk through a representative
task using current entrypoints and inspect the claims required to make its decisions.

Identify the precise surface: a runtime default, public response, internal projection, emitted
metric stream, deployed observation and intended contract can describe different things. Trace the
relevant caller or mapper when that distinction matters. A name match or nearby green test is not
proof that the documented surface exists.

Current source establishes implementation. When implementation disagrees with a binding invariant,
determine whether the defect is in code, documentation or unresolved intent before changing either.
Source presence does not establish production activation, cohort readiness, provider-account state
or residual learner-data eligibility. Resolve routine repository questions; leave genuinely missing
product/operator evidence explicit with its owner and practical consequence.

## Periodic triage

The existing [weekly workflow](../../.github/workflows/docs-gardening.yml) runs `pnpm docs:garden`,
retains generated evidence and updates the rolling gardening issue. It supplies leads; it does not
perform semantic review or authorize fixes. A maintenance task must select and resolve an area.

Use a relevant existing report when its revision and inputs still apply. Run gardening when a
fresh mechanical snapshot answers the maintenance question; targeted change work does not require
a full snapshot first. Read the generator's reported artifact paths and relevant findings rather
than loading every artifact or creating another hand-maintained catalog.

Prioritize active misleading guidance, recurring task confusion and recently changed ownership or
contracts. Rotate attention among coherent areas during maintenance; review after significant
cutovers when the affected routes warrant it. Age/overlap/no-route heuristics are investigation
leads, not correctness or archival verdicts. Historical material and runtime prompt/fixture content
retain their separate roles.

Turn candidates into bounded questions and use the scoped review above. Keep the rolling issue as
the generated triage surface under Governance. Record durable planning decisions or deferred work
through [the intake boundary](../operations/github-issue-intake-and-codex-work-selection.md);
existing execution issues remain their scope authority. A skill invocation does not authorize new
tracker mutations, recurring automations or external messages.

## Semantic disposition

For each material finding, explain the affected claim/route, evidence, plausible consequence for an
agent and the surviving owner. Review what the prose actually asserts; avoid inventing a stronger
claim to refute. Keep accurate, useful summaries even when source contains more detail. Additional
implementation detail or caveats should change a needed decision; an incidental wording preference
needs no finding or edit.

- KEEP when evidence supports the relevant guidance, intent or historical role. This is a completed
  review outcome.
- CORRECT a contradicted factual claim or consequential ambiguity at its owner.
- CONSOLIDATE when competing guidance causes reconciliation or drift. Choose the surviving owner
  first; transfer unique current material and replace duplicates with direct routes.
- ARCHIVE completed or superseded context after preserving useful current guidance and repairing
  consumers. Keep observed outcomes and provenance immutable; supersede with new dated evidence.
- REMOVE only when redundancy or uselessness is established and useful material/consumers survive.
- DEFER when a named missing fact or decision materially prevents a verdict. State its owner and
  consequence; ordinary source investigation is part of the task, not a question to offload by default.

Keep product intent, implementation, procedure and evidence distinguishable. Hand-written guidance
should explain meaning, prerequisites and decisions; executable/generated owners should carry
mutable inventories. Scope a move's consumer search to repository links, source references and
known callers rather than treating a zero-link result as proof of no consumers.

## Bounded Luna questions

Delegate when independent judgment or investigation would materially help. Simple checks can stay
with the primary. Group related questions by shared source context rather than spawning per file
or checklist item. When subagents are authorized, use GPT-6 Luna/high for these bounded read-only
documentation investigations; honor an explicit user routing override and report unavailable routing.
Use in-task subagents; the separate Luna Lab Dispatch skill's root-task dispatch and tracker actions
do not belong to this procedure.

Give the investigator the question, the decision it could change, relevant docs/source starting
points, permitted resources/actions and sufficient evidence for stopping. Let evidence contradict
the hypothesis. For an independent behavioral trial, provide the realistic request and raw artifacts
without the intended answer, suspected defect or proposed fix.

Useful questions include:

- What route would an agent follow for this task, and what current contracts support its decisions?
- Which observations can an operator actually obtain through this runbook?
- What useful guidance would archiving this completed plan lose, and where does it belong?
- What establishes this readiness statement, and what remains unestablished?

Ask for a supported conclusion, located evidence, practical consequence and material uncertainty.
Do not require a defect quota, score or fresh report for every check. Read-only assignments include
no edits, builds, broad tests, provider/data/production calls or tracker updates unless specifically
within the task's authorization. The primary integrates findings and owns the final verdict;
check concrete ambiguities or consequential claims rather than repeating every investigation.
Consequential contract/product/operational decisions retain their existing authority and review route.

## Mechanical evidence

Follow the [docs-only recipe](TESTING_GUIDELINES.md#docs-only-changes), using the applicable existing
generator and explicit changed-path formatting. A non-empty committed base/head comparison is
required by `docs:check:pr`; it reads current working-tree documents. The PR checker retains
configured structural/metadata/lifecycle gates and advisory age-only warnings. Its local-link
coverage and limitations belong to the [checker implementation](../../scripts/docs/check-pr-docs.mjs)
and tests; structural green cannot certify claims, intent or live state.

The [verification procedure](DOCS_GOVERNANCE.md#verification-procedure) remains required before
advancing an enforced document's `Last Verified Against`, including the full `pnpm docs:check`.
Editing selected claims does not establish a full-document audit. Preserve the date unless that
obligation is satisfied; source evidence for the actual review can be recorded in the task or PR.

Inspect generated changes and fix affected paths/anchors and known consumers. Run focused tooling
tests when the tooling changes. Respect authored-doc versus runtime prompt/fixture boundaries.
Do not run provider, learner-data or production probes merely to refresh prose.

## Completion boundary

Conclude when scoped task routes support correct decisions, identified material contradictions are
resolved, unique invariants/rationale survive, required evidence is obtained and consequential
uncertainty is appropriately bounded with its owner. Explain why the guidance is usable and what
practical risk remains. Passing checks supports that judgment; it does not replace it.

Further investigation or edits need a concrete way to change the disposition or prevent a plausible
task failure. Cosmetic refinement, exhaustive rereading and hypothetical ambiguity do not keep a
closed review open. Reopen only when new evidence or a missing requirement changes its basis.

Prefer corrected owners, repaired consumers and a concise explanation in the existing task/PR.
Create a disposition inventory, dated record or separate artifact only when its scope or future
reader justifies maintenance. Distinguish a completed investigation from completed implementation,
and local/hosted evidence from unperformed product, provider or operational verification.
New work starts from its task or execution issue; a repository plan is useful only when that work
benefits from an approved multi-step artifact. Archiving an old plan does not require creating a new one.
