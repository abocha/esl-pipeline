# CI Scope and Local Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local and hosted validation select the same conservative affected scope, remove
coverage/timing duplication from PR CI, and aggregate merge-facing results through one honest gate.

**Architecture:** Normalize Git changes into status-aware records, project those records through a
pure repository-owned CI classifier, and expose separate working-tree and committed previews. A
lightweight GitHub job publishes machine-safe scope outputs, conditional jobs consume explicitly
converted booleans, and a checkout-free aggregate gate validates the resulting job states.

**Tech Stack:** Node.js 24, pnpm 11, Node test runner, Git/GitHub Actions, Bash, existing workspace
package graph and validation scripts.

## Global Constraints

- Unknown, empty, root-toolchain, workflow, or classifier scope must widen all blocking hosted lanes.
- Deleted paths and both sides of renames/copies participate in classification.
- The workflow bootstrap parses the committed diff directly and must not import classifier code or
  path predicates.
- GitHub output conditions must use `fromJSON(...)` or explicit string equality, never bare output
  truthiness.
- `CI gate` uses `if: ${{ always() }}` and runs without checkout, package installation, or setup
  actions.
- Diagnostics are not PR merge-facing, but their scheduled/manual workflow must fail when a producer
  fails after preserving reports and artifacts.
- Local pre-push gates are substitutive: affected by default, broad directly when already known, and
  full when full CI/system behavior is required.
- Clearly docs-only work retains the narrower docs-specific SSOT exception.
- Do not shard unit tests, alter release concurrency, parallelize release images, add remote Turbo
  cache, cache `node_modules`, or weaken any selected lane in this slice.

## File and Responsibility Map

- `scripts/check/affected-check-lib.mjs` — collect status-aware Git records, preserve the current
  affected plan, and project records into hosted CI scopes.
- `scripts/check/affected-check-lib.test.mjs` — changed-file, classifier example, and invariant tests.
- `scripts/check/run-affected-check.mjs` — show separate local and hosted projections in dry-run mode.
- `scripts/check/run-ci-scope.mjs` — dependency-free GitHub/local CLI for committed scope and
  `GITHUB_OUTPUT`/`GITHUB_STEP_SUMMARY` formatting.
- `scripts/check/run-ci-scope.test.mjs` — CLI formatting and empty/failure behavior.
- `scripts/check/ci-workflow-structure.test.mjs` — structural workflow, bootstrap, Boolean conversion,
  diagnostics, and exact inline gate-evaluator tests.
- `.github/workflows/ci.yml` — change-scope job, conditional blocking lanes, and aggregate CI gate.
- `.github/workflows/ci-diagnostics.yml` — weekly/manual coverage and timing diagnostics.
- `package.json` — one deterministic root command for CI-routing tests.
- `AGENTS.md`, `docs/reference/agents-ssot.md`, `docs/reference/TESTING_GUIDELINES.md` — substitutive
  local gate policy and canonical CI check topology.

---

### Task 1: Status-Aware Changed-File Collection

**Files:**

- Modify: `scripts/check/affected-check-lib.mjs`
- Modify: `scripts/check/affected-check-lib.test.mjs`

**Interfaces:**

- Produces: `parseNameStatusZ(value) -> ChangedFileRecord[]`
- Produces: `flattenChangedFileRecords(records) -> string[]`
- Produces: `collectChangedFileScopes({ mergeBase, runGit }) -> Promise<{ hostedRecords, localRecords, hostedFiles, localFiles, uncommittedFiles }>`
- Preserves: `collectChangedFiles(...) -> Promise<string[]>` as a local-files compatibility wrapper.
- Record shape: `{ status: string, paths: string[] }`; rename/copy records contain old then new path.

- [ ] **Step 1: Replace the existing collection test with status-aware RED fixtures**

Add imports and tests equivalent to:

