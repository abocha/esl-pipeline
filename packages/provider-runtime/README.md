# @esl-pipeline/provider-runtime

## Meta

- Audience: maintainers and implementing agents.
- Authority Level: Package entrypoint and shared runtime policy guide.
- Last Verified Against: 2026-03-09 repo state.
- Owner: provider-runtime maintainers + automation agents.
- Review Cadence: monthly or after major provider policy/runtime changes.
- Status: `active`.

Shared provider runtime utilities for generation-related policy and error handling.

## Purpose

`@esl-pipeline/provider-runtime` centralizes provider/runtime helpers so backend flows
can reuse consistent classification and fallback behavior without duplicating logic.

Current modules are exported from [`src/index.ts`](src/index.ts):

- `classification`
- `hints`
- `ladder`

## Typical Use

This package is consumed by batch backend generation policy/runtime paths to:

- classify provider/model errors into stable categories,
- derive retry/fallback hints,
- apply provider ladder behavior consistently.

## Development

From repo root:

```bash
pnpm --filter @esl-pipeline/provider-runtime build
pnpm --filter @esl-pipeline/provider-runtime test
```

## Related

- [`packages/batch-backend/README.md`](../batch-backend/README.md)
- [`docs/reference/GENERATION_PROVIDER_POLICY.md`](../../docs/reference/GENERATION_PROVIDER_POLICY.md)
- [`docs/reference/agents-ssot.md`](../../docs/reference/agents-ssot.md)
