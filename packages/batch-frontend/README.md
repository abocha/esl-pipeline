# @esl-pipeline/batch-frontend

## Meta

- Audience: maintainers and implementing agents.
- Authority Level: Package entrypoint and operational usage guide.
- Last Verified Against: 2026-03-09 repo state.
- Owner: batch-frontend maintainers + automation agents.
- Review Cadence: monthly or after major UI/workflow changes.
- Status: `active`.

React + Vite console for `@esl-pipeline/batch-backend`. This is a minimal,
operator-facing UI that focuses on the core workflow only.

## Features

- Authenticated minimal assignment console.
- Optional student selection in step 1 (defaults to `Default` when available).
- Upload recording → review transcript → generate prompt → paste draft → validate → publish.
- Prompt generation defers profile choice to backend precedence (`profileId` override, then student-linked
  profile, then configured default).
- Optional Anytype/Notion publish target selection in the publish step.
- Job action controls for `rerun_audio`, `rerun_publish`, and `cancel` (capability-gated from backend metadata).
- Typed API client backed by `@esl-pipeline/contracts`.

## Directory structure

Key files and folders:

- `packages/batch-frontend/src/main.tsx` - app entry, providers, router.
- `packages/batch-frontend/src/utils/api.ts` - typed API helpers.
- `packages/batch-frontend/src/ui/App.tsx` - minimal routes.
- `packages/batch-frontend/src/ui/minimal/*` - minimal assignment flow.
- `packages/batch-frontend/src/ui/shared/*` - shared widgets.
- `packages/batch-frontend/src/context/*` - auth + theme providers.

## Backend integration

The frontend uses the authenticated, extended HTTP API exposed by `batch-backend`.
Common endpoints for the minimal flow:

- Auth: `POST /auth/login`, `POST /auth/register`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`
  - Refresh tokens are stored in HttpOnly cookies; the client refreshes on load.
- Jobs: `POST /jobs`, `GET /jobs/:jobId`, `POST /jobs/:jobId/approve`,
  `POST /jobs/:jobId/actions`
- Recordings: `POST /recordings/upload`, `POST /recordings/:id/transcribe`, `GET /recordings/:id`,
  `GET /recordings/:id/transcript`, `PUT /recordings/:id/transcript`, `GET /recordings/:id/audio`
- Drafts: `GET /drafts/:id`, `POST /prompt-packages/:id/draft`, `POST /drafts/:id/materialize`
- Config: `GET /config/job-options`, `GET /config/prompts`

All requests go through `src/utils/api.ts` and are typed with `@esl-pipeline/contracts`.

## Base URL / environment configuration

Requests resolve the backend base URL in this order:

1. `window.__BATCH_BACKEND_URL__`
2. `import.meta.env.VITE_BATCH_BACKEND_URL`
3. `process.env.BATCH_BACKEND_URL` (Node-only)
4. empty string

When no base URL is provided, the client prefixes requests with `/api`. The Vite
dev server proxies `/api` to the backend and strips the prefix.

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

- The minimal console assumes authenticated sessions; register/login in the UI to populate the auth context.
- The app depends on authenticated sessions; register/login in the UI to populate the auth context.
