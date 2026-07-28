# Explicit Backend Test Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Repository policy requires the primary agent to perform all edits inline.

**Goal:** Prevent PostgreSQL and Redis tests from entering unit validation by making backend operational routes explicit, guarded, and hermetic in canonical local execution.

**Architecture:** Add one backend routing manifest and extend the existing routing guard to prove the public package scripts match it. Service and deterministic integration files are positively classified; the unit route remains the discovered remainder but is rejected when it imports service bootstrap helpers. Preserve the existing Vitest package scripts and agent parser instead of introducing another test runner.

**Tech Stack:** Node.js ESM, JSON routing data, `node:test`, existing Vitest and pnpm scripts.

## Global Constraints

- Preserve all existing meaningful backend tests and public script names.
- Do not infer operational class from `*.integration.test.ts` alone.
- The HTTP Fastify suites remain deterministic package integration.
- PostgreSQL migration/query suites remain serial.
- PostgreSQL+Redis worker suites remain serial.
- Unit tests may use hermetic temporary environment fixtures but may not acquire ambient service prerequisites.
- Do not change production environment-loading behavior.
- Do not add another package-test runner or modify the existing agent Vitest parser.
- No global timeout increases and no retries.
- Release impact: `release:patch` because validation behavior changes across deployable packages.

---

### Task 1: Add a central backend routing manifest and validator

**Files:**

- Create: `packages/batch-backend/tests/test-routing.json`
- Create: `scripts/test/backend-test-routing-lib.mjs`
- Create: `scripts/test/backend-test-routing-lib.test.mjs`

**Interfaces:**

- Produces: `readBackendTestRouting(repoRoot)`.
- Produces: `classifyBackendTests({ testFiles, routing })` returning `{ unit, deterministicIntegration, postgresMigrations, postgres, postgresRedisWorker }`.
- Produces: `validateBackendTestRouting({ classifications, backendScripts, sourceImports })` returning an array of actionable violations.

- [x] **Step 1: Write fixture-based routing contract tests**

  Cover these repository facts explicitly:

  ```js
  assert.equal(groupOf('domain.student-memory-openai-batch-repository.test.ts'), 'postgres');
  assert.equal(groupOf('integration.migrations.test.ts'), 'postgresMigrations');
  assert.equal(
    groupOf('transport.http-server.integration.assignment-sessions.test.ts'),
    'deterministicIntegration',
  );
  assert.equal(groupOf('transport.worker-runner.integration.test.ts'), 'postgresRedisWorker');
  ```

  Use temporary fixture inventories and scripts to prove the validator rejects:

  - an otherwise-unit test importing `bootstrap-pg-test-env`;
  - a service file missing from its package service script;
  - a service file not excluded from any unit script;
  - one file appearing in two service groups;
  - a manifest entry that does not exist.

- [x] **Step 2: Run the routing test and verify it fails**

  Run: `node --test scripts/test/backend-test-routing-lib.test.mjs`

  Expected: FAIL because the routing library and manifest do not exist.

- [x] **Step 3: Create the manifest**

  Use this exact initial service inventory:

  ```json
  {
    "version": 1,
    "deterministicIntegration": {
      "prefixes": ["transport.http-server.integration."]
    },
    "postgresMigrations": ["integration.migrations.test.ts"],
    "postgres": [
      "domain.job-repository.test.ts",
      "domain.revision-repository.test.ts",
      "domain.lesson-memory-repository.test.ts",
      "domain.homework-memory-repository.test.ts",
      "domain.student-profile-candidate-repository.test.ts",
      "domain.student-memory-snapshot-repository.test.ts",
      "domain.student-memory-openai-batch-import.test.ts",
      "domain.student-memory-openai-batch-repository.test.ts",
      "domain.assignment-session-repository.test.ts",
      "domain.student-repository.workspace.test.ts",
      "application.assignment-step-confirmation.test.ts",
      "application.homework-memory-source.test.ts",
      "application.student-timeline.test.ts",
      "application.student-schedule-billing.test.ts",
      "application.alpha-invites.registration.test.ts",
      "integration.query-plan-regression.test.ts"
    ],
    "postgresRedisWorker": [
      "transport.worker-runner.integration.test.ts",
      "integration.student-memory-pacing-delay.test.ts"
    ]
  }
  ```

  Keep `bootstrap.pg-test-env.test.ts` and `support/test-env.test.ts` in unit because they test helper behavior without connecting to services.

- [x] **Step 4: Implement deterministic discovery and script validation**

  Discover `packages/batch-backend/tests/**/*.test.ts`, normalize paths, expand deterministic prefixes, reject overlap and nonexistent entries, and classify the remainder as unit. Parse the backend package scripts and require:

  ```text
  postgresMigrations -> present in test:db:migrations and excluded from every unit script
  postgres -> present in test:db:postgres and excluded from every unit script
  postgresRedisWorker -> present in test:integration:worker and excluded from every unit script
  deterministicIntegration -> selected by test:integration:http and excluded from every unit script
  ```

  Scan unit candidates for these service signals:

  ```text
  support/bootstrap-pg-test-env
  requirePgTestEnv
  requireRedisTestEnv
  BATCH_BACKEND_TEST_PG
  BATCH_BACKEND_TEST_REDIS
  ```

  Exempt only `bootstrap.pg-test-env.test.ts` and `support/test-env.test.ts` from the signal scan.

