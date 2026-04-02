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

## Lane Contract

- Root unit lane: `pnpm test`
- Root prebuilt unit lane: `pnpm test:unit`
- Root integration lane: `pnpm test:integration`
- Root prebuilt integration lane: `pnpm test:integration:prebuilt`
- Root backend DB + worker lane: `pnpm test:backend:db:worker`
- Root full check: `pnpm check`
  - Runs `build`, `typecheck`, `lint`, `test`, `test:integration:prebuilt`, and the backend DB + worker lane.
- Root lane behavior:
  - `pnpm test` delegates to `pnpm test:unit`.
  - `pnpm test:unit` runs package-level `test:unit` scripts in parallel (`--if-present`).
  - `pnpm test:integration` runs `pnpm build` first, then delegates to `pnpm test:integration:prebuilt`.
  - `pnpm test:integration:prebuilt` runs package-level integration scripts in parallel (`--if-present`).

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
  - `.env.batch-backend` may define `BATCH_BACKEND_TEST_PG` for the host-accessible test database, but current PG-backed suites import the DB layer before `requirePgTestEnv()` rewrites `PG_CONNECTION_STRING`.
  - `pnpm test:backend:db:worker` and `pnpm check` now normalize host-run env automatically:
    - load `.env.batch-backend` when present
    - map Docker DNS hosts like `postgres` / `redis` to `127.0.0.1` for host execution
    - set `PG_CONNECTION_STRING` from `BATCH_BACKEND_TEST_PG`
    - set safe temp envs on WSL/Linux host runs
  - For one-off host-run PG-backed tests outside those wrappers, export `PG_CONNECTION_STRING="$BATCH_BACKEND_TEST_PG"` in the shell before invoking Vitest or package test scripts.
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
   - `pnpm test:integration`
   - `pnpm test:integration:prebuilt` when the workspace is already built
   - `pnpm test:backend:db:worker` when backend PG/Redis behavior changed
3. Run `pnpm check:fast` before PR when changes have broader behavior risk.
4. Run `pnpm check` before merge for changes that can affect DB-backed backend or worker behavior.

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
