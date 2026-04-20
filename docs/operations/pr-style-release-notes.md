# PR-Style Release Notes (Direct Push Workflow)

## Meta

- Audience: maintainers and AI agents preparing release notes.
- Authority Level: operations runbook.
- Last Verified Against: 2026-04-20 repo state.
- Owner: maintainer + automation agents.
- Review Cadence: quarterly or after git tooling changes.
- Status: `runbook`.

Use this to draft human-readable release notes from commits.

This runbook does not control version numbers or tags; release automation is defined in:

- `docs/reference/VERSIONING_MODEL.md`

## Command

From repo root:

```bash
pnpm notes:pr-style
```

This auto-detects a base ref (`origin/main`, `main`, `origin/master`, then `master`) and generates markdown:

- `Changelog Summary`
- `Commit List`

By default, merge commits are excluded to keep notes focused on content changes.

## Common Examples

Generate from an explicit range:

```bash
pnpm notes:pr-style -- --base 285436a^ --head 7f65c60
```

Generate from the latest 4 commits and save to file:

```bash
pnpm notes:pr-style -- --limit 4 --output tmp/release-notes.md
```

Include merge commits when you explicitly want release-process events in the output:

```bash
pnpm notes:pr-style -- --base 7f88a56 --head HEAD --include-merges
```

## Notes

- The summary lines are auto-derived from commit subjects and conventional-commit prefixes (`feat`, `fix`, `docs`, etc.).
- Treat output as a first draft: tweak wording for product-facing release notes when needed.
- If no commits are found in a selected range, the script exits with an error so we do not publish empty notes.
