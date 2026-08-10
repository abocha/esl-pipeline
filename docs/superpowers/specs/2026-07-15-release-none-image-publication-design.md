# Release-None Image Publication Design

## Meta

- Audience: maintainers and implementation agents.
- Status: approved design.
- Last Verified Against: 2026-07-15 release workflows, versioning policy, and production image flow.
- Owner: founder-maintainer + automation agents.
- Scope: PR release labels, merged-PR release automation, and production image publication.

## Problem

Every merged PR currently creates a version commit and tag, then builds and publishes the complete
production image bundle. That is correct for deployable changes, but wasteful for changes limited to
documentation, GitHub workflows, or repository-only tooling.

Skipping only the image job is unsafe: it would create a release tag whose SHA cannot be deployed
through the pull-based production workflow. A non-deployable merge must therefore skip the entire
release transaction: no version bump, changelog entry, tag, or production images.

## Decision

Add a fourth mandatory PR label, `release:none`. It means the merged change is intentionally not a
deployable release. The existing `release:patch`, `release:minor`, and `release:major` labels retain
their current semantics and continue to publish the complete three-image bundle.

The `Release Label Guard` validates `release:none` against the paginated PR file list. Before path
classification, it compares the number of API file records with `pull_request.changed_files`.
Missing counts, zero files, a mismatch, or a cap-saturated response of 3,000 records fails closed
because GitHub does not expose more than 3,000 PR files through this endpoint. It accepts the label
only when the count is trustworthy and every changed path is in a high-confidence maintenance-only
allowlist. Renames are evaluated using both old and new paths. An unknown path or a mixture
containing any deployable path requires a normal release label.

## Maintenance-Only Boundary

The initial allowlist is deliberately narrow:

- `.github/**`;
- `.impeccable/**`;
- `.codex/**` project-local Codex maintainer configuration;
- non-runtime `docs/**`, excluding `docs/prompt-gallery/**`;
- root Markdown documentation;
- repository checker, docs, and test harnesses under `scripts/check/**`, `scripts/docs/**`, and
  `scripts/test/**`;
- the dedicated Hadolint runner and its tests;
- these exact repository-only files: `.dclintrc.json`, `.editorconfig`, `.gitattributes`,
  `.gitignore`, `.hadolint.yaml`, `.prettierignore`, `.prettierrc.json`, `biome.json`,
  and `knip.json`.

Everything else requires `release:patch`, `release:minor`, or `release:major`. In particular,
`packages/**`, `.dockerignore`, `.env.example`, `.nvmrc`, dependency manifests and lockfiles,
TypeScript/build configuration, Dockerfiles, Compose/deployment files, database/contracts,
environment templates, and `docs/prompt-gallery/**` remain release-worthy. The prompt gallery is
copied into the backend production image and is not ordinary documentation.

False negatives are acceptable: a maintenance-only PR may still use `release:patch` and publish a
bundle. False positives are not: `release:none` must never suppress publication for a potentially
deployable change.

## Workflow Behavior

The release-label guard gains read access to PR metadata and collects changed-file records through
the paginated GitHub API. It writes those records together with `pull_request.changed_files`; the
repository-owned Node policy validates the count before flattening and normalizing old/new paths.
The policy resolves exactly one of the four release labels and validates the `release:none`
boundary.

On merge, a small `release-decision` job independently collects and count-validates the final PR file
list, checks out trusted `main`, and reruns the same policy against the final labels. It exposes a
`should_release` output. The `release` job depends on that decision and runs only when the PR was
merged and `should_release` is `true`. An invalid post-merge `release:none` selection fails visibly
instead of suppressing a release silently. Because `publish-images` depends on `release`, it is
skipped with it. Real releases keep the current atomic sequence:

1. version and changelog commit;
2. `vX.Y.Z` tag;
3. backend, frontend, and Telegram bot images tagged with the release commit SHA and version.

Production deployment remains a separate manual action. This change does not introduce selective
component builds, reusable old image tags, or automatic deployment.

## Error Handling

- Zero or multiple recognized release labels fail the guard.
- `release:none` without a readable changed-file payload fails the guard.
- Missing or zero PR counts, count mismatches, 3,000-file responses, malformed payloads,
  renamed-to-unknown paths, or otherwise unclassified paths require a real release.
- A normal release label remains valid regardless of changed paths; the classifier cannot prevent a
  maintainer from choosing the safer release path.
- Merge-time policy revalidation prevents a stale guard result, label race, or branch-protection
  bypass from silently suppressing release publication.
- Release workflow structural tests lock the merge-time decision, release condition, and dependency
  from image publication to the release job.

## Testing Strategy

Use Node's test runner for pure policy and CLI coverage. Cases include docs-only acceptance,
prompt-gallery rejection, runtime/config rejection, mixed changes, empty input, count mismatch/cap
rejection, rename paths, exactly-one-label enforcement, and normal release labels. Structural
workflow tests cover paginated file collection, count validation, changed-file forwarding,
merge-time revalidation, and full release skipping for `release:none`.

Final validation runs the complete tooling-test lane, workflow lint, documentation checks, the
affected agent gate, and broad pre-PR validation because release automation is a high-trust
repository boundary.

## Acceptance Criteria

- Every PR still has exactly one recognized release label.
- A confidently maintenance-only PR can use `release:none`.
- Potentially deployable or unclassified changes cannot use `release:none`.
- Merging `release:none` creates no version commit, tag, or production image.
- Merging a normal release continues to publish one coherent three-image bundle.
- Active versioning, deployment, and agent guidance describes the four-label policy.
- The GitHub repository contains the `release:none` label.
