# Harness Agentic Docs Model (v2)

> Historical reference. Current governance and checker behavior are defined by
> [`DOCS_GOVERNANCE.md`](../../../reference/DOCS_GOVERNANCE.md); the gardening workflow lives in
> [`DOCS_GARDENING_PLAYBOOK.md`](../../../reference/DOCS_GARDENING_PLAYBOOK.md).

## Meta

- Audience: maintainers and AI agents improving docs operations.
- Read Time: 5 minutes.
- Authority Level: historical reference.
- Last Verified Against: 2026-04-03 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: monthly or after major workflow/tooling changes.
- Status: `archive`.

## Purpose

- Translate harness-engineering principles into the repo’s docs-gardening model.
- Keep the system data-first, mechanically checkable, and easy for agents to act on.

## V2 Harness Shape

- One structured snapshot should drive the run.
- Hard gates and heuristics should stay separate.
- Markdown reports should render the snapshot; they should not be the primary source of truth.
- The rolling issue should represent the manual review queue.

## Principle Mapping

1. **Repo as system of record**
   - Repository-tracked docs define the contract.
   - Generated artifacts summarize the latest run.

2. **Router docs stay short**
   - `AGENTS.md` and `docs/README.md` point to the right place.
   - Deep policy lives in reference docs, not in workflow code.

3. **Hard gates first**
   - `docs:check` enforces the merge-blocking rules.
   - Warnings and stale heuristics do not block by themselves.

4. **Manual review queue second**
   - The rolling issue is where ambiguous candidates land.
   - Human judgment decides archive versus refresh versus ignore.

5. **Data-first artifacts**
   - JSON is the primary artifact.
   - Markdown is a view for readers and issue bodies.

## Operating Constraints

- Keep the harness fast and deterministic.
- Keep enforced scope high-signal.
- Prefer archive moves over indefinite doc drift.
- Promote repeated review pain into explicit policy, not more ad hoc interpretation.

## Related

- [Current documentation governance](../../../reference/DOCS_GOVERNANCE.md)
- [Current gardening procedure](../../../reference/DOCS_GARDENING_PLAYBOOK.md)
- [Generated documentation index](../../../generated/README.md)
