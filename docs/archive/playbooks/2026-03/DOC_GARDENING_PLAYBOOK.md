# Doc Gardening Playbook

## Meta

- Audience: maintainers and AI agents curating docs quality.
- Read Time: 5 minutes.
- Authority Level: operational playbook.
- Last Verified Against: 2026-03-04 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: weekly.
- Status: `runbook`.

## Purpose

- Provide a deterministic process to reduce docs entropy.
- Convert repeated review pain into durable automation rules.

## Trigger Conditions

- Weekly scheduled docs-gardening workflow.
- Any PR where `pnpm docs:check` fails.
- Any noticeable route drift or stale operational guidance.

## Standard Run Sequence

1. `pnpm docs:check`
2. `pnpm docs:health:report`
3. `pnpm docs:stale:active`

Artifacts:

- `tmp/docs-health-report.json`
- `tmp/docs-health-report.md`
- `tmp/docs-stale-active.json`
- `tmp/docs-stale-active.md`

## Remediation Priority Order

1. Broken links and route edge failures.
2. Missing required metadata fields.
3. Freshness threshold violations.
4. Conflicting authority statements (router vs SSOT).
5. Stale-active candidates.

## Rule Promotion Loop

When the same docs issue appears 2+ times in PR review:

1. Add/extend check logic in `scripts/docs`.
2. Update config in `scripts/docs/docs-check.config.json`.
3. Document the new rule in `docs/reference/DOCS_GOVERNANCE.md`.

## Non-Goals

- Do not rewrite all docs in one sweep.
- Do not auto-archive files from scripts.
- Do not weaken contract docs to avoid failing checks.

## Related

- [`Archived agentic docs model`](../../reference/2026-10/HARNESS_AGENTIC_DOCS_MODEL.md)
- [`Current docs governance`](../../../reference/DOCS_GOVERNANCE.md)
- [`Historical docs quality score`](../../reference/2026-08/DOCS_QUALITY_SCORE.md)
