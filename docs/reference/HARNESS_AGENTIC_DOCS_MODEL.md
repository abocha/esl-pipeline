# Harness Agentic Docs Model (Repo Implementation)

## Meta

- Audience: maintainers and AI agents improving docs operations.
- Read Time: 6 minutes.
- Authority Level: Docs system design and operating model.
- Last Verified Against: 2026-03-10 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: monthly or after major workflow/tooling changes.
- Status: `reference`.

## Purpose

- Translate harness-engineering principles into concrete, enforceable repo rules.
- Keep docs agent-friendly without overengineering.

Reference article:
`https://openai.com/index/harness-engineering/` (February 11, 2026)

## Principle Mapping

1. **Repo as system of record**
   - Canonical guidance lives in tracked docs files.
   - Chat outputs are advisory until encoded in repo docs.

2. **AGENTS.md as map, not full manual**
   - `AGENTS.md` is short and routing-first.
   - Deep contracts remain in SSOT and task docs.

3. **Progressive disclosure**
   - Router chain:
     `AGENTS.md -> docs/README.md -> DOCS_IA_MAP -> task-specific docs -> SSOT`
   - Agents read the minimum required docs first.

4. **Mechanical checks over social checks**
   - `pnpm docs:check` enforces structure, links, metadata, freshness windows, and route integrity.
   - CI blocks merges when enforced docs drift.

5. **Continuous docs-gardening**
   - Weekly automated docs health run.
   - Rolling issue for drift and stale-doc candidates.
   - Rule promotion: repeated review comments become checks.

## Operating Constraints (Pragmatic)

- Keep enforced scope high-signal and explicitly enumerated.
- Keep scripts fast and deterministic.
- Enforce through CI for all declared scopes.
- Prefer archiving stale long docs over indefinite patching.

## Enforced Scope (Current)

- Core routing and governance docs.
- Active operations runbooks.
- Selected non-core docs:
  - `docs/backend-frontend/DEPLOYMENT.md`
  - `docs/backend-frontend/batch-backend-ssot.md`
  - `docs/reference/env.md`
  - `docs/reference/pipeline-manifest.md`
  - `docs/reference/ORCHESTRATOR_API_V2_MIGRATION.md`
  - `docs/reference/GENERATION_PROVIDER_POLICY.md`
  - `packages/orchestrator/README.md`
  - `packages/batch-backend/README.md`
  - `packages/batch-frontend/README.md`
  - `packages/provider-runtime/README.md`

See:

- [`docs/reference/DOCS_GOVERNANCE.md`](DOCS_GOVERNANCE.md)
- [`scripts/docs/docs-check.config.json`](../../scripts/docs/docs-check.config.json)

## Quality Loop

- Score quality with [`docs/reference/DOCS_QUALITY_SCORE.md`](DOCS_QUALITY_SCORE.md).
- Track health via generated reports in `tmp/`.
- Execute gardening process from [`docs/playbooks/DOC_GARDENING_PLAYBOOK.md`](../playbooks/DOC_GARDENING_PLAYBOOK.md).

## Related

- [`AGENTS.md`](../../AGENTS.md)
- [`docs/reference/DOCS_GOVERNANCE.md`](DOCS_GOVERNANCE.md)
- [`docs/reference/DOCS_IA_MAP.md`](DOCS_IA_MAP.md)
- [`docs/reference/agents-ssot.md`](agents-ssot.md)
