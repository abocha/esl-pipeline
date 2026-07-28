# Aggregate Local Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Repository policy requires the primary agent to perform all edits inline.

**Goal:** Make affected and broad local validation execute every independent lane once, block only build-dependent lanes, and emit one aggregate failure report.

**Architecture:** Preserve the existing affected planner and serial command execution. Add a small coarse dependency model to the execution layer, replace the first-failure break with run-to-completion collection, and route the broad pre-PR command through the same explicit runner rather than an opaque `&&` chain.

**Tech Stack:** Node.js ESM scripts, `node:test`, pnpm workspace scripts, Turbo, JSON/text artifacts.

## Global Constraints

- No lane concurrency is added in this PR.
- Existing affected-file, dependent-package, and conservative-fallback selection remains authoritative.
- No test is reclassified in this PR.
- No service lifecycle or CI behavior changes in this PR.
- A failed build blocks only lanes that consume prebuilt output; lint, typecheck, docs, contracts, and unrelated guards still run.
- No automatic retries and no timeout increases.
- Release impact: `release:none` if the release guard accepts the complete tooling/docs file set; otherwise `release:patch`.

---

### Task 1: Define aggregate lane statuses and summary output

**Files:**

- Modify: `scripts/check/agent-check-lib.mjs`
- Modify: `scripts/check/agent-check-lib.test.mjs`

**Interfaces:**

- Consumes: lane results produced by `run-affected-check.mjs`.
- Produces: `buildAgentCheckSummary({ label, durationMs, lanes })` with `pass`, `fail`, and `blocked` counts; `formatAgentCheckSummary(summary, { logsDir })` listing every failed or blocked lane.

- [x] **Step 1: Replace the first-failure summary test with aggregate expectations**

  Add one summary fixture containing two failures and one blocked lane. Assert this exact status model:

  ```js
  assert.deepEqual(summary.counts, {
    total: 5,
    passed: 2,
    failed: 2,
    blocked: 1,
  });
  assert.equal(summary.status, 'fail');
  assert.deepEqual(
    summary.problems.map((lane) => [lane.name, lane.status]),
    [
      ['build', 'fail'],
      ['test:unit:prebuilt', 'blocked'],
      ['lint', 'fail'],
    ],
  );
  ```

- [x] **Step 2: Run the focused test and verify the old summary contract fails**

  Run: `node --test scripts/check/agent-check-lib.test.mjs`

  Expected: FAIL because `counts.blocked`, `problems`, and multi-problem formatting do not exist.

- [x] **Step 3: Implement the aggregate summary contract**

  Keep lane statuses as the literal strings `pass`, `fail`, and `blocked`. Replace `firstFailure` as the formatter's source with:

  ```js
  const problems = lanes.filter((lane) => lane.status !== 'pass');
  ```

  Preserve `firstFailure` temporarily for compatibility, but derive it from the first `fail` result. Format every problem with its status, signal or block reason, reproduction command when available, and raw-log path when available.

- [x] **Step 4: Run the focused test and verify it passes**

  Run: `node --test scripts/check/agent-check-lib.test.mjs`

  Expected: PASS with aggregate failure and blocked-lane coverage.

- [x] **Step 5: Commit the summary contract**

  ```powershell
  git add scripts/check/agent-check-lib.mjs scripts/check/agent-check-lib.test.mjs
  git commit -m "refactor(validation): aggregate lane results"
  ```

### Task 2: Add coarse execution dependencies and continue independent lanes

**Files:**

- Create: `scripts/check/execution-lane-lib.mjs`
- Create: `scripts/check/execution-lane-lib.test.mjs`
- Modify: `scripts/check/run-affected-check.mjs`

**Interfaces:**

- Produces: `buildExecutionLanes(plan)` returning `{ id, pnpmArgs, repro, dependsOn }`.
- Produces: `resolveLaneDisposition(lane, priorResults)` returning `{ action: 'run' }` or `{ action: 'block', blockedBy: string[] }`.
- Consumes: existing plan `triggeredLanes` and Turbo task groups.

- [x] **Step 1: Write dependency-resolution tests**

  Cover these exact rules:

  ```js
  // lint and typecheck remain runnable after build failure
  assert.deepEqual(resolveLaneDisposition(lintLane, [failedBuild]), { action: 'run' });
  assert.deepEqual(resolveLaneDisposition(typecheckLane, [failedBuild]), { action: 'run' });

  // prebuilt tests are blocked by build failure
  assert.deepEqual(resolveLaneDisposition(unitLane, [failedBuild]), {
    action: 'block',
    blockedBy: ['turbo:build'],
  });
  ```

  Also assert that backend test lanes consuming built workspace output depend on `turbo:build` when that lane exists, while guards and formatting lanes have no dependencies.

- [x] **Step 2: Run the new test and verify it fails because the module does not exist**

  Run: `node --test scripts/check/execution-lane-lib.test.mjs`

  Expected: FAIL with module-not-found.

- [x] **Step 3: Implement the minimal serial dependency model**

  Move `buildExecutionLanes` out of `run-affected-check.mjs`. Use exact Turbo IDs from the current planner. Assign `dependsOn: ['turbo:build']` only to `turbo:test:unit:prebuilt` and backend `test:*` lanes when `turbo:build` is present. Do not add a generic DAG or resource scheduler.

