# Tooling System Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Inline execution is preferred;
> this cleanup does not benefit from a large agent-orchestration workflow.

**Goal:** Remove obsolete repository tooling, establish one complete tooling-test lane, activate
portable Hadolint enforcement, and harden the small CI/docs-workflow seams identified in the tooling
review.

**Architecture:** A structural Node test locks the canonical command/file surface. One root
`test:tooling` command runs every script-level test and is always exercised locally and in CI. A
small injectable Node runner discovers tracked Dockerfiles and invokes the official digest-pinned
Hadolint image through Docker without a shell. Existing workflow structure tests protect CI tool
bootstrap, artifact retention, concurrency, and docs-gardening behavior.

**Tech Stack:** Node.js 24, pnpm 11, Node test runner, Git, Docker, Hadolint v2.14.0, dclint,
GitHub Actions, Actionlint, ShellCheck, Markdown/YAML.

## Global Constraints

- Do not change application, contract, database, environment, deployment, or image-build behavior.
- Delete only the explicitly inventoried dead files and aliases; preserve operational and focused
  diagnostic commands.
- Do not weaken dependency auditing, workflow linting, shell linting, Compose linting, or package
  tests.
- Hadolint must use the approved tag+digest, a read-only repository mount, an argument-array child
  process, and all tracked `Dockerfile*` paths.
- Missing Docker or Hadolint findings must fail honestly; no skip-on-unavailable behavior.
- Keep `DL3018` ignored with an explanatory comment; changing Alpine package pinning is out of scope.
- Structural tests must assert behavior without requiring Docker, network access, Actionlint, or
  ShellCheck.
- Do not rewrite archived plans merely because they mention a retired historical command.
- Use Conventional Commits and keep the implementation in one `release:patch` PR with no deployment.

## File and Responsibility Map

- `package.json` — canonical commands, tooling-test integration, and removed aliases.
- `scripts/check/tooling-surface.test.mjs` — retired/canonical surface and root test topology.
- `scripts/check/ci-workflow-structure.test.mjs` — static CI bootstrap, tooling, retention, and
  diagnostics structure.
- `scripts/docs/docs-gardening-workflow.test.mjs` — gardening artifact, retention, and pagination
  structure.
- `scripts/docker/run-hadolint.mjs` — tracked-Dockerfile discovery and portable container runner.
- `scripts/docker/run-hadolint.test.mjs` — pure parsing, invocation, and failure tests.
- `.hadolint.yaml` — current Alpine package-version policy explanation.
- `.github/workflows/ci.yml` — tooling tests, Docker lint, verified Actionlint bootstrap, and failure
  artifact retention.
- `.github/workflows/ci-diagnostics.yml` — concurrency and scheduled artifact retention.
- `.github/workflows/docs-gardening.yml` — complete artifact set, retention, and paginated issue
  lookup.
- `AGENTS.md` — concise root tooling and Docker lint command routing.
- `docs/reference/TESTING_GUIDELINES.md` — complete root tooling lane and canonical timing command.
- `docs/reference/REPO_HYGIENE_LINTING.md` — current blocking lint topology and containerized
  Hadolint policy.
- `docs/reference/DOCS_GARDENING_PLAYBOOK.md` — current workflow artifact and retention behavior.
- `.impeccable/critique/*.md` — two already-ignored historical tracked artifacts to remove.

## Files Retired by This Plan

- `scripts/deps/safe-upgrade.mjs`
- `scripts/deps/pin-shared-deps.mjs`
- `scripts/deps/README.md`
- `scripts/check/run-agent-check-fast.mjs`
- `scripts/test/run-agent-vitest.mjs`
- `scripts/docker/prepare-host-paths.sh`
- `scripts/setup-agent-env.sh`
- `scripts/git/gh-auth-from-env.sh`
- `.impeccable/critique/2026-05-26T19-37-03Z__packages-batch-frontend-src-ui.md`
- `.impeccable/critique/2026-05-26T20-12-54Z__packages-batch-frontend-src-ui.md`

---

### Task 1: Lock and Prune the Canonical Tooling Surface

**Files:**

