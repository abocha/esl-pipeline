# Versioning Tag Reset Runbook

## Meta

- Audience: maintainers and release operators.
- Authority Level: archive.
- Last Verified Against: 2026-03-05 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: never (historical record).
- Status: `archive`.

## Purpose

Historical record of the one-time clean-slate release reset for legacy tags.

This procedure archived existing tags, deleted local/remote legacy release tags, and restarted release history from a fresh baseline tag.

## Execution Status

Completed on 2026-03-05.

Outcome:

1. Legacy tags deleted (local + remote).
2. Baseline release established at `v1.0.0`.
3. Root `package.json` synchronized to `1.0.0`.

## Preconditions

1. Release automation has been merged:

- [`/.github/workflows/release-on-merge.yml`](../../.github/workflows/release-on-merge.yml)

2. Team/operator explicitly approves destructive tag cleanup.
3. You have admin push permissions for tags.
4. Working tree is clean.

## Step 1 - Archive Existing Tag History

```bash
git fetch --tags --prune
git tag --sort=creatordate > tmp/pre-v1-tag-history.txt
```

Copy/paste the tag snapshot into:

- [`docs/archive/release/tag-history-pre-v1-reset.md`](tag-history-pre-v1-reset.md)

Commit the archive before deletion.

## Step 2 - Delete Local Tags

```bash
git tag -l | xargs -r git tag -d
```

## Step 3 - Delete Remote Tags

```bash
git ls-remote --tags origin | awk '{print $2}' | sed 's#refs/tags/##' | sed 's/\^{}//' | sort -u | xargs -r -I{} git push origin :refs/tags/{}
```

## Step 4 - Verify Tag Deletion

```bash
git fetch --tags --prune
git tag -l
```

Expected: no legacy release tags remain.

## Step 5 - Start New Baseline

1. Merge one PR labeled `release:major` to produce `v1.0.0`.
2. Verify workflow produced:

- bot commit `chore(release): v1.0.0`
- tag `v1.0.0`
- root `package.json` version `1.0.0`

## Step 6 - Post-Reset Validation

```bash
git fetch --tags --prune
git describe --tags --abbrev=0
node -p "require('./package.json').version"
```

Expected:

1. Latest tag format is strict `vX.Y.Z`.
2. Tag and root package version match.

## Rollback

If reset was accidental:

1. Recreate tags from archived list manually (selective) or full.
2. Disable release workflow temporarily while recovering.
3. Re-run validation after restoration.
