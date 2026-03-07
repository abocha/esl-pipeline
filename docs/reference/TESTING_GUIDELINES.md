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
5. [`packages/tts-elevenlabs/package.json`](../../packages/tts-elevenlabs/package.json)
6. [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)

## Lane Contract

- Root unit lane: `pnpm test`
- Root integration lane: `pnpm test:integration`
- Current integration lane behavior at root:
  - Runs `pnpm build` first.
  - Then runs package-level integration scripts in parallel (`--if-present`).

## Script Methodology

When adding integration coverage to a package:

- Keep `test` mapped to `test:unit`.
- Define `test:unit` with explicit excludes for integration files.
- Define `test:integration` with explicit integration targets.
- Use deterministic file targeting for heavy integration suites.

For `@esl-pipeline/batch-backend`:

- Keep `test:ci` as the ordered aggregator.
- `test:ci` must include:
  - `test:unit`
  - HTTP integration lane (`test:integration`)
  - DB migration lane (`test:db:migrations`)
  - DB query lane (`test:db:postgres`)
  - worker integration lane (`test:integration:worker`)

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
   - `pnpm test:integration`
3. Run `pnpm check:fast` before PR when changes have broader behavior risk.

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