- [x] **Step 4: Replace the first-failure loop**

  For each serial lane:

  ```js
  const disposition = resolveLaneDisposition(lane, laneResults);
  if (disposition.action === 'block') {
    laneResults.push(buildBlockedLaneResult(lane, disposition.blockedBy));
    continue;
  }
  laneResults.push(await runLane(lane));
  ```

  A blocked result has `status: 'blocked'`, `exitCode: null`, `blockedBy`, a concise signal, and no fabricated raw log.

- [x] **Step 5: Run runner and summary unit tests**

  Run:

  ```powershell
  node --test scripts/check/execution-lane-lib.test.mjs scripts/check/agent-check-lib.test.mjs scripts/check/affected-check-lib.test.mjs
  ```

  Expected: PASS.

- [x] **Step 6: Commit serial run-to-completion execution**

  ```powershell
  git add scripts/check/execution-lane-lib.mjs scripts/check/execution-lane-lib.test.mjs scripts/check/run-affected-check.mjs
  git commit -m "refactor(validation): complete independent lanes"
  ```

### Task 3: Route broad pre-PR validation through explicit lanes

**Files:**

- Modify: `scripts/check/affected-check-lib.mjs`
- Modify: `scripts/check/affected-check-lib.test.mjs`
- Modify: `scripts/check/run-affected-check.mjs`
- Modify: `package.json`

**Interfaces:**

- Produces: `buildBroadCheckPlan({ reason })` with explicit root guard, tooling, build, typecheck, lint, and fast prebuilt unit lanes.
- Adds CLI option: `node scripts/check/run-affected-check.mjs --broad [--agent]`.

- [x] **Step 1: Write broad-plan tests**

  Assert the broad plan exposes separate lanes for:

  ```text
  guard:orchestrator:boundary
  release:verify:contracts
  test:tooling
  build
  typecheck
  lint
  test:unit:prebuilt:fast
  ```

  Assert comparison-base failure uses this broad plan rather than an opaque `check:pre-pr` lane.

- [x] **Step 2: Run affected planner tests and verify failure**

  Run: `node --test scripts/check/affected-check-lib.test.mjs`

  Expected: FAIL because `buildBroadCheckPlan` and explicit fallback lanes do not exist.

- [x] **Step 3: Implement broad planning and prevent recursion**

  `--broad` must skip Git comparison entirely and build the explicit broad plan. Base-resolution failure in normal affected mode must call the same builder. It must never invoke the root `check:pre-pr` script from inside the runner.

- [x] **Step 4: Rewire the compatibility command**

  Change only the implementation of the existing public command:

  ```json
  "check:pre-pr": "node scripts/check/run-affected-check.mjs --broad"
  ```

  Keep `check:fast`, `check:fast:agent`, and `check:fast:dry-run` names unchanged in this PR.

- [x] **Step 5: Verify normal and broad dry-run output**

  Run:

  ```powershell
  pnpm check:fast:dry-run
  pnpm run check:pre-pr -- --dry-run
  ```

  Expected: both print explicit lane plans; broad mode does not resolve `origin/main` and does not recurse. During this tooling PR the normal affected dry-run exits 1 after truthfully reporting its conservative broad fallback, while the explicit broad dry-run exits 0.

- [x] **Step 6: Commit broad-runner convergence**

  ```powershell
  git add package.json scripts/check/affected-check-lib.mjs scripts/check/affected-check-lib.test.mjs scripts/check/run-affected-check.mjs
  git commit -m "refactor(validation): expose broad validation lanes"
  ```

### Task 4: Synchronize validation documentation and verify PR 1

**Files:**

- Modify: `AGENTS.md`
- Modify: `docs/reference/agents-ssot.md`
- Modify: `docs/reference/TESTING_GUIDELINES.md`
- Modify: `.github/pull_request_template.md`
- Modify: `docs/plans/pr-validation-simplification/README.md`

**Interfaces:**

- Documents the existing command names with the new aggregate execution contract.

- [x] **Step 1: Update the policy text**

  State that independent lanes run to completion serially, build-dependent lanes may be blocked, agents inspect the aggregate report before any rerun, focused reruns are diagnostic only, and a complete rerun requires a relevant input or prerequisite correction.

- [x] **Step 2: Update topic lifecycle metadata**

  Set `Current Focus` to PR 2 after PR 1 is ready to merge. Do not archive the topic.

- [x] **Step 3: Run focused tooling validation**

  ```powershell
  node --test scripts/check/agent-check-lib.test.mjs scripts/check/execution-lane-lib.test.mjs scripts/check/affected-check-lib.test.mjs scripts/check/run-ci-scope.test.mjs
  pnpm check:fast:dry-run
  pnpm run check:pre-pr -- --dry-run
  pnpm format
  pnpm run lint:repo-hygiene
  pnpm docs:check
  git diff --check
  ```

  Expected: focused tests, formatting, hygiene, and docs checks pass. The affected dry-run may exit 1 after reporting the expected broad fallback for validation-runner changes. Do not run the real broad gate repeatedly to prove aggregation; runner tests provide deterministic multi-failure evidence.

- [x] **Step 4: Run the canonical affected gate once**

  Run: `pnpm --silent run check:fast:agent`

  Expected: one aggregate result. If it fails, inspect the cited artifacts and follow the new rerun policy.

- [x] **Step 5: Commit documentation**

  ```powershell
  git add AGENTS.md docs/reference/agents-ssot.md docs/reference/TESTING_GUIDELINES.md .github/pull_request_template.md docs/plans/pr-validation-simplification/README.md
  git commit -m "docs(validation): define aggregate local evidence"
  ```