```js
import {
  collectChangedFileScopes,
  collectChangedFiles,
  flattenChangedFileRecords,
  parseNameStatusZ,
} from './affected-check-lib.mjs';

test('name-status parsing preserves deletions and both rename paths', () => {
  assert.deepEqual(
    parseNameStatusZ(
      'D\0packages/batch-backend/src/old.ts\0R100\0docs/old.md\0packages/batch-frontend/src/new.tsx\0',
    ),
    [
      { status: 'D', paths: ['packages/batch-backend/src/old.ts'] },
      { status: 'R100', paths: ['docs/old.md', 'packages/batch-frontend/src/new.tsx'] },
    ],
  );
});

test('changed file scopes separate committed hosted paths from local-only paths', async () => {
  const scopes = await collectChangedFileScopes({
    mergeBase: 'abc123',
    runGit: async (args) => {
      const joined = args.join(' ');
      if (joined.includes('abc123...HEAD')) return 'M\0docs/committed.md\0';
      if (args.includes('--cached')) return 'A\0packages/contracts/src/staged.ts\0';
      if (args.includes('--others')) return 'scratch.txt\0';
      return 'D\0packages/batch-backend/src/deleted.ts\0';
    },
  });

  assert.deepEqual(scopes.hostedFiles, ['docs/committed.md']);
  assert.deepEqual(scopes.localFiles, [
    'docs/committed.md',
    'packages/batch-backend/src/deleted.ts',
    'packages/contracts/src/staged.ts',
    'scratch.txt',
  ]);
  assert.deepEqual(scopes.uncommittedFiles, [
    'packages/batch-backend/src/deleted.ts',
    'packages/contracts/src/staged.ts',
    'scratch.txt',
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test scripts/check/affected-check-lib.test.mjs
```

Expected: FAIL because the new exports do not exist and the current collector excludes `D` and loses
rename source paths.

- [ ] **Step 3: Implement null-delimited record parsing and dual collection**

Implement the exported helpers with these commands and semantics:

```js
const committedArgs = [
  'diff',
  '--name-status',
  '-z',
  '--find-renames',
  '--find-copies',
  '--diff-filter=ACDMRTUXB',
  `${mergeBase}...HEAD`,
];
const unstagedArgs = [
  'diff',
  '--name-status',
  '-z',
  '--find-renames',
  '--find-copies',
  '--diff-filter=ACDMRTUXB',
];
const stagedArgs = [
  'diff',
  '--cached',
  '--name-status',
  '-z',
  '--find-renames',
  '--find-copies',
  '--diff-filter=ACDMRTUXB',
];
const untrackedArgs = ['ls-files', '--others', '--exclude-standard', '-z'];
```

`parseNameStatusZ` must read one path for normal statuses and two for `R*`/`C*`; malformed or missing
tokens throw. Normalize `\\` to `/`, remove one leading `./`, preserve internal spaces, deduplicate
records, and sort flattened files. Synthesize untracked records as `{ status: '?', paths: [path] }`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
node --test scripts/check/affected-check-lib.test.mjs
```

Expected: PASS, including the existing affected-plan cases.

- [ ] **Step 5: Commit the record collector**

```bash
git add scripts/check/affected-check-lib.mjs scripts/check/affected-check-lib.test.mjs
git commit -m "test(ci): preserve complete changed-file records"
```

### Task 2: Conservative Hosted CI Scope Projection

**Files:**

- Modify: `scripts/check/affected-check-lib.mjs`
- Modify: `scripts/check/affected-check-lib.test.mjs`

**Interfaces:**

- Consumes: `ChangedFileRecord[]`, `readWorkspacePackages(...)`, and transitive dependent expansion.
- Produces: `buildCiScopeDecision({ changedFileRecords, workspacePackages }) -> CiScopeDecision`.
- Decision shape:

```js
{
  runtime: boolean,
  integration: boolean,
  backend_db_worker: boolean,
  telegram: boolean,
  docs_only: boolean,
  changedFiles: string[],
  affectedPackages: string[],
  reasons: Array<{ code: string, scope: string, subject: string }>,
}
```

- [ ] **Step 1: Add table-driven scope fixtures and invariants**

Add exact expected booleans for:

```js
const workspacePackages = [
  pkg('@esl-pipeline/contracts', 'packages/contracts', []),
  pkg('@esl-pipeline/shared-infrastructure', 'packages/shared-infrastructure', [
    '@esl-pipeline/contracts',
  ]),
  pkg('@esl-pipeline/batch-backend', 'packages/batch-backend', [
    '@esl-pipeline/contracts',
    '@esl-pipeline/shared-infrastructure',
  ]),
  pkg('@esl-pipeline/batch-frontend', 'packages/batch-frontend', ['@esl-pipeline/contracts']),
  pkg('@esl-pipeline/telegram-ops-bot', 'packages/telegram-ops-bot', [
    '@esl-pipeline/contracts',
    '@esl-pipeline/shared-infrastructure',
  ]),
];