- Create: `scripts/check/tooling-surface.test.mjs`
- Modify: `package.json`
- Delete: every tool file listed under **Files Retired by This Plan**, except the two `.impeccable`
  files, which are removed in Task 6.

- [ ] **Step 1: Add a structural RED test for retired files and aliases**

Create `scripts/check/tooling-surface.test.mjs` with the equivalent contract:

```js
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

const retiredFiles = [
  'scripts/deps/safe-upgrade.mjs',
  'scripts/deps/pin-shared-deps.mjs',
  'scripts/deps/README.md',
  'scripts/check/run-agent-check-fast.mjs',
  'scripts/test/run-agent-vitest.mjs',
  'scripts/docker/prepare-host-paths.sh',
  'scripts/setup-agent-env.sh',
  'scripts/git/gh-auth-from-env.sh',
];

const retiredScripts = [
  'deps:check',
  'deps:pin',
  'deps:upgrade:safe',
  'docker:backup',
  'docker:dev',
  'docker:dev:build',
  'docs:gardening',
  'hadolint',
  'smoke',
  'test:env',
  'test:timings:frontend',
  'test:topo',
];

test('retired tooling files and aliases stay absent', () => {
  for (const file of retiredFiles) {
    assert.equal(existsSync(new URL(file, root)), false, file);
  }
  for (const script of retiredScripts) {
    assert.equal(pkg.scripts[script], undefined, script);
  }
});

test('canonical replacements remain available', () => {
  for (const script of [
    'deps:audit',
    'deps:audit:strict',
    'docker:db:backup',
    'docker:up',
    'docker:up:build',
    'docs:garden',
    'test:check-routing',
    'test:timings:unit',
  ]) {
    assert.equal(typeof pkg.scripts[script], 'string', script);
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test scripts/check/tooling-surface.test.mjs
```

Expected: FAIL, listing the existing retired files and/or script keys.

- [ ] **Step 3: Remove the obsolete scripts, wrappers, helpers, and aliases**

Delete the eight retired tool files. Remove the twelve retired root script keys. Do not alter the
surviving libraries, lane runner, `.mjs` host-path implementation, dependency audit commands, or
specialized `docker:dev:*` commands.

- [ ] **Step 4: Search active sources for stale callers**

Run:

```bash
rg -n "safe-upgrade|pin-shared-deps|run-agent-check-fast|run-agent-vitest|prepare-host-paths\\.sh|setup-agent-env\\.sh|gh-auth-from-env|deps:check|deps:pin|deps:upgrade:safe|docker:backup|docker:dev:build|docs:gardening|test:timings:frontend|test:topo|test:env" --glob '!docs/archive/**' --glob '!docs/superpowers/**' .
```

Expected: no active references. Matches in the new structural test are expected and should be
excluded or inspected rather than deleted.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
node --test scripts/check/tooling-surface.test.mjs
pnpm test:check-routing
```

Expected: PASS.

- [ ] **Step 6: Commit the tooling-surface cleanup**

```bash
git add package.json scripts/check/tooling-surface.test.mjs scripts/deps scripts/check/run-agent-check-fast.mjs scripts/test/run-agent-vitest.mjs scripts/docker/prepare-host-paths.sh scripts/setup-agent-env.sh scripts/git/gh-auth-from-env.sh
git commit -m "chore(tooling): remove obsolete command surface"
```

---

### Task 2: Establish the Complete Root Tooling-Test Lane

**Files:**

- Modify: `scripts/check/tooling-surface.test.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Extend the structural test with RED topology assertions**

Read `.github/workflows/ci.yml` and add:

