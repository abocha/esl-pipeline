# Agent Legibility Model

## Meta

- Audience: maintainers and AI agents improving repo readability.
- Read Time: 6 minutes.
- Authority Level: docs system design reference.
- Last Verified Against: 2026-03-13 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: monthly or after major docs-tooling changes.
- Status: `reference`.

## Purpose

- Define what makes this repository legible to agents without turning router docs into manuals.
- Translate harness-engineering principles into repo-specific rules for docs, plans, generated references, and archives.

Reference article:
[`Harness engineering: leveraging Codex in an agent-first world`](https://openai.com/index/harness-engineering/)

## Core Model

### 1. `AGENTS.md` is a router, not a knowledge dump

- `AGENTS.md` should route to the minimum authoritative doc set.
- Contracts, runbooks, and deep implementation detail belong in `docs/`, not in the agent entrypoint.
- If `AGENTS.md` starts re-explaining whole subsystems, the fix is usually a better router or a missing task doc.

### 2. The repo is the system of record

- Chat output is advisory until encoded in the repository.
- Active docs should live next to the codebase they explain and be versioned with the changes they describe.
- If a behavior changes and only the chat remembers it, the docs system has failed.

### 3. Progressive disclosure beats giant manuals

Preferred path:

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/reference/DOCS_IA_MAP.md`
4. task-specific docs
5. `docs/reference/agents-ssot.md` for final invariants

Implication:

- router docs should stay short
- deep docs should be explicit about audience and authority
- archive docs should not appear in normal routing unless historical rationale is needed

### 4. Hand-written docs explain meaning; generated docs expose inventory

- Hand-written docs should explain:
  - why something exists
  - which rules apply
  - what operators or implementers must do
- Generated docs should expose:
  - inventories
  - indexes
  - route surfaces
  - package/doc coverage maps
- If a doc keeps drifting because it is just a list of facts, prefer a generated reference.

### 5. Plans are first-class operating documents

- Plans are not scratch notes.
- A plan should exist when implementation spans multiple steps, risks, or acceptance criteria.
- Plan routers should make it obvious which docs are:
  - active implementation plans
  - long-lived roadmaps
  - audits/evaluations
  - completed historical plans

### 6. Archive is garbage collection, not a graveyard

- Archive when a doc is no longer part of active routing or is superseded by better active docs.
- Keep active docs lean by moving historical narratives and one-off manuals into `docs/archive/`.
- Never leave an active doc in place just because deleting it feels risky.

## Doc Types and Expected Shape

### Router docs

- Goal: send readers to the right next doc quickly.
- Should include:
  - scope
  - short task paths
  - minimal related links
- Should not duplicate deep system detail.

### Reference docs

- Goal: define contracts, invariants, models, and policy.
- Should explain stable truths and decision rules.
- Good fit for:
  - env contracts
  - architecture policies
  - docs governance
  - prompt/provider policies

### Runbooks

- Goal: help someone operate or recover a live system safely.
- Should emphasize:
  - prerequisites
  - ordered steps
  - diagnostics
  - rollback/fallback behavior

### Specs

- Goal: capture active design assumptions and interface boundaries.
- Best when implementation spans multiple packages or layers.

### Roadmaps / plans

- Goal: sequence work and define acceptance, not restate current behavior.
- Should clearly indicate whether they are active, completed, or superseded.

### Generated references

- Goal: provide fast factual lookup without manual narration.
- Must say how they are produced and which hand-written docs remain canonical.

## Legibility Checks for a Proposed Doc Change

Before adding or editing a doc, ask:

1. Is this a router, reference, runbook, spec, roadmap, or generated index?
2. Is there already a stronger home for this information?
3. Should this be generated instead of hand-maintained?
4. Which router docs need to point to it?
5. Which existing doc becomes redundant or archival if this lands?

## Required Update Pairings

Common pairings in this repo:

- behavior change:
  - code + SSOT/alignment + package README/runbook
- new plan:
  - plan file + `docs/plans/README.md` + relevant topic router
- docs tooling/gardening change:
  - script/config + `docs/reference/DOCS_GOVERNANCE.md` + gardening playbook/scorecard
- archive move:
  - moved doc + archive index + any router that pointed to the old path

## Related

- [`docs/reference/HARNESS_AGENTIC_DOCS_MODEL.md`](HARNESS_AGENTIC_DOCS_MODEL.md)
- [`docs/reference/DOCS_GOVERNANCE.md`](DOCS_GOVERNANCE.md)
- [`docs/reference/DOCS_GARDENING_PLAYBOOK.md`](DOCS_GARDENING_PLAYBOOK.md)
- [`docs/reference/DOCS_GARDENING_SCORECARD.md`](DOCS_GARDENING_SCORECARD.md)
- [`docs/generated/README.md`](../generated/README.md)
