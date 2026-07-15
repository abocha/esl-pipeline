# Tooling System Cleanup Design

## Meta

- Audience: maintainers and implementation agents.
- Status: approved design.
- Last Verified Against: 2026-07-15 repository scripts, root commands, workflows, and local Docker
  behavior.
- Owner: founder-maintainer + automation agents.
- Scope: repository tooling surface, root tooling tests, Dockerfile linting, and small CI/docs-workflow
  hygiene improvements.

## Problem

The repository has accumulated a small but confusing tooling tail. Some root commands point to
dependency-mutation scripts that are no longer part of the maintenance workflow. Several wrappers
and bootstrap helpers have no callers. Other commands are aliases whose canonical alternatives are
already established in current documentation.

At the same time, useful tooling is not consistently activated:

- nine root `node:test` files are outside any complete named root lane;
- Hadolint configuration exists, but the root command depends on unavailable Unix executables and
  therefore does not work on the primary Windows development environment;
- the affected checker treats Dockerfiles as risky while `docker:lint` currently checks only
  Compose files;
- CI installs ShellCheck even though the pinned Ubuntu runner already provides it, downloads
  Actionlint without verifying its published checksum, and leaves several diagnostic artifacts on
  the default retention period;
- docs gardening omits two generated lifecycle reports from its artifact and searches only the first
  100 repository issues.

This is primarily a clarity and trust problem. A command should either be canonical and exercised,
or absent. A named validation lane should describe the work it actually performs.

## Goals

1. Remove obsolete mutation tools, uncalled wrappers/helpers, and redundant root aliases.
2. Establish one complete, fast root tooling-test lane and run it locally and in hosted CI.
3. Make Docker linting portable and truthful by checking both Compose files and every tracked
   Dockerfile.
4. Activate Hadolint through a versioned, digest-pinned official container rather than requiring a
   host installation.
5. Make CI tool bootstrap and artifact handling cheaper, explicit, and testable.
6. Update active documentation to expose only the surviving canonical commands and policies.

## Non-Goals

- Changing application, API, DTO, manifest, database, environment, or deployment behavior.
- Automatically upgrading or pinning dependencies.
- Removing dependency auditing, ShellCheck, Actionlint, SQLFluff, dclint, or operational Docker and
  deployment scripts.
- Rewriting archived plans or historical records to erase removed command names.
- Changing Docker base images or pinning every Alpine package in this cleanup.
- Adding a new package manager, task runner, third-party workflow action, or hosted lint service.
- Broadly gardening product documentation unrelated to tooling.

## Architecture

### Canonical Tooling Surface

The cleanup removes tools that have no current caller or approved operator workflow:

- `scripts/deps/safe-upgrade.mjs`;
- `scripts/deps/pin-shared-deps.mjs`;
- the now-empty `scripts/deps/README.md`;
- `scripts/check/run-agent-check-fast.mjs`;
- `scripts/test/run-agent-vitest.mjs`;
- `scripts/docker/prepare-host-paths.sh`;
- `scripts/setup-agent-env.sh`;
- `scripts/git/gh-auth-from-env.sh`.

The active libraries and replacements remain:

- `scripts/check/agent-check-lib.mjs` and the affected-check runner;
- `scripts/test/agent-vitest-lib.mjs` and lane runner;
- `scripts/docker/prepare-host-paths.mjs`;
- `deps:audit` and `deps:audit:strict`;
- current GitHub CLI authentication and documented Windows-first setup;
- production backup, deployment, Compose, and host-path operations.

The following redundant or ambiguous root commands are removed:

- `deps:check`, `deps:pin`, `deps:upgrade:safe`;
- `docker:backup`, `docker:dev`, `docker:dev:build`;
- `docs:gardening`;
- `smoke`;
- `test:env`, `test:timings:frontend`, `test:topo`;
- the broken host-dependent `hadolint` command.