```js
const ci = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8');

test('the complete tooling suite is a local and hosted guard', () => {
  assert.equal(pkg.scripts['test:tooling'], 'node --test "scripts/**/*.test.mjs"');
  assert.match(pkg.scripts.check, /pnpm test:tooling/u);
  assert.match(pkg.scripts['check:pre-pr'], /pnpm test:tooling/u);
  assert.match(ci, /- name: Tooling tests\n\s+run: pnpm test:tooling/u);
});

test('docker lint composes the canonical compose and Dockerfile lanes', () => {
  assert.equal(
    pkg.scripts['docker:lint'],
    'pnpm docker:lint:compose && pnpm docker:lint:dockerfiles',
  );
  assert.equal(
    pkg.scripts['docker:lint:compose'],
    'dclint docker-compose.yml docker-compose.prod.yml --max-warnings 0',
  );
  assert.equal(
    pkg.scripts['docker:lint:compose:fix'],
    'dclint docker-compose.yml docker-compose.prod.yml --fix',
  );
  assert.equal(pkg.scripts['docker:lint:dockerfiles'], 'node scripts/docker/run-hadolint.mjs');
});
```

Add the Docker-lint assertion during Task 3 as the next RED contract; do not weaken its exact script
strings.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test scripts/check/tooling-surface.test.mjs
```

Expected: FAIL because `test:tooling` and its three integrations do not exist.

- [ ] **Step 3: Add and integrate `test:tooling`**

Add:

```json
"test:tooling": "node --test \"scripts/**/*.test.mjs\""
```

Make `test:tooling` an explicit command in both `check` and `check:pre-pr`. In the static CI job,
add an unconditional step after installation/environment validation and before conditional package
build/test work:

```yaml
- name: Tooling tests
  run: pnpm test:tooling
```

Do not condition this step on `runtime`; root automation is part of the always-run trust boundary.

- [ ] **Step 4: Run the complete lane and verify GREEN**

Run:

```bash
node --test scripts/check/tooling-surface.test.mjs
pnpm test:tooling
```

Expected: PASS. The existing baseline is 86 tests; the new structural tests increase that count.

- [ ] **Step 5: Commit the tooling-test topology**

```bash
git add package.json .github/workflows/ci.yml scripts/check/tooling-surface.test.mjs
git commit -m "test(tooling): add complete root validation lane"
```

---

### Task 3: Activate Portable Hadolint Enforcement

**Files:**

- Create: `scripts/docker/run-hadolint.mjs`
- Create: `scripts/docker/run-hadolint.test.mjs`
- Modify: `package.json`
- Modify: `.hadolint.yaml`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- `HADOLINT_IMAGE` — exact approved tag+digest string.
- `parseNullDelimitedPaths(value) -> string[]` — path-preserving, sorted, unique tracked paths with
  only an optional leading `./` removed.
- `buildGitDiscoveryInvocation({ repoRoot }) -> { command, args, options }` — exact shell-free Git
  discovery contract.
- `buildHadolintInvocation({ repoRoot, dockerfiles }) -> { command, args }`.
- `runHadolint({ repoRoot, executeGit, spawn, log }) -> number` — injectable orchestration returning
  the child exit status or throwing on process startup/discovery errors.

- [ ] **Step 1: Write parser and invocation RED tests**

Create `scripts/docker/run-hadolint.test.mjs` with cases equivalent to:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HADOLINT_IMAGE,
  buildGitDiscoveryInvocation,
  buildHadolintInvocation,
  parseNullDelimitedPaths,
  runHadolint,
} from './run-hadolint.mjs';

test('tracked Dockerfile parsing removes leading dot segments, deduplicates, and sorts paths', () => {
  assert.deepEqual(
    parseNullDelimitedPaths(
      'packages\\orchestrator\\Dockerfile\0packages/batch-backend/Dockerfile.dev\0packages/orchestrator/Dockerfile\0',
    ),
    ['packages/batch-backend/Dockerfile.dev', 'packages/orchestrator/Dockerfile'],
  );
});

test('discovery runs Git from the repository root without a shell', () => {
  assert.deepEqual(buildGitDiscoveryInvocation({ repoRoot: 'D:\\code\\esl-pipeline' }), {
    command: 'git',
    args: ['ls-files', '-z', '--', ':(glob)**/Dockerfile*'],
    options: {
      cwd: 'D:\\code\\esl-pipeline',
      encoding: 'utf8',
      shell: false,
    },
  });
});

test('invocation uses the pinned image and a read-only repository mount', () => {
  assert.equal(
    HADOLINT_IMAGE,
    'ghcr.io/hadolint/hadolint:v2.14.0@sha256:27086352fd5e1907ea2b934eb1023f217c5ae087992eb59fde121dce9c9ff21e',
  );
  const invocation = buildHadolintInvocation({
    repoRoot: 'D:\\code\\esl-pipeline',
    dockerfiles: ['packages/orchestrator/Dockerfile'],
  });

  assert.equal(invocation.command, 'docker');
  assert.deepEqual(invocation.args.slice(0, 2), ['run', '--rm']);
  assert.ok(
    invocation.args.includes('type=bind,source=D:\\code\\esl-pipeline,target=/workspace,readonly'),
  );
  assert.ok(invocation.args.includes('/bin/hadolint'));
  assert.ok(invocation.args.includes('--config'));
  assert.ok(invocation.args.includes('.hadolint.yaml'));
  assert.ok(invocation.args.includes('packages/orchestrator/Dockerfile'));
});

test('runner fails on empty discovery and propagates lint status', () => {
  assert.throws(
    () =>
      runHadolint({
        repoRoot: '/repo',
        executeGit: () => ({ status: 0, stdout: '' }),
        spawn: () => ({ status: 0 }),
        log: () => {},
      }),
    /No tracked Dockerfiles/u,
  );
  assert.equal(
    runHadolint({
      repoRoot: '/repo',
      executeGit: () => ({ status: 0, stdout: 'Dockerfile\0' }),
      spawn: () => ({ status: 7 }),
      log: () => {},
    }),
    7,
  );
});
```

