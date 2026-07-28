# CI Service Evidence Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Repository policy requires the primary agent to perform all edits inline.

**Goal:** Make local validation explicitly hand PostgreSQL/Redis requirements to PR CI, keep CI service jobs authoritative and fail-closed, and preserve automatic release-on-merge.

**Architecture:** Extend the existing affected plan with execution ownership rather than creating a new matrix framework. Locally owned lanes run and aggregate; service lanes remain selected but are reported as CI-required. Existing CI change-scope booleans and isolated PostgreSQL/Redis job remain, using the PR 2 manifest-guarded package scripts.

**Tech Stack:** Node.js ESM planner/runner, GitHub Actions, pnpm, JSON/text artifacts, repository documentation.

## Global Constraints

- PR CI contains every application-level check required before merge and automatic release.
- The release-on-merge workflow is not converted into a regression suite and is not otherwise changed.
- No nightly tier, scheduled quarantine tier, or nightly release is introduced.
- Local PostgreSQL/Redis commands remain available for focused diagnosis but are not universal prerequisites.
- CI service selection remains conservative for migrations, repositories, queues, workers, contracts, shared infrastructure, workflow changes, and unknown scope.
- Missing required CI jobs remain a failing condition in `ci-gate`.
- Release impact: `release:patch` unless the final release guard accepts `release:none` for the complete tooling/docs/workflow set.

---

### Task 1: Represent local and CI ownership in affected plans

**Files:**

- Modify: `scripts/check/affected-check-lib.mjs`
- Modify: `scripts/check/affected-check-lib.test.mjs`
- Modify: `scripts/check/run-affected-check.mjs`
- Modify: `scripts/check/agent-check-lib.mjs`
- Modify: `scripts/check/agent-check-lib.test.mjs`

**Interfaces:**

- Adds lane field: `owner: 'local' | 'ci'`.
- Adds plan field: `ciRequirements: Array<{ id: string, reason: string }>`.
- Adds aggregate status: `pass_with_ci_requirements`.

- [x] **Step 1: Write planner ownership tests**

  Assert representative paths produce these outcomes:

  ```text
  frontend source -> local unit/deterministic lanes; no DB requirement
  migration -> local deterministic lanes + CI backend-db-integration
  repository test -> local deterministic lanes + CI backend-db-integration
  worker/BullMQ/Redis -> local deterministic lanes + CI backend-db-integration
  Docker/deployment -> local Docker lint where selected + CI container/compose evidence already mapped
  contracts/shared infrastructure/workflow/unknown -> conservative CI service requirement
  ```

  Assert owner metadata never depends on ambient environment variables.

- [x] **Step 2: Run planner tests and verify failure**

  Run: `node --test scripts/check/affected-check-lib.test.mjs scripts/check/agent-check-lib.test.mjs`

  Expected: FAIL because ownership and `pass_with_ci_requirements` do not exist.

- [x] **Step 3: Add ownership without changing selection**

  Retain selected service lanes in the plan for visibility, mark them `owner: 'ci'`, and have `buildExecutionLanes` execute only `owner: 'local'`. Populate `ciRequirements` from the skipped CI-owned lanes.

- [x] **Step 4: Format honest local outcomes**

  A run with all local lanes passing and at least one CI requirement must print:

  ```text
  check:fast:agent PASS_WITH_CI_REQUIREMENTS
  local lanes <N> passed
  CI required:
    - backend-db-integration: <selection reason>
  ```

  A local failure remains `FAIL` even when CI requirements are present.

- [x] **Step 5: Run planner, runner, and formatting tests**

  ```powershell
  node --test scripts/check/affected-check-lib.test.mjs scripts/check/execution-lane-lib.test.mjs scripts/check/agent-check-lib.test.mjs scripts/check/run-ci-scope.test.mjs
  pnpm check:fast:dry-run
  ```

  Expected: PASS; dry-run separately displays locally executed lanes and required CI evidence.

- [x] **Step 6: Commit local-to-CI ownership**

  ```powershell
  git add scripts/check/affected-check-lib.mjs scripts/check/affected-check-lib.test.mjs scripts/check/run-affected-check.mjs scripts/check/agent-check-lib.mjs scripts/check/agent-check-lib.test.mjs
  git commit -m "feat(validation): declare required CI evidence"
  ```

### Task 2: Keep CI selection aligned with the four routes

**Files:**

