# Design Docs Router (Active)

## Meta

- Audience: AI agents and maintainers.
- Read Time: 1 minute.
- Authority Level: Design router.
- Last Verified Against: 2026-05-12 repo state.
- Owner: backend/frontend maintainers + automation agents.
- Review Cadence: monthly or after transcription-flow changes.
- Status: `router`.

## Purpose

- Route readers to active design/spec docs.
- Keep historical design generations out of active guidance.

## When To Read

- Before tasks involving transcription pipeline design assumptions.

## Canonical Sources

1. [`docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`](TRANSCRIPTION_PIPELINE_SPEC.md)
2. [`docs/backend-frontend/backend-frontend-alignment.md`](../backend-frontend/backend-frontend-alignment.md)
3. [`docs/reference/agents-ssot.md`](../reference/agents-ssot.md)

## Current State

- Active design spec: transcription pipeline only.
- Historical frontend vision docs are archived under `docs/archive/frontend/2026-02/`.

## Do / Don't

- Do use this file as a pointer doc.
- Don't treat archived frontend vision docs as active implementation guidance.

## Related

- [`docs/archive/frontend/README.md`](../archive/frontend/README.md)
- [`docs/PIPELINE_INTEGRATION_VISION.md`](../PIPELINE_INTEGRATION_VISION.md)