Also assert that malformed/truncated null-delimited output is rejected, Git receives the exact
command/arguments/options above, Docker spawn options are `{ shell: false, stdio: 'inherit' }`,
startup errors throw, every discovered path appears after the Hadolint options, and the injected
logger receives a deterministic count/path summary before Docker runs. Add a CLI-level child-process
test proving a startup error produces one controlled message and a non-zero exit without a stack
trace.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test scripts/docker/run-hadolint.test.mjs
```

Expected: FAIL because `run-hadolint.mjs` does not exist.

- [ ] **Step 3: Implement the injectable container runner**

Implement the exports and CLI entrypoint. Default discovery must execute, without a shell:

```text
git ls-files -z -- :(glob)**/Dockerfile*
```

Build this argument shape:

```js
[
  'run',
  '--rm',
  '--mount',
  `type=bind,source=${repoRoot},target=/workspace,readonly`,
  '--workdir',
  '/workspace',
  HADOLINT_IMAGE,
  '/bin/hadolint',
  '--config',
  '.hadolint.yaml',
  '--no-color',
  ...dockerfiles,
];
```

Use `fileURLToPath(import.meta.url)` to guard CLI execution. On CLI execution, set
`process.exitCode` to the returned status. Throw concise errors for Git/spawn failures, malformed
discovery, or a null child status. The CLI boundary catches those errors, writes one
`[hadolint] error: ...` line, and sets exit code 1. Before Docker starts, print one deterministic
summary:

```text
[hadolint] linting 6 tracked Dockerfiles: <sorted paths>
```

- [ ] **Step 4: Replace the Docker lint commands and explain `DL3018`**

Replace the old Docker/Hadolint keys with:

```json
"docker:lint": "pnpm docker:lint:compose && pnpm docker:lint:dockerfiles",
"docker:lint:compose": "dclint docker-compose.yml docker-compose.prod.yml --max-warnings 0",
"docker:lint:compose:fix": "dclint docker-compose.yml docker-compose.prod.yml --fix",
"docker:lint:dockerfiles": "node scripts/docker/run-hadolint.mjs"
```

Remove `docker:lint:fix`. Add a concise YAML comment above `DL3018` stating the current rebuilt-base
image policy. Rename the CI step from `Lint Docker Compose files` to `Lint Docker configuration`;
keep its command as `pnpm docker:lint`.

- [ ] **Step 5: Run unit tests and both real Docker linters**

Run:

```bash
node --test scripts/docker/run-hadolint.test.mjs
pnpm docker:lint:compose
pnpm docker:lint:dockerfiles
pnpm docker:lint
```

Expected: PASS. The Hadolint log must show all six currently tracked Dockerfiles. If Docker is
unavailable, fix/start the local Docker prerequisite; do not add a skip.

- [ ] **Step 6: Run the complete tooling lane**

Run:

```bash
pnpm test:tooling
```

Expected: PASS with the new Hadolint runner tests included.

- [ ] **Step 7: Commit Hadolint activation**

```bash
git add package.json .hadolint.yaml .github/workflows/ci.yml scripts/docker/run-hadolint.mjs scripts/docker/run-hadolint.test.mjs
git commit -m "ci(docker): activate portable hadolint enforcement"
```

---

### Task 4: Make CI Tool Bootstrap Cheaper and Verifiable

**Files:**

- Modify: `scripts/check/ci-workflow-structure.test.mjs`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add workflow-bootstrap RED assertions**

Add a test against the static job block:

```js
test('static tooling bootstrap verifies bundled shellcheck and actionlint checksum', () => {
  const bootstrap = namedStep(jobBlock('static-checks'), 'Verify repo hygiene tools');
  assert.doesNotMatch(bootstrap, /apt-get (?:update|install)/u);
  assert.match(bootstrap, /command -v shellcheck/u);
  assert.match(bootstrap, /shellcheck --version/u);
  assert.match(bootstrap, /actionlint_version=1\.7\.11/u);
  assert.match(
    bootstrap,
    /actionlint_sha256=900919a84f2229bac68ca9cd4103ea297abc35e9689ebb842c6e34a3d1b01b0a/u,
  );

  const download = bootstrap.indexOf('--output "$RUNNER_TEMP/${actionlint_archive}"');
  const verify = bootstrap.indexOf(
    'echo "${actionlint_sha256}  $RUNNER_TEMP/${actionlint_archive}" | sha256sum --check',
  );
  const extract = bootstrap.indexOf(
    'tar -xzf "$RUNNER_TEMP/${actionlint_archive}" -C "$RUNNER_TEMP/actionlint-bin"',
  );
  assert.ok(download >= 0 && download < verify && verify < extract);
});
```

Add a `namedStep(job, name)` helper that slices from the exact `- name:` line to the next sibling
step. This makes the ordering assertion describe one bootstrap step and one archive variable rather
than unrelated workflow text.

Keep or add the Task 2/3 assertions for `pnpm test:tooling` and `pnpm docker:lint` in the same static
job.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test scripts/check/ci-workflow-structure.test.mjs
```