- Modify: `scripts/check/affected-check-lib.mjs`
- Modify: `scripts/check/affected-check-lib.test.mjs`
- Modify: `scripts/check/run-ci-scope.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Preserves CI output `backend_db_worker` as the one resource-efficient service job selector.
- Consumes the PR 2 package scripts guarded by `test-routing.json`.

- [x] **Step 1: Add committed-scope regression cases**

  Cover migrations, every positively listed PostgreSQL/worker test, backend repository implementation paths, queue/worker implementation paths, contracts, shared infrastructure, workflow changes, renames, deletes, and unknown roots. Each must require `backend_db_worker=true` where currently conservative coverage requires it.

- [x] **Step 2: Run CI-scope tests**

  Run:

  ```powershell
  node --test scripts/check/affected-check-lib.test.mjs scripts/check/run-ci-scope.test.mjs
  ```

  Expected: any missing mapping fails before workflow edits.

- [x] **Step 3: Keep the existing isolated service job**

  Do not split PostgreSQL and Redis into additional jobs in this resource-constrained design. Continue provisioning both in `backend-db-integration`, then invoke the manifest-guarded public scripts:

  ```text
  test:db:migrations
  test:db:postgres
  test:integration:worker
  ```

  Preserve health checks, migration preflight, schema failure evidence, artifact upload, and the final `ci-gate` required-job check.

- [x] **Step 4: Verify the workflow contract statically**

  Run:

  ```powershell
  pnpm test:check-routing
  pnpm run lint:repo-hygiene
  ```

  Expected: PASS; the CI service job remains conditionally selected and fail-closed.

- [x] **Step 5: Commit CI alignment**

  ```powershell
  git add .github/workflows/ci.yml scripts/check/affected-check-lib.mjs scripts/check/affected-check-lib.test.mjs scripts/check/run-ci-scope.test.mjs
  git commit -m "ci(validation): align required service evidence"
  ```

### Task 3: Add actionable artifacts for static and deterministic integration CI

**Files:**

- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Produces always-uploaded `tmp/ci-logs/static-checks/` and `tmp/ci-logs/integration-tests/` artifacts.

- [x] **Step 1: Capture static and integration logs without hiding exit codes**

  Use the Linux runner's `set -o pipefail`, write command output with `tee`, and preserve step failure. Keep commands as separate steps where their independence helps diagnosis; do not collapse the entire job into one opaque shell script.

- [x] **Step 2: Upload artifacts with `if: always()`**

  Follow the existing pinned `actions/upload-artifact` convention. Use 14-day retention to match current DB/Telegram evidence. Each artifact must include a short manifest naming the command, conclusion, and log path.

- [x] **Step 3: Verify YAML and repository policy**

  ```powershell
  pnpm format
  pnpm run lint:repo-hygiene
  pnpm test:check-routing
  ```

  Expected: PASS and no unpinned action references.

- [x] **Step 4: Commit CI artifacts**

  ```powershell
  git add .github/workflows/ci.yml scripts/check/agent-check-lib.mjs scripts/check/agent-check-lib.test.mjs
  git commit -m "ci(validation): retain actionable lane logs"
  ```

### Task 4: Finalize policy, release boundary, and topic lifecycle

**Files:**

- Modify: `AGENTS.md`
- Modify: `docs/reference/agents-ssot.md`
- Modify: `docs/reference/TESTING_GUIDELINES.md`
- Modify: `.github/pull_request_template.md`
- Move before the final PR 3 commit: `docs/plans/pr-validation-simplification/**` to `docs/archive/plans/pr-validation-simplification/**`
- Modify: `docs/plans/README.md`

**Interfaces:**

- Makes local, PR CI, and automatic release responsibilities authoritative.

- [x] **Step 1: Document the final agent contract**

  Keep `AGENTS.md` compact. State:

  ```text
  focused tests during implementation
  one aggregate local gate before PR
  inspect artifacts before rerunning
  one isolated diagnostic rerun maximum per unchanged failure
  complete rerun only after relevant source/config/prerequisite correction
  PASS_WITH_CI_REQUIREMENTS permits PR creation but not merge
  selected PR CI service jobs are authoritative before merge
  merge to main automatically starts release production
  ```

- [x] **Step 2: Document the absence of a nightly tier**

  Remove any new plan wording that assigns required evidence to nightly validation. Manual diagnostics may exist, but no release-blocking test may depend on a future scheduled run.

- [x] **Step 3: Preserve the release workflow boundary**

  Confirm `release-on-merge.yml` is unchanged. The docs must state that PR CI owns application readiness, while the merge workflow decides versioning and publishes immutable images. Deployment remains a separate operator action.

- [x] **Step 4: Run final focused and canonical validation**

  ```powershell
  pnpm test:tooling
  pnpm test:check-routing
  pnpm format
  pnpm run lint:repo-hygiene
  pnpm docs:check
  pnpm --silent run check:fast:agent
  git diff --check
  ```

  If migrations, schema, or contract-version files were not changed, do not add DB baseline commands merely as ceremony.

- [ ] **Step 5: Verify the hosted PR before merge**

  Confirm `change-scope`, `static-checks`, selected integration/service jobs, and `ci-gate` pass. Verify exactly one release label. Do not merge until all selected required evidence passes because merge automatically begins the release transaction.

- [x] **Step 6: Complete lifecycle documentation**

  After implementation and validation are complete but before the final PR 3 commit, move this topic
  directory to `docs/archive/plans/pr-validation-simplification/`, remove it from the active plan
  router, regenerate documentation indexes, and rerun `pnpm docs:check`. The merged PR therefore
  leaves no completed plan under the active router.

- [x] **Step 7: Commit final policy and lifecycle changes**

  ```powershell
  git add AGENTS.md docs/reference/agents-ssot.md docs/reference/TESTING_GUIDELINES.md .github/pull_request_template.md docs/plans/README.md docs/archive/plans/pr-validation-simplification
  git commit -m "docs(validation): finalize PR evidence ownership"
  ```
