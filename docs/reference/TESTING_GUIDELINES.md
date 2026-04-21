# Testing Guidelines (Repo-Wide)

## Meta

- Audience: maintainers and AI agents adding or updating tests.
- Read Time: 6 minutes.
- Authority Level: active test methodology guide.
- Last Verified Against: 2026-03-08 repo state.
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
- Root unit timing lane: `pnpm test:timings:unit`
- Root legacy timing alias: `pnpm test:timings:frontend`
- Root integration lane: `pnpm test:integration`
- Root prebuilt integration lane: `pnpm test:integration:prebuilt`
- Root backend DB + worker lane: `pnpm test:backend:db:worker`
- Root full check: `pnpm check`
  - Runs `build`, `typecheck`, `lint`, `test:unit:prebuilt`, `test:integration:prebuilt`, and the backend DB + worker lane.
- Root fast check: `pnpm check:fast`
  - Runs repo guards, `build`, `lint`, and the prebuilt unit subset for orchestrator, batch-backend, and batch-frontend.
- Root lint lane:
  - `pnpm lint` runs Biome for baseline JS/TS/TSX/JSON linting, then ESLint for specialized React and Vitest checks.
- Root lane behavior:
  - `pnpm test` delegates to `pnpm test:unit`.
  - `pnpm test:unit` runs package-level `test:unit` scripts in parallel (`--if-present`).
  - `pnpm test:unit:prebuilt` runs package-level `test:unit:prebuilt` scripts in parallel (`--if-present`) for already-built workspaces.
  - Packages that need build artifacts should keep `test:unit` self-contained and expose `test:unit:prebuilt` as the same unit suite without the setup build step.
  - `pnpm test:integration` runs `pnpm build` first, then delegates to `pnpm test:integration:prebuilt`.
  - `pnpm test:integration:prebuilt` runs package-level integration scripts in parallel (`--if-present`).
  - `pnpm test:timings:unit` runs the repo-wide timing lane across the targeted packages, and `pnpm test:timings:frontend` remains as a backwards-compatible alias.

## Script Methodology

When adding integration coverage to a package:

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
  - `packages/batch-backend` PG-backed suites now bootstrap `.env.batch-backend` automatically before importing the DB layer.
  - `BATCH_BACKEND_TEST_PG` remains the canonical explicit override, but host-run suites can also derive it from `PG_CONNECTION_STRING` or `PG_DATABASE` in `.env.batch-backend`.
  - Package lanes like `pnpm --filter @esl-pipeline/batch-backend test:db:migrations` and `test:db:postgres` should now work directly against the local host Postgres when the dev stack is running.
  - `pnpm test:backend:db:worker` and `pnpm check` still normalize host-run env automatically:
    - load `.env.batch-backend` when present
    - map Docker DNS hosts like `postgres` / `redis` to `127.0.0.1` for host execution
    - set `PG_CONNECTION_STRING` from `BATCH_BACKEND_TEST_PG`
    - set safe temp envs on WSL/Linux host runs
  - For custom one-off Vitest commands outside the package lanes, import `tests/support/bootstrap-pg-test-env.ts` before DB-layer imports or export `PG_CONNECTION_STRING="$BATCH_BACKEND_TEST_PG"` manually.
  - On WSL/Linux host-run `tsx` commands, also set safe temp envs such as `TMPDIR=/tmp/codex-tmp`, `TMP=/tmp/codex-tmp`, and `TEMP=/tmp/codex-tmp` to avoid IPC socket failures on mounted temp paths.
  - Example flow:

```bash
mkdir -p /tmp/codex-tmp
set -a
source .env.batch-backend
set +a
export TMPDIR=/tmp/codex-tmp TMP=/tmp/codex-tmp TEMP=/tmp/codex-tmp
export PG_CONNECTION_STRING="$BATCH_BACKEND_TEST_PG"
pnpm --filter @esl-pipeline/batch-backend exec vitest run --config ../../vitest.config.ts tests/domain.lesson-memory-repository.test.ts
```

## File Naming and Routing

- Unit tests:
  - `*.test.ts`
  - `*.test.tsx`
- Integration tests:
  - `*.integration.test.ts`
  - `*.integration.test.tsx`

Use naming that matches lane scripts so tests are routed correctly.

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

1. Run targeted package tests first.
2. Run lane-level checks:
   - `pnpm test`
   - `pnpm test:unit` when specifically validating package entrypoint normalization
   - `pnpm test:unit:prebuilt` when the workspace is already built
   - `pnpm test:integration`
   - `pnpm test:integration:prebuilt` when the workspace is already built
   - `pnpm test:backend:db:worker` when backend PG/Redis behavior changed
3. Run `pnpm check:fast` before PR when changes have broader behavior risk.
4. Run `pnpm check` before merge for changes that can affect DB-backed backend or worker behavior.
5. When touching backend migrations, `packages/batch-backend/schema.sql`, or `packages/contracts/src/contract-versions.ts`, also run:
   - `pnpm release:verify:contracts`
   - `pnpm --filter @esl-pipeline/batch-backend run db:verify-baseline`
   - regenerate baseline first with `pnpm --filter @esl-pipeline/batch-backend run db:generate-baseline` if verification reports drift

## CI Check Mapping

Deployment/test gating currently uses these blocking names:

- `static checks (node 24.x)`
- `integration lane (blocking)`
- `backend db + worker integration (blocking)`

## Related

- [`AGENTS.md`](../../AGENTS.md)
- [`docs/README.md`](../README.md)
- [`docs/reference/DOCS_IA_MAP.md`](DOCS_IA_MAP.md)
- [`docs/backend-frontend/DEPLOYMENT.md`](../backend-frontend/DEPLOYMENT.md)