Expected: FAIL because CI still uses `apt-get` and streams an unverified archive into `tar`.

- [ ] **Step 3: Replace the bootstrap step**

Use an implementation equivalent to:

```yaml
- name: Verify repo hygiene tools
  shell: bash
  run: |
    set -euo pipefail
    command -v shellcheck
    shellcheck --version
    actionlint_version=1.7.11
    actionlint_archive="actionlint_${actionlint_version}_linux_amd64.tar.gz"
    actionlint_sha256=900919a84f2229bac68ca9cd4103ea297abc35e9689ebb842c6e34a3d1b01b0a
    mkdir -p "$RUNNER_TEMP/actionlint-bin"
    curl --fail --silent --show-error --location \
      "https://github.com/rhysd/actionlint/releases/download/v${actionlint_version}/${actionlint_archive}" \
      --output "$RUNNER_TEMP/${actionlint_archive}"
    echo "${actionlint_sha256}  $RUNNER_TEMP/${actionlint_archive}" | sha256sum --check
    tar -xzf "$RUNNER_TEMP/${actionlint_archive}" -C "$RUNNER_TEMP/actionlint-bin"
    echo "$RUNNER_TEMP/actionlint-bin" >> "$GITHUB_PATH"
```

Do not add a network install fallback for ShellCheck; a runner-image regression should be visible.

- [ ] **Step 4: Run workflow structure and hygiene validation**

Run:

```bash
node --test scripts/check/ci-workflow-structure.test.mjs
pnpm run lint:repo-hygiene
```

Expected: PASS. If local Actionlint is unavailable, the structure test still runs; use the repo's
documented environment or CI for the command-level Actionlint confirmation rather than weakening the
test.