Their canonical counterparts remain, including `docker:db:backup`, `docker:up`,
`docker:up:build`, `docs:garden`, package-specific test commands, `test:timings:unit`, and
`test:check-routing`. Specialized `docker:dev:*` recovery/status commands remain because they are
distinct operations rather than aliases.

Deletion is protected by a small structural test. It asserts the forbidden files and root script
keys are absent and the canonical replacements remain. This prevents dead aliases from returning
quietly.

### Complete Root Tooling Test Lane

The root command becomes:

```json
"test:tooling": "node --test \"scripts/**/*.test.mjs\""
```

It intentionally runs every root script test, including checker routing, Docker validation,
deployment helpers, docs gardening, and agent test-runner support. `test:check-routing` remains as a
focused diagnostic command; it is not the complete lane.

The lane is always run by:

- `check`;
- `check:pre-pr`;
- the `static-checks` job in `.github/workflows/ci.yml`, even when runtime package lanes are skipped.

The current suite passes 86 tests in roughly seven seconds locally, so this is an appropriate
always-run trust boundary for changes to repository automation. The structural topology test must
also verify these three integrations.

### Portable Hadolint Activation

`scripts/docker/run-hadolint.mjs` owns Dockerfile discovery and invocation. It uses Git rather than
`rg`, `xargs`, or a native Hadolint binary:

```text
git ls-files -z -- :(glob)**/Dockerfile*
```

The runner normalizes tracked paths, fails if no Dockerfile is found, and launches Docker without a
shell. The repository is mounted read-only at `/workspace`, the container working directory is
`/workspace`, and Hadolint receives the committed configuration and every discovered path.
Discovery itself is shell-free and runs Git from the repository root with the exact pathspec as a
distinct argument. Before Docker starts, the CLI prints one deterministic summary containing the
discovered count and normalized paths; successful Hadolint output is otherwise normally silent.

The image is pinned by both readable version and immutable digest:

```text
ghcr.io/hadolint/hadolint:v2.14.0@sha256:27086352fd5e1907ea2b934eb1023f217c5ae087992eb59fde121dce9c9ff21e
```

The invocation is equivalent to:

```text
docker run --rm
  --mount type=bind,source=<repo-root>,target=/workspace,readonly
  --workdir /workspace
  <pinned-image>
  /bin/hadolint --config .hadolint.yaml --no-color <tracked-dockerfiles...>
```

`spawnSync` or `spawn` uses an argument array with inherited stdio. Docker startup failures and
Hadolint non-zero exits are propagated unchanged. No temporary Dockerfile copies are created.

Focused Node tests cover null-delimited discovery parsing, deterministic path normalization, the
exact digest pin, read-only mount, configuration argument, complete Dockerfile forwarding, no-shell
execution for both Git and Docker, the exact Git pathspec/cwd/encoding, malformed discovery, empty
discovery, deterministic summary output, controlled CLI startup errors, and exit propagation. The
implementation accepts injected process functions so tests never need Docker or network access.

The Docker commands become:

```json
"docker:lint:compose": "dclint docker-compose.yml docker-compose.prod.yml --max-warnings 0",
"docker:lint:compose:fix": "dclint docker-compose.yml docker-compose.prod.yml --fix",
"docker:lint:dockerfiles": "node scripts/docker/run-hadolint.mjs",
"docker:lint": "pnpm docker:lint:compose && pnpm docker:lint:dockerfiles"
```

The old `docker:lint:fix` name is removed because it cannot fix Dockerfiles and therefore overstates
its scope. CI continues to call `pnpm docker:lint`, but the step is renamed to `Lint Docker
configuration` so its label matches its behavior.

The existing `.hadolint.yaml` keeps `DL3018` ignored. A comment records that this repository
currently refreshes Alpine packages through rebuilt base images rather than snapshot-pinning apk
versions inside each Dockerfile. Every other Hadolint rule remains active. Changing that dependency
policy is a separate design decision.

### CI Tool Bootstrap

