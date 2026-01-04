# @esl-pipeline/batch-frontend

React + Vite console for `@esl-pipeline/batch-backend`. This is an internal UI
for operators and assumes the extended API is enabled with authentication.

## Features

- Authenticated dashboard with quick actions, activity feed, pending approvals, and weekly summary.
- Route-based navigation: Dashboard, Wizard (placeholder), Students, Jobs, Settings.
- Job monitoring with SSE plus persisted active jobs.
- Transcription workspace for recordings, transcript review, prompt packages, and draft materialization.
- Student workspace with CRUD, profiles, and timelines.
- Typed API client backed by `@esl-pipeline/contracts`.

## Directory structure

Key files and folders:

- `packages/batch-frontend/src/main.tsx` - app entry, providers, router.
- `packages/batch-frontend/src/utils/api.ts` - typed API helpers.
- `packages/batch-frontend/src/ui/App.tsx` - layout shell + routes.
- `packages/batch-frontend/src/ui/dashboard/*` - dashboard panels.
- `packages/batch-frontend/src/ui/notifications/*` - notifications panel.
- `packages/batch-frontend/src/ui/transcription`, `students`, `jobs`, `settings`, `uploader`.
- `packages/batch-frontend/src/context/*` - auth, job monitor, settings, selections, notifications.

## Backend integration

The frontend uses the authenticated, extended HTTP API exposed by `batch-backend`.
Common endpoints:

- Auth: `POST /auth/login`, `POST /auth/register`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`
- Jobs: `POST /jobs`, `GET /jobs/:jobId`, `GET /user/jobs`, `GET /user/jobs/summary`, `GET /jobs/events`
- Recordings: `POST /recordings/upload`, `POST /recordings/:id/transcribe`, `GET /recordings/:id`,
  `GET /recordings/:id/transcript`, `PUT /recordings/:id/transcript`, `GET /recordings/:id/audio`
- Drafts: `GET /drafts/:id`, `POST /prompt-packages/:id/draft`, `POST /drafts/:id/materialize`
- Config + students: `GET /config/job-options`, `GET /config/students`, `GET /config/prompts`,
  `GET /students`, `GET /students/:id`, `GET /students/:id/timeline`, `GET /students/summary`,
  plus student/profile CRUD.

All requests go through `src/utils/api.ts` and are typed with `@esl-pipeline/contracts`.

## Base URL / environment configuration

Requests resolve the backend base URL in this order:

1. `window.__BATCH_BACKEND_URL__`
2. `import.meta.env.VITE_BATCH_BACKEND_URL`
3. `process.env.BATCH_BACKEND_URL` (Node-only)
4. empty string

When no base URL is provided, the client prefixes requests with `/api`. The Vite
dev server proxies `/api` (and other API routes) to the backend and strips the prefix.

## Local setup

Prereqs: Node.js 24.11.1+, pnpm 8+, running `@esl-pipeline/batch-backend` with
`BATCH_BACKEND_ENABLE_EXTENDED_API=true`.

1. `pnpm install` (repo root)
2. Start backend (example): `cd packages/batch-backend && pnpm dev`
3. Start frontend: `pnpm --filter @esl-pipeline/batch-frontend dev`
4. Open `http://localhost:5173`

### Dev configuration knobs

- `BATCH_BACKEND_URL` - sets the Vite dev proxy target (default `http://localhost:8080`)
- `VITE_BATCH_BACKEND_URL` - sets the client base URL for direct calls
- `window.__BATCH_BACKEND_URL__` - runtime override for deployed builds

## Notes

- `/wizard` is currently a placeholder; Stage 2 replaces it with the multi-step wizard.
- The app depends on authenticated sessions; register/login in the UI to populate the auth context.