- [ ] **Step 5: Commit CI bootstrap hardening**

```bash
git add .github/workflows/ci.yml scripts/check/ci-workflow-structure.test.mjs
git commit -m "ci(tooling): verify static lint bootstrap"
```

---

### Task 5: Tighten Diagnostics and Docs-Gardening Workflows

**Files:**

- Modify: `scripts/check/ci-workflow-structure.test.mjs`
- Create: `scripts/docs/docs-gardening-workflow.test.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/ci-diagnostics.yml`
- Modify: `.github/workflows/docs-gardening.yml`

- [ ] **Step 1: Add RED tests for retention and diagnostics concurrency**

Extend `ci-workflow-structure.test.mjs` so it asserts:

```js
test('diagnostic artifacts use explicit bounded retention', () => {
  const diagnostics = readFileSync(
    new URL('../../.github/workflows/ci-diagnostics.yml', import.meta.url),
    'utf8',
  );
  assert.match(
    diagnostics,
    /^concurrency:\n  group: ci-diagnostics-\$\{\{ github\.ref \}\}\n  cancel-in-progress: true/mu,
  );
  for (const job of ['coverage-report', 'unit-timings']) {
    assert.match(workflowJobBlock(diagnostics, job), /retention-days: 30/u);
  }
});

test('PR failure diagnostics expire after fourteen days', () => {
  for (const artifactStep of ['docs-health-report', 'backend-db', 'telegram']) {
    // Locate each existing upload step by its artifact name and assert `retention-days: 14`.
  }
});
```

Use focused helpers rather than counting arbitrary `retention-days` strings.

- [ ] **Step 2: Add a gardening-workflow RED test**

Create `scripts/docs/docs-gardening-workflow.test.mjs` with a named-step extractor, then assert:

```js
test('gardening preserves the complete report set for thirty days', () => {
  const upload = namedStep(workflow, 'Upload docs gardening artifacts');
  const artifactPaths = upload
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('tmp/'));
  assert.deepEqual(artifactPaths, [
    'tmp/docs-gardening.json',
    'tmp/docs-gardening-issue.json',
    'tmp/docs-gardening-issue.md',
    'tmp/docs-health-report.json',
    'tmp/docs-health-report.md',
    'tmp/docs-plan-lifecycle.json',
    'tmp/docs-plan-lifecycle.md',
    'tmp/docs-stale-active.json',
    'tmp/docs-stale-active.md',
  ]);
  assert.match(upload, /retention-days: 30/u);
});

test('rolling issue lookup paginates through repository history', () => {
  const update = namedStep(workflow, 'Update rolling docs-gardening issue');
  assert.match(update, /const issues = await github\.paginate\(github\.rest\.issues\.listForRepo/u);
  assert.match(update, /const existing = issues\.find/u);
  assert.match(update, /!candidate\.pull_request/u);
  assert.doesNotMatch(update, /const \{ data: issues \} = await/u);
});
```

- [ ] **Step 3: Run both focused files and verify RED**

Run:

```bash
node --test scripts/check/ci-workflow-structure.test.mjs scripts/docs/docs-gardening-workflow.test.mjs
```

Expected: FAIL for missing retention, diagnostics concurrency, lifecycle artifacts, and pagination.

- [ ] **Step 4: Implement explicit retention and concurrency**

Add `retention-days: 14` to the three PR-CI uploads: docs health on failure, backend DB diagnostics,
and Telegram diagnostics. Add to `.github/workflows/ci-diagnostics.yml`:

```yaml
concurrency:
  group: ci-diagnostics-${{ github.ref }}
  cancel-in-progress: true
```

Add `retention-days: 30` to both scheduled diagnostic uploads.

- [ ] **Step 5: Complete gardening artifacts and pagination**

Add both lifecycle paths to the existing upload list and set `retention-days: 30`. Replace the
single-page call with:

```js
const issues = await github.paginate(github.rest.issues.listForRepo, {
  owner: context.repo.owner,
  repo: context.repo.repo,
  state: 'all',
  per_page: 100,
});
const existing = issues.find((candidate) => !candidate.pull_request && candidate.title === title);
```