The Ubuntu 24.04 runner already includes ShellCheck. CI therefore verifies it with
`command -v shellcheck` and `shellcheck --version` instead of running `apt-get update` and installing
it on every static job.

Actionlint remains version `1.7.11`. CI downloads its official archive to `$RUNNER_TEMP`, verifies
the release-published SHA-256 before extraction, then adds the binary directory to `GITHUB_PATH`.
The expected Linux AMD64 archive hash is:

```text
900919a84f2229bac68ca9cd4103ea297abc35e9689ebb842c6e34a3d1b01b0a
```

The workflow structure test asserts the absence of the ShellCheck package install, the presence of
the availability/version checks, and the exact Actionlint download/verification/extraction ordering
for the same archive. It also locks the always-run tooling-test step and the exact package-script
composition of the Docker lint command.

### Diagnostic and Docs-Workflow Hygiene

Artifact retention becomes explicit:

- ordinary failure diagnostics in PR CI: 14 days;
- scheduled coverage and timing diagnostics: 30 days;
- weekly docs-gardening artifacts: 30 days.

The diagnostics workflow gains run-level concurrency keyed by ref with `cancel-in-progress: true` so
manual and scheduled runs do not wastefully overlap.

Docs gardening uploads the two lifecycle reports it already creates:

- `tmp/docs-plan-lifecycle.json`;
- `tmp/docs-plan-lifecycle.md`.

Its rolling-issue lookup uses `github.paginate(github.rest.issues.listForRepo, ...)` with
`per_page: 100`, so repositories with more than 100 historical issues do not create duplicate
gardening issues. Workflow structural tests extract the relevant named steps rather than matching
the workflow globally. They lock retention, concurrency, the complete artifact set, and the exact
paginated issue assignment consumed by the subsequent lookup.

### Local Artifact Cleanup

`.impeccable/` is already ignored. The two historical critique files that remain tracked are removed
so future local design artifacts obey the existing ignore policy. No generated or ignored
replacement is committed.

## Error Handling

- Missing Git, malformed null-delimited discovery output, or an empty Dockerfile set fails the
  Hadolint runner with a concise message.
- Missing Docker fails the command; the runner does not report lint success or silently skip.
- Container pull/start failures and Hadolint findings preserve a non-zero exit.
- Actionlint is never extracted after a checksum mismatch.
- Tooling tests and Docker lint remain blocking in static CI.
- Artifact upload stays `if: always()` or failure-scoped as appropriate; explicit retention does not
  change producer failure semantics.

## Testing Strategy

Implementation proceeds test-first:

1. Structural tests first describe the desired root command/file surface and must fail against the
   current repository.
2. Hadolint unit tests describe parsing and command construction without calling Docker; the real
   runner is added only after RED evidence.
3. Workflow structure tests fail before CI bootstrap, retention, concurrency, artifact, and
   pagination changes.
4. Focused tests turn green after each slice.
5. The actual `pnpm docker:lint:dockerfiles` command runs against all six tracked Dockerfiles.
6. Final validation runs formatting, repo hygiene, `test:tooling`, `docker:lint`, the affected agent
   gate, docs checks, and broad pre-PR validation because the branch changes root tooling and CI.

## Acceptance Criteria

- Every named obsolete file and root alias is absent; active replacements remain.
- `pnpm test:tooling` runs every `scripts/**/*.test.mjs` test and is wired into local broad gates and
  static CI.
- `pnpm docker:lint` checks Compose files and all tracked Dockerfiles on Windows and Linux through
  commands available in the repository baseline.
- Hadolint uses the approved v2.14.0 tag+digest and the repository is mounted read-only.
- Current Dockerfiles pass Hadolint under `.hadolint.yaml`.
- CI no longer installs ShellCheck and verifies the Actionlint archive checksum before extraction.
- Artifact retention, diagnostics concurrency, gardening lifecycle uploads, and issue pagination are
  explicit and structurally tested.
- Active guidance lists canonical commands only and explains the new tooling/Docker lint lanes.
- No application or production behavior changes.
