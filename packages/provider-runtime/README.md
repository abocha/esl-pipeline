# @esl-pipeline/provider-runtime

## Meta

- Audience: maintainers and implementing agents.
- Authority Level: package entrypoint and shared runtime policy guide.
- Last Verified Against: 2026-07-29 repo state.
- Owner: provider-runtime maintainers + automation agents.
- Review Cadence: monthly or after major provider policy/runtime changes.
- Status: `active`.

Shared generation-provider runtime helpers.

## Role

This package centralizes reusable generation runtime behavior for backend flows:

- provider/model error classification
- retry and fallback hints
- provider ladder helpers

Policy remains canonical in:

- [`docs/reference/GENERATION_PROVIDER_POLICY.md`](../../docs/reference/GENERATION_PROVIDER_POLICY.md)
- [`packages/batch-backend/README.md`](../batch-backend/README.md)

## Validation

```bash
pnpm --filter @esl-pipeline/provider-runtime build
pnpm --filter @esl-pipeline/provider-runtime test
```