Preserve the existing issue create/update/close behavior and permissions. Never select a pull
request returned by the repository-issues endpoint.

- [ ] **Step 6: Run focused and complete tooling tests**

Run:

```bash
node --test scripts/check/ci-workflow-structure.test.mjs scripts/docs/docs-gardening-workflow.test.mjs
pnpm test:tooling
pnpm run lint:repo-hygiene
```

Expected: PASS.

- [ ] **Step 7: Commit workflow housekeeping**

```bash
git add .github/workflows/ci.yml .github/workflows/ci-diagnostics.yml .github/workflows/docs-gardening.yml scripts/check/ci-workflow-structure.test.mjs scripts/docs/docs-gardening-workflow.test.mjs
git commit -m "ci(tooling): bound diagnostic workflow artifacts"
```

---

### Task 6: Synchronize Active Guidance and Remove Tracked Local Artifacts

**Files:**

- Modify: `AGENTS.md`
- Modify: `docs/reference/TESTING_GUIDELINES.md`
- Modify: `docs/reference/REPO_HYGIENE_LINTING.md`
- Modify: `docs/reference/DOCS_GARDENING_PLAYBOOK.md`
- Delete: `.impeccable/critique/2026-05-26T19-37-03Z__packages-batch-frontend-src-ui.md`
- Delete: `.impeccable/critique/2026-05-26T20-12-54Z__packages-batch-frontend-src-ui.md`

- [ ] **Step 1: Update command routing without bloating the handbook**

In `AGENTS.md`, add only these concise Command Baseline entries:

```text
- Root tooling tests: `pnpm test:tooling`
- Docker configuration lint: `pnpm docker:lint`
```

Do not copy the Hadolint implementation details into the router.

- [ ] **Step 2: Refresh testing guidance**

Update `docs/reference/TESTING_GUIDELINES.md` to:

- define `test:tooling` as every root `scripts/**/*.test.mjs` test;
- state that it is included by `check`, `check:pre-pr`, and static CI;
- retain `test:check-routing` as the focused affected/CI-routing lane;
- remove `test:timings:frontend` and describe only `test:timings:unit`;
- avoid mentioning deleted `test:env` or `test:topo` commands.

Refresh its `Last Verified Against` metadata only after checking the final scripts/workflows.

- [ ] **Step 3: Refresh lint and gardening guidance**

Update `docs/reference/REPO_HYGIENE_LINTING.md` so blocking CI lists:

- Actionlint;
- ShellCheck;
- dclint for Compose;
- Hadolint for tracked Dockerfiles through the pinned official container.

Document `docker:lint`, `docker:lint:compose`, `docker:lint:compose:fix`, and
`docker:lint:dockerfiles`. State that Docker is required locally for the Dockerfile lane and that
SQLFluff remains advisory.

Update `docs/reference/DOCS_GARDENING_PLAYBOOK.md` to confirm the complete uploaded artifact set,
30-day retention, and paginated rolling-issue lookup. Refresh its verified date after substantive
review.

- [ ] **Step 4: Remove tracked `.impeccable` artifacts**

Delete the two named critique files. Confirm `.gitignore` still ignores `.impeccable/`; do not add a
new ignore rule or delete untracked local artifacts.

- [ ] **Step 5: Search active guidance for removed commands**

Run:

```bash
rg -n "deps:check|deps:pin|deps:upgrade:safe|docker:backup|pnpm docker:dev([[:space:]]|$)|docker:dev:build|docs:gardening|pnpm smoke([[:space:]]|$)|test:env|test:timings:frontend|test:topo|pnpm hadolint|docker:lint:fix" AGENTS.md docs --glob '!docs/archive/**' --glob '!docs/superpowers/**'
```

Expected: no stale active references. Do not edit archives solely to clear historical matches.

- [ ] **Step 6: Format and validate documentation**

Run:

```bash
pnpm exec prettier --write AGENTS.md docs/reference/TESTING_GUIDELINES.md docs/reference/REPO_HYGIENE_LINTING.md docs/reference/DOCS_GARDENING_PLAYBOOK.md
pnpm docs:check
pnpm docs:garden
git diff --check
```

