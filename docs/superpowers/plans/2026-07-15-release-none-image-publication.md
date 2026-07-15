# Release-None Image Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline; use one scoped
> reviewer for this design and plan before implementation.

**Goal:** Let confidently maintenance-only PRs skip versioning, tags, and production image builds
without weakening the deployable release invariant.

**Architecture:** A pure Node release-policy module owns the four labels and a fail-closed path
classifier. The existing CLI reads GitHub event and changed-file JSON. Both the label guard and a
merge-time decision job collect paginated PR-file records plus the event's expected count. The Node
policy verifies the record set is complete before classification. The release root job runs only
when the decision says a release is required, naturally skipping the dependent image job for valid
`release:none` merges.

**Tech Stack:** Node.js 24, Node test runner, GitHub Actions, `actions/github-script`, pnpm,
Markdown/YAML.

## Global Constraints

- Keep this work on `codex/tooling-system-cleanup-plan` and add it to PR #134.
- Do not change application runtime, image contents, deployment scripts, or the three-image bundle.
- Classify conservatively: unknown or mixed paths require a real release.
- Reject missing/zero counts, API/event count mismatches, and cap-saturated 3,000-file responses.
- Treat `docs/prompt-gallery/**` as runtime content.
- Evaluate both old and new names for renames.
- Keep the current PR labeled `release:patch`; create `release:none` for future eligible PRs.
- Use test-first implementation and Conventional Commits; do not merge or deploy.

### Task 1: Lock the Release Policy in Tests

**Files:**

- Create: `scripts/release/release-label-policy.test.mjs`
- Create: `scripts/release/release-workflow-structure.test.mjs`

- [ ] Add policy tests covering exactly-one-label enforcement; normal bump resolution; docs,
      workflow, and tooling-only acceptance; prompt-gallery, package, dependency, Docker/deployment,
      and unknown-path rejection; the exact allowed root config files; mixed changes; empty input;
      count mismatch/cap rejection; and both sides of a rename. Explicitly prove `.dockerignore`,
      `.env.example`, `.nvmrc`, package manifests, and build config remain release-worthy.
- [ ] Add CLI-facing expectations for `release:none` with and without a changed-file payload.
- [ ] Add workflow structure tests requiring paginated PR-file collection, old/new rename paths,
      count validation, changed-file forwarding, `release:none` in the guard, merge-time policy
      revalidation, and a release condition driven by the decision output while images still depend
      on the release job.
- [ ] Run:

  ```bash
  node --test scripts/release/release-label-policy.test.mjs scripts/release/release-workflow-structure.test.mjs
  ```

  Expected: RED because the policy module, fourth label, collection step, and merge gate do not yet
  exist.

### Task 2: Implement the Fail-Closed Label Policy

**Files:**

- Create: `scripts/release/release-label-policy.mjs`
- Modify: `scripts/release/resolve-release-bump-from-pr.mjs`

- [ ] Export pure functions to validate/flatten changed-file records, normalize paths, classify
      release impact, and resolve one recognized label. Represent `release:none` with `bump: null`
      and `releaseRequired: false`.
- [ ] Use an explicit maintenance-only allowlist matching the approved design. Return structured
      reasons for rejected `release:none` selections. Empty or invalid path lists require release.
- [ ] Extend the CLI with `--changed-files <json-path>`. Require it only for `release:none`; keep
      normal label behavior and plain bump output backward compatible. For a valid `release:none`,
      plain output is exactly `none`; JSON output contains `bump: null` and
      `releaseRequired: false`.
- [ ] Run the focused policy/CLI tests and confirm GREEN.
- [ ] Commit:

  ```bash
  git add scripts/release/release-label-policy.mjs scripts/release/release-label-policy.test.mjs scripts/release/resolve-release-bump-from-pr.mjs
  git commit -m "feat(release): add maintenance-only release policy"
  ```

### Task 3: Wire the Guard and Merge Workflow

**Files:**

- Modify: `.github/workflows/release-label-guard.yml`
- Modify: `.github/workflows/release-on-merge.yml`
- Modify: `scripts/release/release-workflow-structure.test.mjs`

- [ ] Grant `pull-requests: read` to the guard. Use the repository's pinned
      `actions/github-script` action to paginate `pulls.listFiles`. Write the raw records plus
      `pull_request.changed_files` as JSON under `$RUNNER_TEMP`; the Node policy must reject
      missing/zero counts, mismatches, and 3,000-file responses before flattening `filename` plus any
      `previous_filename`.
- [ ] Pass that file to the resolver's `--changed-files` option.
- [ ] Add a `release-decision` job to the merge workflow. It must independently collect and
      count-validate files, check out trusted `main`, run the same resolver in JSON mode, and expose
      `should_release`.
- [ ] Make `release` depend on `release-decision` and run only for a merged PR whose decision output
      is `true`. Keep `publish-images` dependent on `release` and otherwise unchanged.
- [ ] Run:

  ```bash
  node --test scripts/release/release-label-policy.test.mjs scripts/release/release-workflow-structure.test.mjs
  pnpm run lint:repo-hygiene
  ```

  Expected: PASS.

- [ ] Commit:

  ```bash
  git add .github/workflows/release-label-guard.yml .github/workflows/release-on-merge.yml scripts/release/release-workflow-structure.test.mjs
  git commit -m "ci(release): skip maintenance-only release builds"
  ```

### Task 4: Synchronize Active Release Guidance

**Files:**

- Modify: `AGENTS.md`
- Modify: `docs/reference/agents-ssot.md`
- Modify: `docs/reference/VERSIONING_MODEL.md`
- Modify: `docs/backend-frontend/DEPLOYMENT.md`

- [ ] Document exactly one of four labels, the conservative `release:none` eligibility boundary,
      prompt-gallery exception, and the fact that maintenance-only merges create no release or
      images.
- [ ] Keep deployment guidance clear that a deployable merge still publishes the complete bundle
      before manual VPS deployment.
- [ ] Run:

  ```bash
  pnpm docs:check
  git diff --check
  ```

  Expected: PASS.

- [ ] Commit:

  ```bash
  git add AGENTS.md docs/reference/agents-ssot.md docs/reference/VERSIONING_MODEL.md docs/backend-frontend/DEPLOYMENT.md docs/superpowers/specs/2026-07-15-release-none-image-publication-design.md docs/superpowers/plans/2026-07-15-release-none-image-publication.md
  git commit -m "docs(release): define maintenance-only merges"
  ```

### Task 5: Validate, Publish, and Observe the Existing PR

**Files:** Review every new diff since `53bb42a4`; modify only for in-scope defects.

- [ ] Run focused and broad validation:

  ```bash
  pnpm format:write
  pnpm format
  pnpm test:tooling
  pnpm run lint:repo-hygiene
  pnpm docs:check
  pnpm --silent run check:fast:agent
  pnpm check:pre-pr
  git diff --check origin/main...HEAD
  ```

- [ ] Create or update the GitHub label `release:none` with a maintenance-only description. Keep PR
      #134 on its existing single `release:patch` label.
- [ ] Push the branch, update PR #134's summary/validation/risk notes for the added scope, and verify
      exactly one release label remains on the PR.
- [ ] Monitor the fresh PR checks to completion and inspect comments. Fix only failures caused by
      this change; do not merge or deploy.

## Completion Summary

Report the policy boundary, release workflow behavior, tests and validation actually run, commits,
PR URL and CI state, label creation, and that no deployment or merge occurred.