- [x] **Step 5: Run fixture routing tests**

  Run: `node --test scripts/test/backend-test-routing-lib.test.mjs`

  Expected: PASS. Real repository validation is deliberately added in Task 2 so this task ends green.

- [x] **Step 6: Commit the classification library**

  ```powershell
  git add packages/batch-backend/tests/test-routing.json scripts/test/backend-test-routing-lib.mjs scripts/test/backend-test-routing-lib.test.mjs
  git commit -m "test(batch-backend): classify service prerequisites"
  ```

### Task 2: Fix the known leak and make routing a unit prerequisite

**Files:**

- Modify: `scripts/check/backend-test-routing.test.mjs`
- Modify: `packages/batch-backend/package.json`
- Modify: `scripts/check/affected-check-lib.mjs`
- Modify: `scripts/check/affected-check-lib.test.mjs`
- Modify: `scripts/check/execution-lane-lib.mjs`
- Modify: `scripts/check/execution-lane-lib.test.mjs`
- Modify: `package.json`

**Interfaces:**

- Preserves backend public scripts: `test:unit`, `test:unit:prebuilt`, `test:unit:timings`, `test:integration:http`, `test:db:migrations`, `test:db:postgres`, and `test:integration:worker`.
- Adds an always-selected local lane for `test:check-routing`.
- Makes `turbo:test:unit:prebuilt` depend on both `turbo:build` and `test:check-routing` when present.

- [x] **Step 1: Connect the repository routing guard and prove the current leak**

  Replace the narrow schedule-billing assertions with a call to
  `validateBackendTestRouting(...)` against the real backend test inventory and package scripts.

  Run: `node --test scripts/check/backend-test-routing.test.mjs`

  Expected: FAIL because `domain.student-memory-openai-batch-repository.test.ts` is classified as
  PostgreSQL but is absent from `test:db:postgres` and the unit exclusions.

- [x] **Step 2: Correct the backend script membership**

  Add `domain.student-memory-openai-batch-repository.test.ts` to `test:db:postgres` and exclude it from `test:unit`, `test:unit:prebuilt`, and `test:unit:timings`. Make no other test-membership change unless the new guard identifies another concrete mismatch.

- [x] **Step 3: Verify the routing regression turns green**

  Run: `node --test scripts/check/backend-test-routing.test.mjs`

  Expected: PASS; every discovered backend test has exactly one operational route and the package scripts match the manifest.

- [x] **Step 4: Add routing to the always-selected local evidence**

  Ensure `test:check-routing` invokes the routing regression test and is present in affected and broad plans before unit execution. Do not add PostgreSQL or Redis requirements to the guard itself.

- [x] **Step 5: Make the unit lane depend on routing success**

  Extend the coarse PR 1 dependency rule:

  ```js
  assert.deepEqual(unitLane.dependsOn, ['turbo:build', 'test:check-routing']);
  ```

  If routing fails, the unit lane becomes `blocked`; lint, typecheck, guards, and deterministic integration remain runnable.

- [x] **Step 6: Run focused planner and routing validation**

  ```powershell
  node --test scripts/check/backend-test-routing.test.mjs scripts/check/affected-check-lib.test.mjs scripts/check/execution-lane-lib.test.mjs
  pnpm test:check-routing
  ```

  Expected: PASS.

- [x] **Step 7: Commit synchronized routing**

  ```powershell
  git add package.json packages/batch-backend/package.json scripts/check/backend-test-routing.test.mjs scripts/check/affected-check-lib.mjs scripts/check/affected-check-lib.test.mjs scripts/check/execution-lane-lib.mjs scripts/check/execution-lane-lib.test.mjs
  git commit -m "fix(batch-backend): keep service tests out of unit lanes"
  ```

### Task 3: Sanitize canonical pure-test environments

**Files:**

- Create: `scripts/test/pure-test-env.mjs`
- Create: `scripts/test/pure-test-env.test.mjs`
- Modify: `scripts/check/run-affected-check.mjs`
- Modify: `scripts/test/run-agent-vitest-lane.mjs`

**Interfaces:**

- Produces: `buildPureTestEnv(sourceEnv)` returning a copied environment with service/provider credentials removed and `VALIDATION_TEST_CLASS=pure` set.
- Produces: `resolveValidationLaneEnv({ laneId, sourceEnv, backendDbEnv })`, which returns the pure environment only for unit lanes and preserves explicit DB/worker setup.

