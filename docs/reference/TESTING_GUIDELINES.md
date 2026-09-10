# Testing Guidelines (Repo-Wide)

## Meta

- Audience: maintainers and AI agents adding or updating tests.
- Read Time: 6 minutes.
- Authority Level: active test methodology guide.
- Last Verified Against: 2026-07-29 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly or after test-lane/CI changes.
- Status: `active`.

## Purpose

- Define the canonical methodology for writing and maintaining tests in this monorepo.
- Keep test-lane routing, CI expectations, and performance patterns consistent.

If this guide conflicts with [`docs/reference/agents-ssot.md`](agents-ssot.md), the SSOT wins.

## Canonical Sources

1. [`docs/reference/agents-ssot.md`](agents-ssot.md)
2. [`package.json`](../../package.json)
3. [`packages/batch-backend/package.json`](../../packages/batch-backend/package.json)
4. [`packages/orchestrator/package.json`](../../packages/orchestrator/package.json)
5. [`packages/tts-core/package.json`](../../packages/tts-core/package.json)
6. [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
7. [`biome.json`](../../biome.json)

## Lane Contract

- Root unit lane: `pnpm test`
- Root workspace unit lane: `pnpm test:unit`
- Root prebuilt unit lane: `pnpm test:unit:prebuilt`
- Root fast prebuilt unit subset lane: `pnpm test:unit:prebuilt:fast`
- Root tooling lane: `pnpm test:tooling`
  - Runs every root `scripts/**/*.test.mjs` test.
  - Runs inside `check`, `check:pre-pr`, and the always-run static CI guard.
- Focused CI-routing tooling lane: `pnpm test:check-routing`
  - Validates every discovered backend test against the operational routing manifest and package
    scripts.
  - Runs before affected and broad unit lanes; a routing failure blocks unit execution only.
- Root unit timing lane: `pnpm test:timings:unit`
- Root integration lane: `pnpm test:integration`
- Root prebuilt integration lane: `pnpm test:integration:prebuilt`
- Root backend DB + worker lane: `pnpm test:backend:db:worker`
- Root affected check: `pnpm check:fast`
  - Resolves a comparison base against `origin/main`.
  - Includes committed branch changes plus staged, unstaged, and untracked files.
  - Runs cheap global guards, changed-file checks, affected workspace build, typecheck, and prebuilt
    unit tasks, and path-triggered validation.
  - Changed-file Biome owns lint in the normal affected path; broad and pre-PR validation still run
    the root Biome lint lane.
  - Uses Turborepo for workspace task ordering, dependency builds, concurrency, local cache, and run
    summaries.
  - Classifies an unclassifiable changed scope conservatively to the broad `check:pre-pr` plan.
- Root affected check, agent output: `pnpm check:fast:agent`
  - Executes normal affected local lanes. If routing conservatively requires the broad plan, it
    persists that plan and delegates comprehensive regression to hosted PR CI without executing
    broad local lanes.
- Root affected dry-run: `pnpm check:fast:dry-run`
  - Prints local working-tree scope separately from the committed hosted CI preview.
- Root broad pre-PR check: `pnpm check:pre-pr`
  - Runs repo guards, contract consistency, root tooling tests, build, typecheck, lint, and the fast
    prebuilt core unit subset for orchestrator, batch-backend, and batch-frontend.
  - Uses the same serial aggregate runner as `check:fast`; it does not hide the broad commands behind
    an opaque shell `&&` chain.
- Root broad pre-PR check, agent output: `pnpm check:pre-pr:agent`
  - Runs the same broad `--broad` validation plan as `check:pre-pr` while preserving the existing
    persisted agent summary and lane-log references for completion handoffs.
- Root full check: `pnpm check`
  - Runs root tooling tests, `build`, `typecheck`, `lint`, `test:unit:prebuilt`,
    `test:integration:prebuilt`, and the backend DB + worker lane.
- Root full check, agent output: `pnpm check:agent`
  - Runs the exact same ordered canonical lane topology as `check`, stops at its first failure, and
    persists the shared agent summary and raw lane logs.
  - Agent variants preserve validation scope and exit semantics; they change only output presentation
    and persisted evidence.
- Root lint lane:
  - `pnpm lint` runs Biome for JS/TS/TSX/JSX/CSS/JSON linting, including the selected React, Fast Refresh, TypeScript, and Vitest protections.
- Root lane behavior:
  - `pnpm test` delegates to `pnpm test:unit`.
  - `pnpm test:unit` runs package-level `test:unit` scripts in parallel (`--if-present`).
  - `pnpm test:unit:prebuilt` runs package-level `test:unit:prebuilt` scripts in parallel (`--if-present`) for already-built workspaces.
  - Packages that need build artifacts should keep `test:unit` self-contained and expose `test:unit:prebuilt` as the same unit suite without the setup build step.
  - `pnpm test:integration` runs `pnpm build` first, then delegates to `pnpm test:integration:prebuilt`.
  - `pnpm test:integration:prebuilt` runs package-level integration scripts in parallel (`--if-present`).
  - `pnpm test:timings:unit` runs the repo-wide timing lane across the targeted packages.

## Feedback Ladder

Use the narrowest lane that answers the question at hand:

| Lane               | Use                                                               | Typical command                                                   |
| ------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| Related            | Editing loop for one source file or feature                       | `pnpm --filter <package> exec vitest related --run <source-file>` |
| Explicit test file | Editing loop when the exact suite is known                        | `pnpm --filter <package> exec vitest run <test-file>`             |
| Affected           | Selected affected local evidence or routing preview               | `pnpm --silent run check:fast:agent` or `pnpm check:fast`         |
| Pre-PR             | Deliberately justified local broad diagnosis                      | `pnpm check:pre-pr:agent` or `pnpm check:pre-pr`                  |
| Full               | Local CI reproduction, DB, migration, worker, or integration risk | `pnpm check:agent` or `pnpm check`                                |

Focused local checks are the default; do not require one local aggregate gate before push. Choose
local aggregate execution only for a concrete plausible wider failure, local environment behavior
under test, unavailable equivalent hosted evidence, or a specific CI failure being reproduced or
diagnosed. Diff breadth alone is not a reason. `check:fast:agent` can run selected affected local
evidence, but its conservative broad fallback persists the broad plan and delegates comprehensive
regression to hosted PR CI. `check:pre-pr:agent` deliberately runs that broad local plan only when
the diagnostic reason is stated. Use `check:agent` for full local CI reproduction, DB, migration,
worker, or integration behavior. The non-agent commands remain human-readable equivalents. Clearly
docs-only work may use the documented docs-specific lanes.

Hosted PR CI is the default comprehensive regression executor for the resource-constrained developer
laptop. A task may be ready for hosted CI when focused evidence covers the plausible failure modes,
even when no local aggregate gate has run. The primary owns selecting, inspecting, and reporting the
four evidence classes: focused local evidence, optional/risk-triggered local aggregate evidence,
CI-owned comprehensive evidence, and manual/environment-owned evidence. Required hosted jobs and
`CI gate` still determine merge readiness.

Affected and broad gates run selected lanes serially. Independent lanes continue after failure so one
run reports every available problem. A prebuilt test lane is marked blocked when its build
prerequisite fails; lint, typecheck, docs, contracts, and unrelated guards still run. Inspect the
aggregate summary and cited raw logs before rerunning anything. An isolated rerun may diagnose one
failure but does not replace the canonical result. Allow at most one isolated diagnostic rerun per
unchanged failure. Repeat a complete gate only after relevant source, configuration, toolchain, or
diagnosed prerequisite state changed.

Affected plans assign every selected lane to `local` or `ci`. Local execution runs only local lanes;
selected PostgreSQL and Redis lanes remain visible as required `backend-db-integration` evidence. If
all executed local lanes pass while CI evidence remains, the agent summary reports
`PASS_WITH_CI_REQUIREMENTS`. An affected-agent broad fallback records that no broad local lanes ran
and that hosted comprehensive regression remains required; it is not ordinary local PASS evidence.
That outcome permits PR creation, not merge, and never means service coverage was skipped. A direct
`check:pre-pr` run has no affected-file projection, so it conservatively reports the same hosted
service requirement.

## Script Methodology

When adding integration coverage to a package other than `@esl-pipeline/batch-backend`:

- Keep `test` mapped to `test:unit`.
- Define `test:unit` with explicit excludes for integration files.
- Define `test:integration` with explicit integration targets.
- Use deterministic file targeting for heavy integration suites.

Root script contract:

- `pnpm test` is the human-facing unit lane wrapper.
- `pnpm test:unit` is the canonical workspace unit aggregator and only calls package `test:unit`.
- `pnpm test:unit` must fail if any package contains test files but omits `test:unit`.
- `pnpm test:unit:prebuilt` is the already-built workspace unit aggregator for callers like `pnpm check`.
- `pnpm test:integration` is the human-facing self-contained integration wrapper.
- `pnpm test:integration:prebuilt` is the already-built integration aggregator for callers like `pnpm check`.

Script contract baseline for unit-only packages:

- Still expose `test:unit` as the canonical unit lane entrypoint.
- Keep `test` delegating to `test:unit`.
- Include explicit integration excludes in `test:unit` (`*.integration.test.ts` and `*.integration.test.tsx`) so future integration files do not leak into unit lanes.

For `@esl-pipeline/batch-backend`:

- Classify tests by operational prerequisite in
  [`packages/batch-backend/tests/test-routing.json`](../../packages/batch-backend/tests/test-routing.json).
  File naming is descriptive but does not determine the lane.
- Preserve these public routes:
  - pure unit: `test:unit`, `test:unit:prebuilt`, and `test:unit:timings`;
  - deterministic in-process HTTP: `test:integration:http`;
  - serial PostgreSQL migrations: `test:db:migrations`;
  - serial PostgreSQL repositories/queries: `test:db:postgres`;
  - serial PostgreSQL + Redis workers: `test:integration:worker`.
- Service-backed tests are positively listed. Unit is the discovered remainder, guarded against known
  PostgreSQL/Redis bootstrap imports and environment signals. Every service test must be selected by
  its service script and excluded from every unit script.
- Run `pnpm test:check-routing` after adding, moving, or changing the prerequisites of a backend test.
- Canonical affected/broad and agent unit lanes remove ambient PostgreSQL, Redis, Docker endpoint,
  AWS/provider credentials and set `VALIDATION_TEST_CLASS=pure`. Explicit DB/worker agent lanes keep
  their constructed service environment. Deterministic HTTP fixtures must explicitly disable or
  replace service-backed facilities they do not exercise.
- Keep `test:ci` as the ordered aggregator.
- `test:ci` must include:
  - `test:unit`
  - HTTP integration lane (`test:integration`)
  - DB migration lane (`test:db:migrations`)
  - DB query lane (`test:db:postgres`)
  - worker integration lane (`test:integration:worker`)
- DB safety invariant:
  - `BATCH_BACKEND_TEST_PG` must point to a database name ending in `_test`; non-`_test` targets are rejected by the test env helper to prevent destructive test SQL from hitting dev/runtime data.
- Local Docker/Postgres note:
  - `packages/batch-backend` PG-backed suites now bootstrap `.env` automatically before importing the DB layer.
  - `BATCH_BACKEND_TEST_PG` remains the canonical explicit override, but host-run suites can also derive it from `PG_CONNECTION_STRING` or `PG_DATABASE` in `.env`.
  - Package lanes like `pnpm --filter @esl-pipeline/batch-backend test:db:migrations` and `test:db:postgres` should now work directly against the local host Postgres when the dev stack is running.
  - `pnpm test:backend:db:worker` and `pnpm check` still normalize host-run env automatically:
    - load `.env` when present
    - map Docker DNS hosts like `postgres` / `redis` to `127.0.0.1` for host execution
    - set `PG_CONNECTION_STRING` from `BATCH_BACKEND_TEST_PG`
    - set safe temp envs on WSL/Linux host runs
  - For custom one-off Vitest commands outside the package lanes, import `tests/support/bootstrap-pg-test-env.ts` before DB-layer imports or export `PG_CONNECTION_STRING="$BATCH_BACKEND_TEST_PG"` manually.
  - On WSL/Linux host-run `tsx` commands, also set safe temp envs such as `TMPDIR=/tmp/codex-tmp`, `TMP=/tmp/codex-tmp`, and `TEMP=/tmp/codex-tmp` to avoid IPC socket failures on mounted temp paths.
  - Example flow:

```bash
mkdir -p /tmp/codex-tmp
set -a
source .env
set +a
export TMPDIR=/tmp/codex-tmp TMP=/tmp/codex-tmp TEMP=/tmp/codex-tmp
export PG_CONNECTION_STRING="$BATCH_BACKEND_TEST_PG"
pnpm --filter @esl-pipeline/batch-backend exec vitest run --config ../../vitest.config.ts tests/domain.lesson-memory-repository.test.ts
```

## File Naming and Routing

Use `*.test.ts` and `*.test.tsx` for tests. An `.integration` segment may communicate intent, but it
does not establish prerequisites or lane membership. Package scripts and, for batch-backend, the
guarded routing manifest are authoritative. Classify by what the test actually acquires: no external
service, deterministic in-process integration, PostgreSQL, PostgreSQL + Redis, browser, subprocess,
container, or provider access.

## Suite Topology and Performance

- Avoid large monolithic test files; split by domain/feature for worker scheduling.
- Keep shared setup/builders in package-local test harness modules.
- When splitting suites, preserve assertion behavior and test names unless behavior intentionally changes.

## Timers and Polling

For interval- or polling-driven behavior:

- Prefer fake timers to avoid real-time waits.
- Reset timers with strict cleanup (`vi.useRealTimers()`) after each fake-timer test.
- When using `userEvent` under fake timers, wire timer advancement explicitly (for example, `advanceTimers`).

## Mocking and Test Isolation

- Centralize default mocks in suite harnesses.
- Override only scenario-specific parts per test.
- Avoid mutable shared cross-test state.
- Reset mocks/timers/history in setup hooks so tests remain independent.

## Validation Matrix

Use this order when updating tests:

1. Run targeted package or related tests first.
2. Record the evidence still needed: focused local checks, an optional concrete-reason local
   aggregate, hosted comprehensive CI, or manual/environment-owned validation. Do not add an
   aggregate local gate merely as completion ceremony; use `pnpm check:fast:dry-run` when its routing
   preview informs that decision.
3. Run lane-level or aggregate local checks only when the selected risk class calls for them:
   - `pnpm test`
   - `pnpm test:unit` when specifically validating package entrypoint normalization
   - `pnpm test:unit:prebuilt` when the workspace is already built
   - `pnpm test:integration`
   - `pnpm test:integration:prebuilt` when the workspace is already built
   - `pnpm test:backend:db:worker` when backend PG/Redis behavior changed
   - `pnpm check:pre-pr:agent` or `pnpm check:pre-pr` only with a stated broad local diagnostic
     reason; `pnpm check:agent` or `pnpm check` for local CI reproduction or the corresponding DB,
     migration, worker, or integration behavior.
4. Treat a successful `pnpm check` or `pnpm check:agent` as subsuming narrower local commands, but
   never as a replacement for required hosted CI.
5. When touching backend migrations, `packages/batch-backend/schema.sql`, or `packages/contracts/src/contract-versions.ts`, also run:
   - `pnpm release:verify:contracts`
   - `pnpm --filter @esl-pipeline/batch-backend run db:verify-baseline`
   - regenerate baseline first with `pnpm --filter @esl-pipeline/batch-backend run db:generate-baseline` if verification reports drift

## Affected Check Routing

`check:fast` is implemented by `scripts/check/run-affected-check.mjs` and should fail
conservatively. It must not report success with no affected work when Git state, workspace metadata,
or changed root files are uncertain.

The wrapper:

- verifies `origin/main`, merge-base availability, and remote freshness;
- collects committed, staged, unstaged, and untracked files;
- maps files to workspace packages from `pnpm-workspace.yaml`;
- expands changed packages to transitive dependents;
- asks Turbo to run affected build, typecheck, and prebuilt unit tasks only for packages that expose
  each script;
- always runs `test:check-routing` and blocks unit consumers when the routing contract fails;
- runs selected commands serially, aggregates every independent failure, and blocks only prebuilt
  consumers of a failed build;
- uses changed-file Biome as the normal affected lint owner, and separately runs changed-file Biome
  package-manifest formatting/assist, changed-file Prettier for Markdown/YAML, docs, workflow, shell,
  Docker, deterministic HTTP, and safe DB-baseline lanes when path rules trigger;
- reports selected PostgreSQL and Redis service lanes as CI-owned requirements instead of executing
  them locally;
- prints the base, changed files, package expansion, triggered lanes, skipped broad lanes, artifacts,
  and reproduction commands.

Its dry-run output contains two projections: local validation includes committed, staged, unstaged,
and untracked paths, while the hosted CI preview includes committed branch paths only.

Important path rules:

- `docs/**`, `AGENTS.md`, and `.github/pull_request_template.md` trigger docs and formatting lanes.
- `.github/workflows/**` triggers `lint:workflows`.
- `scripts/**/*.sh` triggers `lint:shell`.
- Docker Compose files, Dockerfiles, `scripts/docker/**`, and `scripts/deploy/**` trigger Docker
  lint/config checks.
- `packages/batch-backend/migrations/**` and `packages/batch-backend/schema.sql` trigger the local DB
  baseline guard and require the CI migration/PostgreSQL service job.
- backend repository implementations/tests, worker, queue, and `process-*-job.ts` paths require the
  CI PostgreSQL/Redis service job.
- contracts, shared infrastructure, workflow changes, and unknown scope conservatively require the
  CI PostgreSQL/Redis service job.
- backend HTTP transport route and middleware paths trigger HTTP integration.
- root validation config, package manager metadata, Turbo config, and validation-runner files classify
  to the explicit broad `check:pre-pr` lane plan. `check:fast:agent` persists that plan and delegates
  its broad execution to hosted PR CI; explicit `check:pre-pr` variants still execute it locally.

For production image changes:

- `node --test scripts/docker/production-image-contract.test.mjs` locks production bases, modern
  pnpm deployment, Compose image lines, release `--pull`, and orchestrator-image retirement.
- `pnpm docker:lint` remains the portable all-Dockerfile plus Compose lint lane.
- Base, packaging, or runtime-asset changes require fresh local `linux/amd64` builds of backend,
  frontend, and bot plus bounded non-root/runtime-asset smoke before `check:pre-pr`. Image-size
  output is review evidence, not a fixed test threshold.

## CI Check Mapping

Deployment/test gating currently uses these blocking names:

- `CI gate`
- `static checks (node 24.x)`
- `integration lane (blocking)`
- `backend db + worker integration (blocking)`
- `telegram command-loop compose smoke`

`CI gate` is the canonical aggregate status and should become the single required branch-protection
check when repository plan capabilities permit. Selected runtime steps and jobs remain blocking;
unselected conditional jobs may report skipped, but a selected job that is missing, cancelled, or
skipped fails the gate. Static and deterministic integration jobs always upload 14-day log artifacts
with a command/outcome manifest. PostgreSQL and Redis are provisioned only in the isolated
`backend-db-integration` job, which runs the manifest-guarded migration, PostgreSQL, and worker
scripts.

There is no nightly validation tier. Coverage and timing diagnostics may run weekly or by manual
dispatch, but no release-blocking evidence may depend on them. PR CI owns application readiness;
merge to `main` automatically starts versioning and immutable image publication, while production
deployment remains a separate operator action.

## Related

- [`AGENTS.md`](../../AGENTS.md)
- [`docs/README.md`](../README.md)
- [`docs/reference/DOCS_IA_MAP.md`](DOCS_IA_MAP.md)
- [`docs/backend-frontend/DEPLOYMENT.md`](../backend-frontend/DEPLOYMENT.md)