const scopeCases = [
  [
    'docs only',
    records('M', 'docs/reference/TESTING_GUIDELINES.md'),
    [false, false, false, false, true],
  ],
  [
    'frontend',
    records('M', 'packages/batch-frontend/src/main.tsx'),
    [true, true, false, false, false],
  ],
  [
    'deleted migration',
    records('D', 'packages/batch-backend/migrations/0042.sql'),
    [true, true, true, false, false],
  ],
  [
    'backend repository test',
    records('M', 'packages/batch-backend/tests/domain.job-repository.test.ts'),
    [true, true, true, false, false],
  ],
  [
    'worker fixture',
    records('M', 'packages/batch-backend/tests/transport.worker-runner.integration.test.ts'),
    [true, true, true, false, false],
  ],
  [
    'telegram',
    records('M', 'packages/telegram-ops-bot/src/index.ts'),
    [true, true, false, true, false],
  ],
  ['contracts', records('M', 'packages/contracts/src/index.ts'), [true, true, true, true, false]],
  [
    'shared infrastructure',
    records('M', 'packages/shared-infrastructure/src/index.ts'),
    [true, true, true, true, false],
  ],
  ['workflow', records('M', '.github/workflows/ci.yml'), [true, true, true, true, false]],
  ['unknown', records('A', 'unexpected-root.file'), [true, true, true, true, false]],
];

function records(status, ...paths) {
  return [{ status, paths }];
}

for (const [name, changedFileRecords, expected] of scopeCases) {
  test(`CI scope: ${name}`, () => {
    const decision = buildCiScopeDecision({ changedFileRecords, workspacePackages });
    assert.deepEqual(
      [
        decision.runtime,
        decision.integration,
        decision.backend_db_worker,
        decision.telegram,
        decision.docs_only,
      ],
      expected,
    );
  });
}
```

Also add tests for empty records, mixed docs/runtime, runtime-to-docs and docs-to-runtime renames,
Windows separators, duplicate/order normalization, `docs_only` exclusivity, unknown safety, and
monotonicity by asserting that adding any second record never changes a `true` blocking scope to
`false`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test scripts/check/affected-check-lib.test.mjs
```

Expected: FAIL because `buildCiScopeDecision` does not exist.

- [ ] **Step 3: Implement the pure projection with structured reason codes**

Use these locked rules:

```js
const blockingScopes = ['runtime', 'integration', 'backend_db_worker', 'telegram'];
const sharedHighRiskPackages = new Set([
  '@esl-pipeline/contracts',
  '@esl-pipeline/shared-infrastructure',
]);
```

- Empty records return all blocking scopes true with reason `empty-diff`.
- Any unclassified root path or broad fallback path returns all true with `unknown-path` or
  `root-toolchain`.
- Docs-only means at least one path and every old/new path is `AGENTS.md`, `docs/**`, or
  `.github/pull_request_template.md`.
- Runtime is true for any affected workspace package or Docker/deploy/smoke runtime path.
- Integration is true whenever runtime is true in this first conservative slice.
- DB/worker is true for contracts/shared infrastructure, migrations/schema, backend
  `src/infrastructure/**`, worker/queue/process-job sources, the explicit DB/worker test files named
  in `packages/batch-backend/package.json`, and `tests/support/**` Postgres/Redis bootstrap helpers.
- Telegram is true when reverse dependent expansion includes `@esl-pipeline/telegram-ops-bot`, or
  for Telegram package, Compose, deploy, or Telegram smoke paths.
- Reasons are deduplicated objects with stable codes; formatted prose is not stored in the decision.

- [ ] **Step 4: Run the focused tests and verify GREEN**

