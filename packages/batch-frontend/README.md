# @esl-pipeline/batch-frontend

## Meta

- Audience: maintainers and implementing agents.
- Authority Level: package entrypoint and operational usage guide.
- Last Verified Against: 2026-04-28 repo state.
- Owner: batch-frontend maintainers + automation agents.
- Review Cadence: monthly or after major UI/workflow changes.
- Status: `active`.

React + Vite UI for `@esl-pipeline/batch-backend`.

## Role

This package is the operator-facing frontend for:

- authenticated assignment flow
- recording/transcript/prompt/draft/publish workflow
- student workspace and provenance views
- student and business schedule follow-up actions that mark elapsed lessons completed and open lesson-linked homework assignment context
- capability-gated job actions

Canonical behavior and current status live in:

- [`docs/backend-frontend/backend-frontend-alignment.md`](../../docs/backend-frontend/backend-frontend-alignment.md)
- [`docs/PIPELINE_INTEGRATION_VISION.md`](../../docs/PIPELINE_INTEGRATION_VISION.md)

## Runtime Notes

- API traffic goes through `src/utils/api.ts` and `@esl-pipeline/contracts`.
- Base URL resolution uses runtime override first, then Vite env, then `/api`.
- The app assumes the extended backend API is enabled.
- Student-area pages prefer route-level payloads under `/students/:id/surfaces/*`, with granular student APIs retained as compatibility/fallback paths.
- Lesson follow-up reminders use in-app actions first; Telegram/email delivery remains outside the frontend surface for this slice.
- Job-event SSE subscriptions should target known `jobId` and `recordingId` values; wildcard all-job streams are explicit.

Use these for deeper detail:

- [`packages/batch-backend/README.md`](../batch-backend/README.md)
- [`docs/reference/env.md`](../../docs/reference/env.md)

## Validation

```bash
pnpm --filter @esl-pipeline/batch-frontend build
pnpm --filter @esl-pipeline/batch-frontend test
```
