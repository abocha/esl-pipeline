---
name: esl-pipeline-docs-gardening
description: Resolve ESL Pipeline documentation drift during scoped audits, consolidation, lifecycle cleanup, or cutovers that invalidate scattered guidance. Use the existing gardening playbook; ordinary isolated doc edits need no gardening campaign.
---

# ESL Pipeline documentation gardening

Make the scoped task route support sound decisions. Green checks and tidy prose are supporting
evidence; completion follows material semantic risk and useful restraint.

## Choose the entry question

Use the relevant section of the [gardening playbook](../../../docs/reference/DOCS_GARDENING_PLAYBOOK.md):

| Situation                                                                 | Start with                                                                                          |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A cutover retires a concept, moves ownership, or finishes a plan          | [Change-driven upkeep](../../../docs/reference/DOCS_GARDENING_PLAYBOOK.md#change-driven-upkeep)     |
| A named route, subsystem, or claim is confusing or suspect                | [Scoped semantic review](../../../docs/reference/DOCS_GARDENING_PLAYBOOK.md#scoped-semantic-review) |
| A maintenance task selects work from gardening findings or recent changes | [Periodic triage](../../../docs/reference/DOCS_GARDENING_PLAYBOOK.md#periodic-triage)               |

Frame the question around an agent task and the decision it must support. Give evidence room to
support KEEP or contradict the initial suspicion. Read the exact implementation surface being
described; current code establishes implementation, while intended contracts and live activation
have their own owners. Resolve routine source gaps yourself; name genuine missing evidence.

## Investigate and integrate

Apply the playbook's [semantic disposition](../../../docs/reference/DOCS_GARDENING_PLAYBOOK.md#semantic-disposition)
and [completion boundary](../../../docs/reference/DOCS_GARDENING_PLAYBOOK.md#completion-boundary).
Choose the surviving owner before consolidation, preserve unique invariants and historical rationale,
and repair affected consumers. Read-only requests remain read-only; the skill grants no additional
tracker, provider, learner-data, production, or repository mutation authority.

For useful optional investigations, follow the playbook's
[bounded Luna questions](../../../docs/reference/DOCS_GARDENING_PLAYBOOK.md#bounded-luna-questions).
Keep simple checks with the primary and group questions sharing source context. The primary owns
the final semantic verdict and consequential decisions; subagent output is evidence.

Use [mechanical evidence](../../../docs/reference/DOCS_GARDENING_PLAYBOOK.md#mechanical-evidence)
appropriate to the final change. Report why the route is usable, the material uncertainty that
remains, and why further work is or is not needed. Prefer a corrected owner and concise task/PR
explanation; create additional inventories or records only when they have a concrete future use.