Expected: PASS. Inspect the generated gardening output; do not commit `tmp/**` artifacts.

- [ ] **Step 7: Commit the documentation and local-artifact cleanup**

```bash
git add AGENTS.md docs/reference/TESTING_GUIDELINES.md docs/reference/REPO_HYGIENE_LINTING.md docs/reference/DOCS_GARDENING_PLAYBOOK.md .impeccable/critique
git commit -m "docs(tooling): document canonical validation surface"
```

---

### Task 7: Combined Validation and Review Gate

**Files:**

- Review: every file changed since `main`
- Modify only if validation or review finds an in-scope defect.

- [ ] **Step 1: Inspect scope and changed-file hygiene**

Run:

```bash
git status --short
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
git diff --name-status origin/main...HEAD
git diff
git diff --cached
git ls-files --others --exclude-standard
```

Expected: only the files named by this plan across committed, staged, unstaged, and untracked state;
no generated `tmp/**`, local secrets, image layers, or unrelated edits.

- [ ] **Step 2: Run focused tooling and Docker validation**

Run:

```bash
pnpm test:tooling
pnpm docker:lint
pnpm run lint:repo-hygiene
pnpm docs:check
```

Expected: PASS. Confirm the Hadolint invocation includes all six current Dockerfiles and uses the
tag+digest pin.

- [ ] **Step 3: Run repository formatting and affected validation**

Run:

```bash
pnpm format:write
pnpm format
pnpm run lint:repo-hygiene
pnpm --silent run check:fast:agent
```

Expected: PASS. Because root toolchain and workflows changed, the affected checker should explain a
conservative broad selection rather than silently narrowing scope.

- [ ] **Step 4: Run the broad pre-PR gate**

Run:

```bash
pnpm check:pre-pr
```

Expected: PASS. Do not also run `pnpm check` unless diagnosing a failure or the final diff has
expanded into DB/migration/worker/integration behavior.

- [ ] **Step 5: Review the complete diff against the design**

Review specifically for:

- accidental removal of active operational commands;
- aliases surviving under a different name;
- root tests omitted from `test:tooling`;
- Hadolint native/Unix-only dependencies, shell execution, writable mount, floating image, missing
  Dockerfiles, or swallowed exit codes;
- Actionlint extraction before checksum verification;
- conditional rather than always-run tooling tests;
- missing or incorrect artifact retention;
- docs-gardening issue behavior changed beyond pagination;
- active docs pointing at deleted commands.

Fix findings test-first and rerun the affected focused commands.

- [ ] **Step 6: Commit final formatting or review corrections and require a clean tree**

If Steps 3–5 changed any file, stage only in-scope changes and create a focused Conventional Commit.
Then rerun the focused command affected by the correction plus
`pnpm --silent run check:fast:agent`. Finally run:

```bash
git status --short
git diff --check origin/main...HEAD
```

Expected: empty status and no diff-check findings. Do not push a branch with validated but
uncommitted changes.

- [ ] **Step 7: Prepare the branch for PR submission without deployment**

Prepare a PR summary using the repository template and select exactly one `release:patch` label.
Validation text must list only commands actually run. Stop with a clean committed branch ready to
push; do not push, open the PR, merge, or deploy until the user explicitly requests submission.

- [ ] **Step 8: Record hosted verification expectations for submission**

Record that the eventual PR should confirm:

- `Tooling tests` runs in static CI;
- `Lint Docker configuration` runs both dclint and Hadolint;
- no ShellCheck apt installation occurs;
- the aggregate CI gate reflects the blocking lanes.

These are hosted follow-up expectations, not claims made by local execution. Do not deploy or merge
unless separately requested.

## Completion Summary Template

Report:

- retired files and root aliases;
- canonical commands that replaced them;
- tooling-test count and integration points;
- Hadolint image/version/digest and Dockerfile count;
- CI bootstrap/artifact/docs-workflow improvements;
- documentation updated;
- exact validation commands and results;
- PR URL and CI state;
- explicit statement that deployment was not performed.
