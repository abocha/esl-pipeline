# Docs Gardening Playbook

## Meta

- Audience: maintainers and AI agents resolving documentation drift.
- Authority Level: operational playbook.
- Last Verified Against: 2026-09-30 docs-gardening scripts and workflow.
- Owner: founder-maintainer + automation agents.
- Review Cadence: after ownership/tooling changes or recurring documentation confusion.
- Status: `reference`.

## Purpose and ownership

The shared `codex-workflow:docs-gardening` skill owns task-based semantic review, disposition
and consolidation methods. This playbook applies them to ESL's local lifecycle and tooling.
[Governance](DOCS_GOVERNANCE.md) owns policy and verification dates; the
[testing guide](TESTING_GUIDELINES.md#docs-only-changes) owns validation selection. Existing
scripts/configuration own mechanical behavior. Mandatory scope and stopping rules remain in
[AGENTS.md](../../AGENTS.md), effective even when the plugin is unavailable.

## Change-driven upkeep

Start from the changed ESL behavior and affected agent task, then use the shared method to
follow concrete claims and consumers. Ordinary isolated edits can update their owner directly.

At task closure, apply the [plan lifecycle contract](../plans/README.md#lifecycle-contract):
preserve still-useful procedure in its owner before archiving completed execution context,
or retain an explicitly justified roadmap. Repair active routes in the same change. Do not
archive based on age or missing inbound links alone; historical observations remain immutable.

## Scoped semantic review

Use the shared docs-gardening semantic review for a named claim, task route or subsystem.
Current source establishes implementation; [the SSOT](agents-ssot.md) establishes binding
ESL contracts. Source presence alone does not establish production activation, cohort readiness,
provider-account state or residual learner-data eligibility. Genuine missing product/operator
evidence retains its owner and practical consequence; do not run production or learner-data
probes merely to refresh prose.

## Periodic triage

The [weekly workflow](../../.github/workflows/docs-gardening.yml) runs `pnpm docs:garden`,
retains generated evidence and updates the rolling gardening issue. It supplies leads, not
semantic verdicts or authorization to fix them. A maintenance task selects a bounded area.

Reuse a relevant report while its revision and inputs apply. Run gardening when a fresh snapshot
answers the question; targeted upkeep does not require a full snapshot first. Read reported
artifact paths and relevant findings rather than loading every artifact or adding a manual catalog.
Prioritize active misleading guidance, recurring task confusion and recently changed ownership.
Age/overlap/no-route heuristics remain investigation leads. Historical material and runtime
prompt/fixture content retain their separate roles.

Keep the rolling issue as Governance's generated triage surface. Record durable planning or
deferred work through [the intake boundary](../operations/github-issue-intake-and-codex-work-selection.md);
existing execution issues remain their scope authority. Skill invocation adds no tracker mutation,
recurring automation, provider, production or external-message authority.

## Semantic disposition

Apply the shared method's KEEP, CORRECT, CONSOLIDATE, ARCHIVE, REMOVE or DEFER dispositions to
material findings. ESL's surviving contracts and useful historical rationale must remain available;
repair affected routes when ownership moves. Accurate summaries can remain useful without copying
implementation detail. Generated owners carry mutable inventories; new prose or separate records
need a concrete future reader and maintenance purpose.

## Bounded Luna questions

Optional documentation investigations follow shared delegation/context methods and current task
authorization. Keep simple checks with the primary and group questions sharing source context.
When subagents are authorized for these bounded read-only questions, retain the ESL routing default
of GPT-6 Luna/high; honor explicit user routing overrides and report unavailable routing. Use
in-task subagents, not Luna Lab Dispatch root tasks or tracker operations. The primary owns the
semantic verdict and consequential decisions. Read-only scope includes no edits, builds, broad
tests, provider/data/production calls or tracker updates unless separately within authorization.

## Mechanical evidence

Follow the [docs-only recipe](TESTING_GUIDELINES.md#docs-only-changes), including affected generated
references and explicit changed-path formatting. PR mode requires a non-empty committed comparison
and reads current working-tree documents. Its structural/metadata/lifecycle gates remain blocking;
age-only findings are advisory. [Checker implementation](../../scripts/docs/check-pr-docs.mjs) and
tests own local-link coverage and limitations. Structural green cannot certify claims or live state.

The [verification procedure](DOCS_GOVERNANCE.md#verification-procedure) remains required before
advancing an enforced document's `Last Verified Against`, including full `pnpm docs:check`.
A selected-claim repair is not a full-document audit; preserve the date unless that obligation
is satisfied. Record the actual review evidence in the task/PR.

Inspect generated changes and affected paths/anchors and known consumers. Run focused tooling
tests when tooling changes. Respect authored-doc versus runtime prompt/fixture boundaries.

## Completion boundary

Conclude when the scoped ESL task route supports correct decisions, material contradictions
are resolved, unique constraints survive, required evidence exists and consequential missing
product/operator evidence is explicit. Distinguish completed investigation from implementation,
and local/hosted observations from unperformed provider, learner-data or production checks.
Apply root `AGENTS.md` stopping rules and the shared closure method; cosmetic refinement does
not keep a resolved review open. Archiving an old plan does not require inventing a new one.
