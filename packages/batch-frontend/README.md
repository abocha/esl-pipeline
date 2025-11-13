# @esl-pipeline/batch-frontend

Minimal local UI for `@esl-pipeline/batch-backend`.

This frontend is intentionally small and explicit. It is meant for developers
working inside the ESL Pipeline monorepo who want:

- A quick way to submit jobs to `batch-backend`.
- A simple view of job status, timestamps, errors, and manifest paths.
- Clear wiring to the existing local `batch-backend` instance.
- Easy extension without extra frameworks or complex state management.

## Features

- Uses the documented public HTTP API:
  - `POST /jobs`
  - `GET /jobs/:jobId`
- Simple React + TypeScript + Vite stack.
- Type-safe request/response helpers in `src/utils/api.ts`.
- Configurable backend base URL (env or global).
- Minimal styling: inline, readable, no CSS framework.
- Explicit, developer-friendly error messages (including backend envelopes).

## Directory structure

Key files:

- `packages/batch-frontend/package.json`
- `packages/batch-frontend/vite.config.ts`
- `packages/batch-frontend/tsconfig.json`
- `packages/batch-frontend/index.html`
- `packages/batch-frontend/src/main.tsx`
- `packages/batch-frontend/src/utils/api.ts`
- `packages/batch-frontend/src/ui/App.tsx`
- `packages/batch-frontend/src/ui/JobForm.tsx`
- `packages/batch-frontend/src/ui/JobStatusViewer.tsx`
- `packages/batch-frontend/src/ui/JobsHelp.tsx`

## How it talks to batch-backend

The UI only uses the public HTTP endpoints provided by
[`createHttpServer.declaration()`](packages/batch-backend/src/transport/http-server.ts:53):

- Submit new job:
  - `POST /jobs`
  - Body (`SubmitJobRequest`):
    - `md: string` (required)
    - `preset?: string`
    - `withTts?: boolean`
    - `upload?: string`
  - Success (`202`): `{ "jobId": string }`
- Get job status:
  - `GET /jobs/:jobId`
  - Success (`200`): job DTO including
    - `jobId`, `state`, `createdAt`, `updatedAt`,
      `startedAt`, `finishedAt`, `manifestPath`, `error`.

Error envelopes from the backend (e.g. validation failures) are parsed and
shown as concise messages in the UI.

### Base URL / environment configuration

All HTTP calls are made through helpers in
[`src/utils/api.declaration()`](packages/batch-frontend/src/utils/api.ts:1).

Resolution order for the batch-backend base URL:

1. `window.__BATCH_BACKEND_URL__` (if defined)
2. `import.meta.env.VITE_BATCH_BACKEND_URL`
3. `""` (empty string) — meaning "same origin"

In local dev, `vite.config.ts` proxies `/jobs` to `http://localhost:8080`
by default:

- You can run `batch-backend` on `:8080` and use `/jobs` directly from the UI
  without worrying about CORS.
- To point at a different backend, either:
  - Set `BATCH_BACKEND_URL` when starting Vite (used by the dev proxy), or
  - Set `VITE_BATCH_BACKEND_URL` for direct calls.

## Local setup

Prerequisites (same as repo):

- Node.js 24.10.0+
- pnpm 8+ (`corepack enable`)
- A running `@esl-pipeline/batch-backend` instance

Typical local workflow:

1. Install dependencies at the repo root:
   - `pnpm install`

2. Start batch-backend and its dependencies.

   For example (conceptual; see repo docs/compose):
   - `docker-compose -f docker-compose.batch-backend.yml up -d`
   - This should expose `batch-backend` HTTP API on `http://localhost:8080`.

3. Start this frontend:
   - `pnpm --filter @esl-pipeline/batch-frontend dev`

4. Open the UI:
   - Visit `http://localhost:5173` in your browser.
   - Submit jobs and inspect their status.

### Dev configuration knobs

- `BATCH_BACKEND_URL`
  - Used by `vite.config.ts` as proxy target for `/jobs`.
  - Defaults to `http://localhost:8080`.
- `VITE_BATCH_BACKEND_URL`
  - If set, `src/utils/api.ts` uses this as the base URL instead of relative `/`.
  - Useful when serving the built app separately from the backend.
- `window.__BATCH_BACKEND_URL__`
  - Last-resort override: if your deployment injects a global before loading
    the bundle, the client will use that URL.

## UI overview

All components live under `src/ui` and are intentionally small:

- [`App.declaration()`](packages/batch-frontend/src/ui/App.tsx:18)
  - Layout shell.
  - Renders `JobForm`, `JobStatusViewer`, and `JobsHelp`.
  - Tracks `lastJobId` from successful submissions.
- [`JobForm.declaration()`](packages/batch-frontend/src/ui/JobForm.tsx:27)
  - Form for `POST /jobs`.
  - Inputs:
    - `md` (required), with sensible default like `./fixtures/first.md`.
    - `preset`, `withTts`, `upload` (optional).
  - On success:
    - Displays the returned `jobId`.
    - Notifies parent via `onJobCreated(jobId)`.
  - On error:
    - Shows backend validation/HTTP errors clearly.
- [`JobStatusViewer.declaration()`](packages/batch-frontend/src/ui/JobStatusViewer.tsx:22)
  - Single-job status inspector for `GET /jobs/:jobId`.
  - Features:
    - Text input for `jobId`.
    - "Load" button for on-demand fetch.
    - Optional polling toggle (every 2s) for live updates.
    - Displays state, timestamps, `manifestPath`, and `error`.
- [`JobsHelp.declaration()`](packages/batch-frontend/src/ui/JobsHelp.tsx:11)
  - Right-hand panel that documents:
    - How this UI integrates with `batch-backend`.
    - How to configure URLs.
    - Expected job lifecycle states.

## Type-safe API helpers

[`src/utils/api.declaration()`](packages/batch-frontend/src/utils/api.ts:1) defines:

- `SubmitJobRequest`, `SubmitJobResponse`
- `JobStatus`, `JobState`
- `createJob(body)`:
  - Calls `POST /jobs`.
  - Throws `Error` with:
    - HTTP status, and
    - Parsed `error` / `code` / `message` from backend envelope when present.
- `getJobStatus(jobId)`:
  - Calls `GET /jobs/:jobId`.
  - Throws similarly clear errors on 4xx/5xx.

These helpers keep the UI logic clean and make backend changes easier to track.

## Assumptions and limitations

- Assumes `@esl-pipeline/batch-backend` is reachable with the HTTP contracts
  defined in its README and SSOT.
- Does not list all jobs:
  - Only supports status lookup by `jobId` because that is the public API.
  - This keeps the scope minimal and aligned with current contracts.
- No authentication:
  - Mirrors `batch-backend` behavior (expected to be behind trusted ingress).
- Minimal error rendering:
  - Focused on clarity for developers (status code + backend message).
- Styling is deliberately basic:
  - Inline, no design system.
  - Easy to restyle or move into CSS modules later.

## Extending this frontend

Straightforward next steps if you need more:

- Add routing (e.g. React Router) for multi-page views.
- Introduce a table or history view if/when `batch-backend` exposes a list API.
- Wire into a shared design system or CSS utility library.
- Add tests (e.g. Vitest + React Testing Library) around:
  - `createJob` / `getJobStatus`
  - Form validation
  - Polling behavior

For significant changes, align with:

- [`docs/batch-backend-ssot.md`](docs/batch-backend-ssot.md)
- [`docs/agents-ssot.md`](docs/agents-ssot.md)
