# Design Docs Router (Active)

## Meta

- Audience: AI agents and maintainers.
- Read Time: 1 minute.
- Authority Level: Design router.
- Last Verified Against: 2026-07-16 repo state.
- Owner: backend/frontend maintainers + automation agents.
- Review Cadence: monthly or after transcription-flow changes.
- Status: `router`.

## Purpose

- Route readers to active design/spec docs.
- Keep historical design generations out of active guidance.

## When To Read

- Before designing or substantially revising any product UI.
- Before tasks involving transcription pipeline design assumptions.

## Canonical Sources

1. [`PRODUCT.md`](../../PRODUCT.md)
2. [`Product UI preferences`](PRODUCT_UI_PREFERENCES.md)
3. [`docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`](TRANSCRIPTION_PIPELINE_SPEC.md)
4. [`docs/backend-frontend/backend-frontend-alignment.md`](../backend-frontend/backend-frontend-alignment.md)
5. [`docs/reference/agents-ssot.md`](../reference/agents-ssot.md)

## Current State

- Active cross-screen product UI guidance: [`Product UI preferences`](PRODUCT_UI_PREFERENCES.md).
- Active domain design spec: transcription pipeline.
- Historical frontend vision docs are archived under `docs/archive/frontend/2026-02/`.

## Living Review Records

- [`Assignment main-flow UI review`](reviews/assignment-main-flow-ui-review.docx) - screenshot-driven,
  non-authoritative review record for the current sandbox polish pass. Accepted decisions must still
  be implemented and validated in code before they become runtime truth.

## Do / Don't

- Do use this file as a pointer doc.
- Don't treat archived frontend vision docs as active implementation guidance.

## Related

- [`docs/archive/frontend/README.md`](../archive/frontend/README.md)
- [`docs/PIPELINE_INTEGRATION_VISION.md`](../PIPELINE_INTEGRATION_VISION.md)
