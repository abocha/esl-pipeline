# @esl-pipeline/batch-frontend

## Meta

- Audience: maintainers and implementing agents.
- Authority Level: package entrypoint and operational usage guide.
- Last Verified Against: 2026-07-12 repo state.
- Owner: batch-frontend maintainers + automation agents.
- Review Cadence: monthly or after major UI/workflow changes.
- Status: `active`.

React + Vite UI for `@esl-pipeline/batch-backend`.

## Role

This package is the operator-facing frontend for:

- authenticated assignment flow
- recording/transcript/prompt/draft/publish workflow
- student-area directory, overview, learning, history, and schedule/billing views
- student Learning page memory health support details for founder/operator diagnosis
- student Learning page profile-draft change review after approved candidate refresh
- student and business schedule follow-up actions that mark elapsed lessons completed and open lesson-linked homework assignment context
- capability-gated job actions

Canonical behavior and current status live in:

- [`docs/backend-frontend/backend-frontend-alignment.md`](../../docs/backend-frontend/backend-frontend-alignment.md)
- [`docs/PIPELINE_INTEGRATION_VISION.md`](../../docs/PIPELINE_INTEGRATION_VISION.md)

## Runtime Notes

- API traffic goes through `src/utils/api.ts` and `@esl-pipeline/contracts`.
- Base URL resolution uses runtime override first, then Vite env, then `/api`.
- The app assumes the extended backend API is enabled.
- Cache-hit uploads can reuse transcription artifacts without moving another student's recording;
  the returned recording/transcript IDs remain owned by the selected student.
- Lesson source entry supports either an OPUS upload or a tutor-pasted existing transcript. Pasted
  transcripts are persisted through `POST /recordings/transcript-source`, retain explicit
  `manual_transcript`/`manual` provenance, and never enqueue speech-to-text work. OPUS is the only
  audio format promised during the current alpha.
- The authenticated Calm Studio shell uses a persistent workspace rail and a focused five-step
  assignment flow: Student, Lesson source, Teaching context, Create, and Review & share. Back and
  completed-step navigation are user-owned and keep the current assignment state instead of
  redirecting as readiness updates. A published assignment is complete until the tutor explicitly
  chooses Start another assignment. Advanced actions appear only after sharing and contain
  post-share rerun and republish operations; technical recovery, provider, quota, provenance, and
  other diagnostics live under Support details rather than workflow steps.
- This visual overhaul currently covers the authenticated shell and assignment workflow. Student,
  Business, and Assignment Templates routes remain operational on their existing content designs.
- Local UI iteration can use the Vite mock-auth sandbox without a backend:
  - PowerShell:
    ` $env:VITE_BATCH_FRONTEND_SANDBOX='mock-auth'; pnpm --filter @esl-pipeline/batch-frontend dev -- --host 127.0.0.1 --port 5173`
  - POSIX:
    `VITE_BATCH_FRONTEND_SANDBOX=mock-auth pnpm --filter @esl-pipeline/batch-frontend dev -- --host 127.0.0.1 --port 5173`
  - The sandbox is dev-only, marks the UI with `Mock data`, bypasses frontend auth only, and uses
    seeded mock API responses for the assignment builder.
  - Sandbox scenarios are allow-listed through `sandboxScenario`; unknown values use the default:
    - `http://localhost:5173/?sandboxScenario=default`
    - `http://localhost:5173/?sandboxScenario=step-one-no-recent`
    - `http://localhost:5173/?sandboxScenario=step-one-resume-states`
    - `http://localhost:5173/?sandboxScenario=step-one-resume-error`
    - `http://localhost:5173/?sandboxScenario=step-one-no-learners`
    - `http://localhost:5173/?sandboxScenario=step-one-learner-error`
    - `http://localhost:5173/?sandboxScenario=step-one-slow`
  - Add `jobId` or `sessionId` to any sandbox URL to inspect initial assignment hydration. For
    example, open `http://localhost:5173/?sandboxScenario=default&jobId=job-sandbox` to resume
    the seeded completed assignment with all primary stages unlocked for copy/layout review.
- Student-area pages prefer route-level payloads under `/students/:id/surfaces/*`, with granular student APIs retained as compatibility/fallback paths.
- The Learning page can read `/students/:id/memory/health` for collapsed operator support details;
  manual full snapshot rebuild remains outside the frontend and CLI-only for v1.1.
- Approved-candidate draft refresh opens a review-mediated profile draft and shows a standalone
  deterministic diff table against the active editor baseline. The table uses shared
  current/proposed headers, field-level change pills, and line-level addition/removal highlights;
  model-generated change classification remains intentionally deferred.
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
