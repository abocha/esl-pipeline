# ESL Pipeline Batch System Guide

This document is the active integration guide for the batch frontend and batch backend.
For backend internals, use `docs/backend-frontend/batch-backend-ssot.md`.
For API readiness and gap tracking, use `docs/backend-frontend/backend-frontend-alignment.md`.

## 1. System Overview

The batch system powers the tutor-facing workflow from recording upload to published assignment.

```text
Batch Frontend (React + Vite)
  -> Batch Backend (Fastify + queue workers)
  -> Orchestrator Pipeline (validation/import/TTS/upload/manifest)
```

Current frontend shape is intentionally minimal:
- Authenticated assignment console
- Upload recording
- Review/edit transcript
- Generate prompt package
- Paste/save draft markdown
- Publish via materialize + approve

## 2. Primary User Flow

1. Tutor signs in.
2. Tutor uploads one recording.
3. Backend ingests the file and runs transcription.
4. Tutor reviews transcript and edits if needed.
5. Tutor generates prompt package text.
6. Tutor pastes LLM draft markdown.
7. Draft is validated and saved.
8. Tutor publishes to selected target (`notion` or `anytype`) via approve flow.

## 3. Frontend Surface

Canonical frontend reference:
- `packages/batch-frontend/README.md`

Primary frontend modules:
- `packages/batch-frontend/src/ui/App.tsx`
- `packages/batch-frontend/src/ui/minimal/MinimalShell.tsx`
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- `packages/batch-frontend/src/utils/api.ts`

## 4. Backend Integration Endpoints

Common endpoints used by the minimal flow:

- Auth:
  - `POST /auth/login`
  - `POST /auth/register`
  - `POST /auth/refresh`
  - `POST /auth/logout`
  - `GET /auth/me`

- Recordings:
  - `POST /recordings/upload`
  - `GET /recordings/:id`
  - `GET /recordings/:id/transcript`
  - `PUT /recordings/:id/transcript`
  - `POST /recordings/:id/transcribe`
  - `GET /recordings/:id/audio`

- Prompt packages and drafts:
  - `GET /config/prompts`
  - `POST /recordings/:id/prompt-package`
  - `POST /prompt-packages/:id/draft`
  - `GET /drafts/:id`
  - `POST /drafts/:id/materialize`

- Jobs:
  - `POST /jobs/:jobId/approve`
  - `GET /jobs/:jobId`
  - `GET /jobs/events`

- Validation:
  - `POST /validation/markdown`

## 5. Runtime Requirements

- Frontend environment:
  - `VITE_BATCH_BACKEND_URL` (optional explicit backend URL)
  - fallback proxy path `/api`

- Backend environment:
  - `BATCH_BACKEND_ENABLE_EXTENDED_API=true`
  - Deepgram and storage settings for transcription artifacts

- Full environment matrix:
  - `docs/reference/env.md`

## 6. Eventing and Polling

- Primary event stream is `GET /jobs/events` (SSE).
- Frontend still performs targeted polling for recording/job refresh where needed.
- If SSE is unavailable, UI should continue with explicit refresh paths.

## 7. Current Status and Gaps

Use the alignment tracker for live status:
- `docs/backend-frontend/backend-frontend-alignment.md`

This guide intentionally avoids phase-by-phase roadmap detail to prevent drift.

## 8. Related Active Docs

- Integration manual: `docs/PIPELINE_INTEGRATION_VISION.md`
- Transcription spec: `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`
- SSOT contracts: `docs/reference/agents-ssot.md`

## 9. Historical Docs

Earlier frontend vision and implementation-manual generations were archived:
- `docs/archive/frontend/README.md`