```bash
node --test scripts/check/affected-check-lib.test.mjs
```

Expected: PASS for examples and all invariants.

- [ ] **Step 5: Commit the scope projection**

```bash
git add scripts/check/affected-check-lib.mjs scripts/check/affected-check-lib.test.mjs
git commit -m "feat(ci): classify conservative hosted scopes"
```

### Task 3: Hosted Scope CLI and Dual Local Preview

**Files:**

- Create: `scripts/check/run-ci-scope.mjs`
- Create: `scripts/check/run-ci-scope.test.mjs`
- Modify: `scripts/check/run-affected-check.mjs`
- Modify: `scripts/check/affected-check-lib.mjs`
- Modify: `package.json`

**Interfaces:**

- Produces from `affected-check-lib.mjs`: `formatCiScopeSummary(decision) -> string`,
  `formatCiScopeGithubOutputs(decision) -> string`, and
  `formatScopePreview({ planText, hostedDecision, uncommittedFiles }) -> string`.
- `formatCiScopeGithubOutputs` contains only five `name=true|false` lines.
- CLI: `node scripts/check/run-ci-scope.mjs --from BASE_SHA --to HEAD_SHA --github-output GITHUB_OUTPUT_PATH --github-summary GITHUB_STEP_SUMMARY_PATH`.
- Package command: `pnpm test:check-routing` runs all `scripts/check/*.test.mjs` files.

- [ ] **Step 1: Write RED tests for CLI-safe output and dual preview text**

Create `run-ci-scope.test.mjs` with assertions equivalent to:

```js
test('GitHub outputs are single-line lowercase booleans only', () => {
  assert.equal(
    formatCiScopeGithubOutputs({
      runtime: true,
      integration: false,
      backend_db_worker: false,
      telegram: false,
      docs_only: false,
    }),
    'runtime=true\nintegration=false\nbackend_db_worker=false\ntelegram=false\ndocs_only=false\n',
  );
});

test('scope summary renders structured reasons without exporting prose', () => {
  assert.match(
    formatCiScopeSummary({
      runtime: true,
      integration: true,
      backend_db_worker: false,
      telegram: false,
      docs_only: false,
      changedFiles: ['packages/batch-frontend/src/main.tsx'],
      affectedPackages: ['@esl-pipeline/batch-frontend'],
      reasons: [
        { code: 'affected-package', scope: 'runtime', subject: '@esl-pipeline/batch-frontend' },
      ],
    }),
    /affected-package.*@esl-pipeline\/batch-frontend/u,
  );
});

test('dual preview keeps uncommitted paths out of hosted scope', () => {
  const text = formatScopePreview({
    planText: 'Local plan',
    hostedDecision: docsDecision,
    uncommittedFiles: ['scratch.ts'],
  });
  assert.match(text, /Local validation scope/u);
  assert.match(text, /Hosted CI preview/u);
  assert.match(text, /excludes 1 uncommitted path/u);
});
```

Extend the affected dry-run test surface so formatted output contains both headings:

```text
Local validation scope
Hosted CI preview
Hosted preview excludes 1 uncommitted path
```

- [ ] **Step 2: Run routing tests and verify RED**

```bash
node --test scripts/check/affected-check-lib.test.mjs scripts/check/run-ci-scope.test.mjs
```

Expected: FAIL because the CLI and formatters do not exist.

- [ ] **Step 3: Implement the CLI and preview integration**

The CLI must:

1. Require `--from` and `--to`; keep formatting helpers in `affected-check-lib.mjs` so importing them
   in tests never executes CLI side effects.
2. Run
   `git diff --name-status -z --find-renames --find-copies --diff-filter=ACDMRTUXB BASE_SHA...HEAD_SHA`.
3. Parse records, read workspace packages, and build the pure decision.
4. Print the readable summary.
5. Append machine output only to the explicit `--github-output` path.
6. Append readable Markdown only to the explicit `--github-summary` path.
7. Exit non-zero for missing arguments, malformed Git records, Git failure, or an empty committed
   diff.

