# Documentation Governance (v2 Harness)

## Meta

- Audience: maintainers and AI agents editing docs.
- Read Time: 3 minutes.
- Authority Level: governance policy.
- Last Verified Against: 2026-09-14 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly or after docs-tooling changes.
- Status: `reference`.

## Purpose

- Keep the docs system agent-friendly, high-signal, and mechanically checkable.
- Define the v2 docs-gardening contract: hard gates, warnings, heuristics, manual review queue, rolling issue lifecycle, and data-first artifacts.

## Harness Contract

- `docs:check` is the full configured-scope hard check. It runs the core, active-operations, and
  non-core scopes; the non-core scope also enforces the plan-lifecycle checks.
- PR CI uses `docs:check:pr -- --from <base> --to <head>`. It checks every configured document for
  structural failures, metadata, links, route hints, and lifecycle rules. Age-only freshness is
  always advisory in PR mode, regardless of which documents or packages changed; missing or invalid
  freshness metadata remains blocking.
- Scheduled `pnpm docs:garden` and full `pnpm docs:check` retain repository-wide age enforcement.
  Gardening publishes the health, stale-active, plan-lifecycle, and rolling-issue artifacts.
- Freshness is an age signal, not proof that a document is accurate. Advancing the
  `Last Verified Against` date requires reviewing the document against the current repository; a
  date-only edit does not satisfy this policy even when it clears the mechanical gate.
- Docs health and stale-candidate outputs are warning/triage artifacts, not policy sources.
- The rolling issue is the manual review queue for unresolved warnings, heuristic candidates, and repeated drift.
- Generated artifacts are the source of truth for each run; markdown summaries are renderings of those artifacts.
- `pnpm docs:garden` emits the full artifact family for that run, including health and stale-active
  reports, so the GitHub workflow does not advertise files that were produced by separate commands.
- `pnpm docs:generate:indexes` refreshes the package README, backend-route, environment-surface, and
  plans indexes. `pnpm docs:generate:plans-index` refreshes only the plan lifecycle index for
  plan-only changes.
- Plan lifecycle checks are hard gates: active plans stay under `docs/plans/`; completed or
  superseded execution plans move to `docs/archive/plans/`.
- `docs/plans/README.md` remains the active-plan router, while `docs/generated/plans-index.md` is a
  generated lookup aid rather than an authority source. Routed topic, standalone, and backlog plans
  must remain editable and declare `Status`, `Last Verified Against`, `Exit Trigger`, and
  `Current Focus`; configured route sources may not target non-editable plans.

## Lifecycle States

- `router`: directs readers to the right authoritative docs.
- `active`: current implementation guidance.
- `reference`: contract or policy source of truth.
- `runbook`: operational procedure.
- `spec`: active design boundary or model.
- `roadmap`: sequenced plan.
- `generated`: machine-produced lookup aid.
- `archive`: historical, non-authoritative material.

## Enforcement Model

### Hard gates

- Broken links, missing routes, missing metadata, invalid freshness metadata, banned patterns,
  lifecycle contradictions, and other structural violations are hard failures in both full and PR
  modes.
- `docs:check:pr` is the PR merge gate, with age-only freshness warnings that never block a PR.
  `docs:check` and scheduled `docs:garden` retain full-scope age enforcement.
- The freshness gate deliberately cannot determine whether a review was substantive. Reviewers and
  agents must enforce the verification procedure below.

### Warnings

- Warnings are allowed for trends that need attention but do not yet justify a merge block.
- PR age-only freshness findings are advisory. Scheduled/full gardening owns repository-wide age
  enforcement and reports freshness trends in its docs-health snapshot.

### Heuristics

- Heuristics are advisory only.
- Stale-active candidates are meant to guide human review, not to auto-archive anything.
- Manual review decides whether to archive, refresh, re-route, or ignore a candidate.
- Low-signal content corpora can be included in docs scans without receiving route-coverage
  pressure; this keeps generated/template galleries from crowding out actionable docs work.
- Plan lifecycle output distinguishes editable active plans, active-tree historical trace, archived
  trace, and router/editability contradictions so agents do not patch stale implementation intent.

## Rolling Issue Policy

- Keep one open rolling issue for docs-gardening findings.
- Update the issue body from the latest structured artifacts.
- Close it only when the latest run has no hard failures, no meaningful warnings, and no active stale candidates.
- Treat it as a queue, not as a changelog.

## Update Rules

- Update core docs when behavior, scope, or contracts change.
- Update this doc when the harness model changes.
- Keep the policy concise here; move operational steps to the playbook.

## Verification Procedure

Before advancing `Last Verified Against` on an enforced document:

1. Compare its commands, package ownership, runtime assumptions, routes, and linked paths with the
   current repository.
2. Review relevant changes since the previous verified date, including new packages, workflows,
   plans, generated surfaces, and contract changes.
3. Correct or remove stale content, add missing high-signal routes, and keep historical material out
   of active guidance.
4. Run the applicable generated-index command, formatting check, and `pnpm docs:check`.
5. Record the substantive audit in the commit or PR summary. If the content remains correct, state
   what evidence was checked; never advance the date solely to unblock CI.

## Agent Harness Boundaries

- Keep `AGENTS.md` short, practical, and limited to durable repository guidance: layout, commands,
  conventions, constraints, review expectations, and definition of done.
- Use the nearest nested `AGENTS.md` only for genuinely local overrides; closer instructions take
  precedence and the combined instruction chain has a finite context budget.
- Keep one-off outcomes and acceptance criteria in the task prompt or active plan.
- Move repeated procedures into skills and deterministic requirements into scripts, hooks, or CI
  rather than relying on prose reminders.
- Treat repository-tracked docs and code as the durable system of record; chat-only decisions are
  incomplete until encoded in the appropriate source.

This boundary follows OpenAI's current
[`AGENTS.md` guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md) and
[Codex best practices](https://learn.chatgpt.com/guides/best-practices): use layered instructions,
prefer concise practical guidance, and separate durable conventions from reusable automation.

## Related

- [`docs/reference/DOCS_GARDENING_PLAYBOOK.md`](DOCS_GARDENING_PLAYBOOK.md)
- [`docs/reference/HARNESS_AGENTIC_DOCS_MODEL.md`](HARNESS_AGENTIC_DOCS_MODEL.md)
- [`docs/generated/README.md`](../generated/README.md)
