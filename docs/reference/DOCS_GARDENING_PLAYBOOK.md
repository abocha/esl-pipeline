# Docs Gardening Playbook

## Meta

- Audience: maintainers and AI agents curating docs quality.
- Read Time: 7 minutes.
- Authority Level: operational playbook.
- Last Verified Against: 2026-03-13 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: weekly.
- Status: `reference`.

## Purpose

- Provide a deterministic process for keeping docs aligned with code and easy for agents to navigate.
- Turn repeated docs-review issues into routing changes, archive moves, or scripted checks.

## Standard Gardening Loop

Run this sequence for docs-heavy work or scheduled cleanup:

1. `pnpm docs:generate:indexes`
2. `pnpm docs:check`
3. `pnpm docs:health:report`
4. `pnpm docs:stale:active`

Artifacts:

- `docs/generated/*.md`
- `tmp/docs-health-report.json`
- `tmp/docs-health-report.md`
- `tmp/docs-stale-active.json`
- `tmp/docs-stale-active.md`

## Decision Tree

### Update in place

Use when:

- the doc is still authoritative
- the scope is stable
- the drift is factual rather than structural

Examples:

- env variable additions
- command-surface changes
- new route in an already-canonical runbook

### Split a doc

Use when:

- a doc serves multiple audiences badly
- the router is short but the deep content is too broad
- a plan or runbook has grown into a mixed roadmap + manual

Preferred split:

- router remains short
- deep implementation guidance moves into one or more topic docs

### Replace with a generated reference

Use when:

- the doc is mostly inventory
- entries are easy to derive from the repo
- humans keep forgetting to update it

Good candidates:

- package README inventories
- backend route indexes
- plan indexes

### Archive

Use when:

- the doc is no longer routed by active docs
- a better active replacement exists
- the value is historical rationale only

Archive move checklist:

1. move file under `docs/archive/<domain>/<yyyy-mm>/`
2. update the relevant archive index
3. update any active router or related-doc link that still points at the old path
4. note the replacement doc when one exists

## Freshness Expectations by Doc Type

### Router

- must stay short and actively routed
- refresh after any major docs-topology change

### Reference

- refresh when contracts, policies, or operating rules change
- should be more stable than runbooks, but never orphaned

### Runbook

- refresh after behavior, deploy, recovery, or safety-model changes
- should be written for stressed operators, not for ideal conditions

### Spec

- refresh when the active model or interface boundary changes
- archive historical implementation narratives instead of bloating the spec

### Roadmap / plan

- refresh when phases or acceptance criteria change
- supersede or archive when execution truth moves elsewhere

### Package README

- refresh when runtime surface, commands, env dependencies, or validation commands change
- should link to canonical runbooks/reference docs instead of duplicating them

## Coupled Update Checklists

### Behavior or runtime surface change

Update the smallest relevant set:

- code
- SSOT/alignment doc
- package README
- runbook
- env doc if config changed

### Docs-tooling or governance change

Update together:

- `scripts/docs/*` and/or `scripts/docs/docs-check.config.json`
- `docs/reference/DOCS_GOVERNANCE.md`
- this playbook
- scorecard/legibility docs if policy meaning changed

### Plan or roadmap change

Update together:

- plan file
- `docs/plans/README.md`
- relevant topic router
- completion/archive index if status changed

## Package README Policy

Operational package READMEs should cover:

- package role in the system
- current public/runtime surface
- related env/runbook links
- validation commands

Avoid:

- duplicating long specs
- leaving shipped behavior only in code or PRs
- keeping outdated “future work” sections that conflict with current runbooks

## Non-Goals

- Do not rewrite the whole docs tree in one pass.
- Do not auto-archive files from scripts.
- Do not keep low-value docs active just to avoid moving them.

## Related

- [`docs/reference/AGENT_LEGIBILITY_MODEL.md`](AGENT_LEGIBILITY_MODEL.md)
- [`docs/reference/DOCS_GOVERNANCE.md`](DOCS_GOVERNANCE.md)
- [`docs/reference/DOCS_GARDENING_SCORECARD.md`](DOCS_GARDENING_SCORECARD.md)
- [`docs/generated/README.md`](../generated/README.md)