Update `run-affected-check.mjs` to call `collectChangedFileScopes`, retain `localFiles` for the local
plan, and append hosted scope built only from `hostedRecords` during `--dry-run`. Report the count of
`uncommittedFiles` without including those paths in hosted scope.

Add:

```json
"test:check-routing": "node --test scripts/check/*.test.mjs"
```

- [ ] **Step 4: Run routing tests and dry-run smoke**

```bash
pnpm test:check-routing
pnpm check:fast:dry-run
```

Expected: tests PASS. Dry-run may exit `1` on this branch because workflow/toolchain scope correctly
falls back broad, but it must print distinct local and hosted sections and a conservative reason.

- [ ] **Step 5: Commit the CLI and preview**

```bash
git add package.json scripts/check/affected-check-lib.mjs scripts/check/run-affected-check.mjs scripts/check/run-ci-scope.mjs scripts/check/run-ci-scope.test.mjs
git commit -m "feat(ci): preview local and hosted validation scopes"
```

### Task 4: Workflow Contract Tests and Exact Gate Evaluator

**Files:**

- Create: `scripts/check/ci-workflow-structure.test.mjs`
- Modify: `package.json`

**Interfaces:**

- Consumes in this task: `.github/workflows/ci.yml` as text; Task 6 extends the same test to the
  diagnostics workflow.
- Executes: exact inline JavaScript between `# ci-gate-evaluator:start` and
  `# ci-gate-evaluator:end` markers.
- Requires no YAML parser dependency.

- [ ] **Step 1: Write structural and gate truth-table tests before workflow edits**

Create tests that assert:

```js
assert.match(ci, /^  change-scope:/mu);
assert.match(ci, /^  ci-gate:/mu);
assert.match(ci, /if: \$\{\{ always\(\) \}\}/u);
assert.doesNotMatch(ci, /if: \$\{\{ needs\.change-scope\.outputs\.[a-z_]+ \}\}/u);
for (const job of ['integration-tests', 'backend-db-integration', 'telegram-compose-smoke']) {
  assertJobNeedsChangeScopeAndUsesExplicitBoolean(ci, job);
  assertGateNeedsJob(ci, job);
}
assertBootstrapScriptDoesNotMention(ci, ['run-ci-scope', 'affected-check-lib']);
```

Extract the exact gate script from the markers and run it through `node -e` with environment fixtures
for:

- all selected lanes succeeding: exit `0`;
- classifier failure: exit non-zero;
- static failure: exit non-zero;
- selected integration failure: exit non-zero;
- selected lane unexpectedly skipped: exit non-zero;
- unselected lane skipped: exit `0`;
- any cancelled dependency: exit non-zero.

- [ ] **Step 2: Run the structural test and verify RED**

```bash
node --test scripts/check/ci-workflow-structure.test.mjs
```

Expected: FAIL because `change-scope` and `ci-gate` do not exist.

- [ ] **Step 3: Add the new test to the deterministic routing command**

Confirm `pnpm test:check-routing` includes the new file through the existing glob. Do not add a
second script or another test runner.

- [ ] **Step 4: Commit the RED workflow contract**

```bash
git add scripts/check/ci-workflow-structure.test.mjs package.json
git commit -m "test(ci): lock scoped workflow topology"
```