- [x] **Step 1: Write environment-scrubbing tests**

  Use a fixture containing ordinary toolchain variables plus PostgreSQL, Redis, Docker, AWS, OpenAI, ElevenLabs, Inworld, and Google credentials. Assert ordinary variables remain and these are absent:

  ```text
  BATCH_BACKEND_TEST_PG
  BATCH_BACKEND_TEST_REDIS
  PG_*
  REDIS_*
  DOCKER_HOST
  OPENAI_API_KEY
  ELEVENLABS_API_KEY
  INWORLD_API_KEY
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_SESSION_TOKEN
  GOOGLE_APPLICATION_CREDENTIALS
  ```

  Also assert `resolveValidationLaneEnv` scrubs `turbo:test:unit:prebuilt` but preserves an explicitly
  constructed environment when `backendDbEnv: true`.

- [x] **Step 2: Run the focused environment test and verify failure**

  Run: `node --test scripts/test/pure-test-env.test.mjs`

  Expected: FAIL because `buildPureTestEnv` does not exist.

- [x] **Step 3: Implement and connect pure environments**

  Use `buildPureTestEnv(process.env)` only for `turbo:test:unit:prebuilt` in the canonical affected/broad runner and for ordinary agent unit lanes. Preserve `PATH`, Node/pnpm variables, `CI`, `NODE_ENV`, and `TZ`. Do not use the pure environment for DB/worker commands or helper tests that construct their own child environments.

  In `run-agent-vitest-lane.mjs`, `--backend-db-env` remains authoritative and must bypass pure
  scrubbing after constructing its explicit service environment.

- [x] **Step 4: Run poisoned-environment acceptance**

  In a PowerShell child scope, set invalid service variables, keep PostgreSQL/Redis stopped, and run:

  ```powershell
  $env:BATCH_BACKEND_TEST_PG='postgres://invalid:invalid@127.0.0.1:1/invalid_test'
  $env:BATCH_BACKEND_TEST_REDIS='redis://127.0.0.1:1'
  $env:PG_ENABLED='true'
  $env:REDIS_ENABLED='true'
  pnpm --filter @esl-pipeline/batch-backend test:unit:prebuilt
  pnpm --filter @esl-pipeline/batch-backend test:integration:http
  ```

  Expected: PASS; neither command attempts a service connection. Use a child PowerShell process so the parent environment requires no cleanup.

- [x] **Step 5: Run agent-lane and environment unit tests**

  ```powershell
  node --test scripts/test/pure-test-env.test.mjs scripts/test/agent-vitest-lib.test.mjs scripts/check/execution-lane-lib.test.mjs
  ```

  Expected: PASS.

- [x] **Step 6: Commit hermetic unit execution**

  ```powershell
  git add scripts/test/pure-test-env.mjs scripts/test/pure-test-env.test.mjs scripts/check/run-affected-check.mjs scripts/test/run-agent-vitest-lane.mjs
  git commit -m "fix(validation): isolate pure test environments"
  ```

### Task 4: Synchronize test documentation and verify PR 2

**Files:**

- Modify: `AGENTS.md`
- Modify: `docs/reference/agents-ssot.md`
- Modify: `docs/reference/TESTING_GUIDELINES.md`
- Modify: `docs/plans/pr-validation-simplification/README.md`

**Interfaces:**

- Documents the four operational routes, manifest guard, and pure canonical environment.

- [x] **Step 1: Replace filename-based guidance**

  Remove guidance that treats `*.integration.test.ts` as sufficient classification. Document actual prerequisites, the routing manifest, the guarded-remainder unit rule, unchanged public package scripts, and the requirement that routing pass before unit execution.

- [x] **Step 2: Update topic lifecycle metadata**

  Set `Current Focus` to PR 3 after PR 2 is ready to merge.

- [x] **Step 3: Run focused and normal validation**

  ```powershell
  node --test scripts/check/backend-test-routing.test.mjs scripts/check/affected-check-lib.test.mjs scripts/check/execution-lane-lib.test.mjs scripts/test/pure-test-env.test.mjs scripts/test/agent-vitest-lib.test.mjs
  pnpm test:check-routing
  pnpm --filter @esl-pipeline/batch-backend test:unit:prebuilt
  pnpm --filter @esl-pipeline/batch-backend test:integration:http
  pnpm format
  pnpm run lint:repo-hygiene
  pnpm docs:check
  pnpm --silent run check:fast:agent
  git diff --check
  ```

  Expected: all deterministic commands pass without PostgreSQL or Redis.

  Implementation evidence: routing, environment, poisoned backend unit (743 tests), poisoned HTTP
  (185 tests), formatting, hygiene, and docs checks passed. The canonical aggregate completed seven
  of eight lanes; its unchanged frontend timing assertion passed immediately in focused isolation,
  so the full gate was not rerun to warm cache state.

- [x] **Step 4: Commit documentation**

  ```powershell
  git add AGENTS.md docs/reference/agents-ssot.md docs/reference/TESTING_GUIDELINES.md docs/plans/pr-validation-simplification/README.md
  git commit -m "docs(testing): define operational test routes"
  ```
