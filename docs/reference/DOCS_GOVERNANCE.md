# Documentation Governance

This document defines how docs are authored, classified, and maintained in this repository.

## Source Hierarchy

When docs conflict, use this priority order:

1. `docs/reference/agents-ssot.md` (authoritative contracts and invariants)
2. Active status docs (`docs/backend-frontend/backend-frontend-alignment.md`, `docs/backend-frontend/BATCH_SYSTEM.md`)
3. Package READMEs (implementation usage details)
4. Drafts and archive docs (historical context only)

## Document States

Every doc should be one of these states:

- Active: current operational or reference guidance
- Draft: in-progress ideas (`docs/drafts/`)
- Archived: historical docs, non-authoritative (`docs/archive/`)

## Stale Criteria

A doc is stale if one or more apply:

- It references replaced architecture, routes, workflows, or package structure.
- It conflicts with SSOT or current package behavior.
- It duplicates status tracking already covered in active canonical docs.
- It is roadmap-only material for work that is complete, abandoned, or superseded.

## Archive Policy

- Do not hard-delete stale docs by default.
- Move stale docs to: `docs/archive/<domain>/<yyyy-mm>/`.
- Add or update domain index files:
  - `docs/archive/frontend/README.md`
  - `docs/archive/pipeline/README.md`
  - `docs/archive/notes/README.md`
- Archived docs should be treated as historical context, not implementation guidance.

## Ownership And Review Cadence

- Any PR changing behavior must update affected active docs in the same PR.
- For backend/frontend changes, update `docs/backend-frontend/backend-frontend-alignment.md` when status changes.
- Review top-level index docs (`docs/README.md`, `docs/reference/DOCS_IA_MAP.md`) during major feature shifts.

## Linking Rules

- Active docs should link to active docs first, then SSOT, then package README references.
- Avoid linking from active docs to archive docs unless explicitly labeled "historical".
- Avoid `file://` links or machine-local absolute paths.

## Practical Checklist For Doc PRs

1. Updated active docs that changed behavior or status.
2. Confirmed no stale references remain in active indexes.
3. Archived superseded docs instead of deleting.
4. Verified internal links for touched files.