### Task 5: Scoped PR Workflow and Aggregate Gate

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/check/ci-workflow-structure.test.mjs` only if test extraction needs a mechanical
  correction without weakening assertions.

**Interfaces:**

- Consumes: `run-ci-scope.mjs` outputs `runtime`, `integration`, `backend_db_worker`, `telegram`, and
  `docs_only`.
- Produces: stable job `CI gate` as canonical aggregate status.

- [ ] **Step 1: Add the dependency-free `change-scope` job**

The job must use full checkout history, pinned `actions/setup-node` with `.nvmrc`, no pnpm install,
and these three steps after checkout/setup:

1. `bootstrap` uses this independent Bash shape and does not invoke Node classifier files:

```yaml
- name: Bootstrap conservative scope
  id: bootstrap
  shell: bash
  env:
    BASE_SHA: ${{ github.event.pull_request.base.sha }}
    HEAD_SHA: ${{ github.event.pull_request.head.sha }}
  run: |
    set -euo pipefail
    force_all=false
    # ci-bootstrap:start
    while IFS= read -r -d '' status; do
      path_count=1
      if [[ "$status" == R* || "$status" == C* ]]; then
        path_count=2
      fi
      for ((index = 0; index < path_count; index += 1)); do
        IFS= read -r -d '' changed_path
        case "$changed_path" in
          .github/workflows/*|scripts/check/*|.nvmrc|package.json|pnpm-lock.yaml|pnpm-workspace.yaml|turbo.json|biome.json|eslint.config.*|vitest.config.*|tsconfig*.json)
            force_all=true
            ;;
        esac
      done
    done < <(git diff --name-status -z --find-renames --find-copies --diff-filter=ACDMRTUXB "$BASE_SHA...$HEAD_SHA")
    # ci-bootstrap:end
    echo "force_all=$force_all" >> "$GITHUB_OUTPUT"
```

2. `projection` runs:

```bash
node scripts/check/run-ci-scope.mjs \
  --from "$BASE_SHA" \
  --to "$HEAD_SHA" \
  --github-output "$GITHUB_OUTPUT" \
  --github-summary "$GITHUB_STEP_SUMMARY"
```

3. `combine` writes final job outputs with this exact OR behavior:

```yaml
- name: Combine bootstrap and projection
  id: scope
  shell: bash
  env:
    FORCE_ALL: ${{ steps.bootstrap.outputs.force_all }}
    RUNTIME: ${{ steps.projection.outputs.runtime }}
    INTEGRATION: ${{ steps.projection.outputs.integration }}
    BACKEND_DB_WORKER: ${{ steps.projection.outputs.backend_db_worker }}
    TELEGRAM: ${{ steps.projection.outputs.telegram }}
    DOCS_ONLY: ${{ steps.projection.outputs.docs_only }}
  run: |
    set -euo pipefail
    if [[ "$FORCE_ALL" == true ]]; then
      printf '%s\n' runtime=true integration=true backend_db_worker=true telegram=true docs_only=false >> "$GITHUB_OUTPUT"
    else
      printf '%s\n' \
        "runtime=$RUNTIME" \
        "integration=$INTEGRATION" \
        "backend_db_worker=$BACKEND_DB_WORKER" \
        "telegram=$TELEGRAM" \
        "docs_only=$DOCS_ONLY" >> "$GITHUB_OUTPUT"
    fi
```

Job outputs reference `steps.scope.outputs.*`, never the raw projection step.

Use `github.event.pull_request.base.sha` and `github.event.pull_request.head.sha`, not working-tree
status, for both bootstrap and projection.

- [ ] **Step 2: Wire explicit conditions without weakening selected lanes**

- Add `needs: change-scope` to `static-checks`; keep the job unconditional after a successful scope
  job.
- Add `if: ${{ fromJSON(needs.change-scope.outputs.runtime) }}` only to Build, Typecheck, Lint, and
  Unit tests inside static checks.
- Leave environment validation, hygiene tools/checks, contract guard, orchestrator guard, and docs
  checks always-run inside static checks.
- Add `needs: change-scope` and `if: ${{ fromJSON(needs.change-scope.outputs.integration) }}` to the
  general integration job.
- Add the equivalent explicit conditions for `backend_db_worker` and `telegram`.
- Keep all existing test commands, services, timeouts, permissions, and artifacts unchanged.
- Remove coverage and timing jobs completely from `ci.yml`; Task 6 restores them in diagnostics.

- [ ] **Step 3: Add the checkout-free aggregate gate**

Add a job named `CI gate` with `if: ${{ always() }}`, all five required `needs`, and no checkout or
setup. Pass valid JSON through environment values:

```yaml
env:
  CI_RESULTS: >-
    {"change-scope":"${{ needs.change-scope.result }}","static-checks":"${{ needs.static-checks.result }}","integration-tests":"${{ needs.integration-tests.result }}","backend-db-integration":"${{ needs.backend-db-integration.result }}","telegram-compose-smoke":"${{ needs.telegram-compose-smoke.result }}"}
  CI_SCOPES: >-
    {"integration":"${{ needs.change-scope.outputs.integration }}","backend_db_worker":"${{ needs.change-scope.outputs.backend_db_worker }}","telegram":"${{ needs.change-scope.outputs.telegram }}"}
```

Embed the marked Node evaluator using `JSON.parse(process.env.CI_RESULTS)` and
`JSON.parse(process.env.CI_SCOPES)`. Its exact logic between the markers is:

```js
// ci-gate-evaluator:start
const results = JSON.parse(process.env.CI_RESULTS);
const scopes = JSON.parse(process.env.CI_SCOPES);
const required = ['change-scope', 'static-checks'];
const conditional = {
  'integration-tests': 'integration',
  'backend-db-integration': 'backend_db_worker',
  'telegram-compose-smoke': 'telegram',
};
const failures = [];
for (const job of required) {
  if (results[job] !== 'success') failures.push(`${job}:${results[job]}`);
}
for (const [job, scope] of Object.entries(conditional)) {
  const selected = scopes[scope] === 'true';
  const result = results[job];
  if (selected ? result !== 'success' : !['success', 'skipped'].includes(result)) {
    failures.push(`${job}:${result}:selected=${selected}`);
  }
}
if (failures.length > 0) {
  console.error(`CI gate failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('CI gate passed');
// ci-gate-evaluator:end
```

- [ ] **Step 4: Run workflow and gate tests**

```bash
pnpm test:check-routing
pnpm run lint:workflows
```

Expected: PASS for structural conditions, bootstrap independence, every gate truth-table case, and
actionlint.

- [ ] **Step 5: Commit scoped PR CI**

```bash
git add .github/workflows/ci.yml scripts/check/ci-workflow-structure.test.mjs
git commit -m "ci: scope pull request validation lanes"
```

### Task 6: Honest Weekly and Manual Diagnostics

**Files:**

- Create: `.github/workflows/ci-diagnostics.yml`
- Modify: `scripts/check/ci-workflow-structure.test.mjs` only for exact workflow-name fixtures.

**Interfaces:**

- Trigger: Monday 05:17 UTC (`17 5 * * 1`) and `workflow_dispatch`.
- Produces: existing `tmp/coverage` and `tmp/test-timings` artifacts.

- [ ] **Step 1: Extend the structural test with the diagnostics contract**

Add assertions requiring `schedule`, `workflow_dispatch`, producer step IDs, `if: always()` on
report/upload/final steps, absence of `continue-on-error`, and the existing report/artifact paths.

- [ ] **Step 2: Run the diagnostics contract and verify RED**

```bash
node --test scripts/check/ci-workflow-structure.test.mjs
```

Expected: FAIL because `.github/workflows/ci-diagnostics.yml` does not exist.

- [ ] **Step 3: Create the diagnostics workflow from the removed PR jobs**

Use read-only contents permission and parallel `coverage-report` and `unit-timings` jobs. Preserve
pinned action SHAs and setup/install steps. The coverage tail is:

```yaml
- name: Run core unit coverage
  id: producer
  run: pnpm test:coverage:core

- name: Generate coverage report
  if: ${{ always() }}
  run: pnpm test:coverage:report

- name: Upload coverage report artifact
  if: ${{ always() }}
  uses: actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f
  with:
    name: coverage-report
    path: tmp/coverage
    if-no-files-found: warn

- name: Fail when producer failed
  if: ${{ always() }}
  env:
    PRODUCER_OUTCOME: ${{ steps.producer.outcome }}
  run: test "$PRODUCER_OUTCOME" = success
```

The timing tail is:

```yaml
- name: Run unit timings
  id: producer
  run: pnpm test:timings:unit

- name: Generate unit timing report
  if: ${{ always() }}
  run: pnpm test:timings:report

- name: Upload unit timing artifact
  if: ${{ always() }}
  uses: actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f
  with:
    name: unit-timings
    path: tmp/test-timings
    if-no-files-found: warn

- name: Fail when producer failed
  if: ${{ always() }}
  env:
    PRODUCER_OUTCOME: ${{ steps.producer.outcome }}
  run: test "$PRODUCER_OUTCOME" = success
```

Do not use job-level or step-level `continue-on-error`.

- [ ] **Step 4: Run workflow tests and actionlint**

```bash
pnpm test:check-routing
pnpm run lint:workflows
```

Expected: PASS; tests confirm honest failure and preserved artifact commands.

- [ ] **Step 5: Commit scheduled diagnostics**

```bash
git add .github/workflows/ci-diagnostics.yml scripts/check/ci-workflow-structure.test.mjs
git commit -m "ci: schedule coverage and timing diagnostics"
```

### Task 7: Synchronize Local Gate and CI Topology Guidance

**Files:**

- Modify: `AGENTS.md`
- Modify: `docs/reference/agents-ssot.md`
- Modify: `docs/reference/TESTING_GUIDELINES.md`

**Interfaces:**

- Documents commands and names implemented in Tasks 3–6.
- Does not change runtime behavior.

- [ ] **Step 1: Update local validation wording to be mutually substitutive**

Use this contract in all three documents at their appropriate level of detail:

```text
Choose one normal pre-push gate after focused tests:
- use check:fast:agent by default;
- use check:pre-pr directly when the branch is already broad, cross-cutting, shared-contract, or toolchain-level;
- a check:fast:agent fallback to check:pre-pr satisfies the broad gate;
- a successful full check subsumes both narrower gates;
- clearly docs-only work may use the documented docs-specific lanes.
```

Document that `check:fast:dry-run` prints local working-tree scope and committed hosted preview
separately.

- [ ] **Step 2: Update canonical CI check names**

List:

```text
CI gate
static checks (node 24.x)
integration lane (blocking)
backend db + worker integration (blocking)
telegram command-loop compose smoke
```

State that `CI gate` is the canonical aggregate status and future required check when repository plan
capabilities permit branch protection.

- [ ] **Step 3: Format and validate docs**

```bash
pnpm format:write
pnpm format
pnpm docs:check
```

Expected: all commands exit `0`.

- [ ] **Step 4: Commit guidance**

```bash
git add AGENTS.md docs/reference/agents-ssot.md docs/reference/TESTING_GUIDELINES.md
git commit -m "docs(ci): clarify substitutive local validation gates"
```

### Task 8: Combined Verification and Review Gate

**Files:**

- Verify all files from Tasks 1–7.
- Do not modify unrelated files to make broad checks green.

**Interfaces:**

- Confirms the approved design and implementation plan are satisfied.

- [ ] **Step 1: Run the focused routing and workflow suite**

```bash
pnpm test:check-routing
pnpm run lint:workflows
pnpm run lint:shell
pnpm docs:check
pnpm format
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 2: Inspect representative dry-run projections**

Run the real branch preview:

```bash
pnpm check:fast:dry-run
```

Expected: workflow/classifier changes select every blocking hosted scope through the bootstrap/broad
rules; local and hosted headings are distinct.

Run focused unit fixtures for docs-only and runtime cases through `pnpm test:check-routing`; do not
manufacture or temporarily hide branch changes to make the real preview narrow.

- [ ] **Step 3: Run the one appropriate broad pre-push gate**

This branch is known toolchain/workflow work, so invoke the broad gate directly rather than running
affected and then repeating its fallback:

```bash
pnpm check:pre-pr
```

Expected: exit `0`. If it fails, use the reported package/test evidence; do not weaken routing or
test assertions. Run `pnpm check` only if diagnosis shows DB/worker/integration behavior is implicated.

- [ ] **Step 4: Review the complete diff against the spec**

Verify explicitly:

- every spec acceptance criterion maps to a passing test;
- PR CI contains no coverage/timing jobs;
- diagnostics preserve reports and fail honestly;
- gate has no checkout/setup and uses `always()`;
- bootstrap does not import classifier logic;
- deleted/renamed files and unknown scope widen safely;
- local preview excludes uncommitted files from hosted scope;
- no unrelated generated/local artifacts are staged.

## Handoff Boundary

- This plan ends with a validated branch. Push/PR creation follows the repository’s normal
  `release:patch` process only after the user selects an execution mode and implementation completes.
- Do not implement static-test sharding, release concurrency changes, or image-build parallelism in
  this plan.
- Record real PR skip rates and job durations before opening the follow-up optimization design.
