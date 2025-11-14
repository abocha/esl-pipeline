# Batch Frontend – Detailed Design

This document captures the end-to-end design for the revamped batch frontend that tutors use to upload Markdown lessons, submit jobs to `@esl-pipeline/batch-backend`, and monitor progress in real time. It covers UI structure, backend integrations, state handling, and extensibility points so that we have a single reference for implementation.

---

## 1. User Journey (“Happy Path”)

1. Tutor opens the frontend and logs in with email + password.
2. Tutor drags five `.md` lesson files into the uploader, tweaks job settings (TTS, preset, voice, Notion DB, etc.), and clicks “Submit”.
3. The UI uploads each file to `/uploads`, immediately POSTs `/jobs` with the returned `md` identifier and selected options, and shows the jobs in the “Active Jobs” table.
4. The frontend opens a Server-Sent Events (SSE) stream to `/jobs/events`. As the backend workers process the jobs, status updates stream into the table instantly.
5. When every job in the current batch finishes, the tutor gets a toast + browser notification. They can copy the Notion link or click “Regenerate audio” on any job that needs a different voice/seed.

---

## 2. Authentication

- **Protocol**: Email/password only (no OAuth yet).
- **Endpoints**:
  - `POST /auth/register` – email, password, optional role. Returns success only; user logs in afterwards.
  - `POST /auth/login` – email + password. Backend sets HttpOnly access/refresh cookies and returns user payload (id, email, role, isActive).
  - `POST /auth/refresh` – refresh token rotation (HttpOnly cookies).
  - `GET /auth/me` – returns current user data for session restoration.
- **Frontend behaviors**:
  - `AuthContext` stores `user` in React state and in `localStorage` (best-effort). Tokens remain in cookies only.
  - Login form sits in the header; register form is accessible via modal or toggle.
  - When unauthenticated, job submission/upload controls are disabled with inline messaging.
  - Logout clears context and sends `POST /auth/logout` (to clear cookies) once we add that endpoint; until then, it simply wipes local state.

---

## 3. API Surface & Backend Expectations

### 3.1 Job Submission

- `POST /uploads`
  - Accepts multipart form (`file` field).
  - Returns `{ id, md, url?, ... }`.
  - Requires authentication (extended API flag must be enabled).
- `POST /jobs`
  - Body:
    ```jsonc
    {
      "md": "uploads/<user>/<uuid>_lesson.md",
      "preset": "b1-default",
      "withTts": true,
      "forceTts": false,
      "voiceAccent": "american_female",
      "notionDatabase": "db-id-or-alias",
      "mode": "auto",        // future option (auto/dialogue/monologue)
      "upload": "auto"       // auto | s3 | none
    }
    ```
  - Returns `{ jobId }`.
  - Requires authentication.

### 3.2 Job Monitoring

- `GET /jobs/:jobId` – used for initial fetch / manual refresh.
- `GET /jobs/events` (new) – SSE stream that emits:
  ```json
  {
    "type": "job_state_changed",
    "jobId": "uuid",
    "state": "running",
    "payload": {
      "manifestPath": "...",
      "error": null,
      "finishedAt": null,
      "runMode": "auto",
      "submittedMd": "uploads/...md"
    }
  }
  ```
  - We may include additional event types later (e.g., `job_created`, `job_failed`).
  - Frontend subscribes once after auth and updates in-memory job data live.
- `/jobs/:jobId/rerun/audio` (future) – endpoint to regenerate audio only. For now the “Regenerate audio” button will call a stub (warn user that the feature is under construction).

### 3.3 Metadata Endpoints (recommended)

Add a lightweight config endpoint so the UI stays in sync with backend settings:
- `GET /config/job-options`
  ```json
  {
    "presets": ["b1-default", "c1-science"],
    "voiceAccents": ["american_female", "british_male", "australian_female"],
    "notionDatabases": [
      { "id": "uuid-123", "name": "B1 Lessons" },
      { "id": "uuid-456", "name": "B2 Lessons" }
    ],
    "uploadOptions": ["auto", "s3", "none"],
    "modes": ["auto", "dialogue", "monologue"]
  }
  ```
  - Modes can stay hidden/disabled until the orchestrator branch lands.

---

## 4. UI Architecture

### 4.1 Page Layout

```
┌────────────────────────────────────────────────────────────┐
│ Header                                                     │
│ ├─ Branding (“ESL Pipeline Batch Jobs”)                    │
│ ├─ Auth status (Login/Register buttons or user info)       │
│ └─ Global actions (Logout, settings)                       │
├────────────────────────────────────────────────────────────┤
│ Main                                                       │
│ ├─ Left Column (2/3 width)                                 │
│ │  ├─ Job Submission Panel                                 │
│ │  │  ├─ Drag/drop multi-file zone                         │
│ │  │  ├─ Settings form (presets, TTS, voices, etc.)        │
│ │  │  └─ Submission queue list (each file’s upload status) │
│ │  └─ Active Jobs Table                                    │
│ │     ├─ Search/filter + polling toggle                    │
│ │     ├─ Table of jobs (status pill, times, actions)       │
│ │     └─ Row actions: “Copy Notion Link”, “Regenerate TTS” │
│ └─ Right Column (1/3 width)                                │
│    ├─ JobsHelp / instructions                              │
│    ├─ Activity feed (“Job X succeeded”, “Job Y failed…”)   │
│    └─ Notification opt-in (toggle for browser notifications)│
└────────────────────────────────────────────────────────────┘
```

### 4.2 Components & Responsibilities

- **AuthProvider** – handles login/register modals, context, cookie restoration.
- **JobUploader**:
  - Accepts multiple files.
  - Shows per-file progress (upload → job submission).
  - Applies global settings (preset, voice, etc.) to each job, with per-file overrides if needed.
- **JobSettingsForm**:
  - Inputs:
    - `withTts` (switch)
    - `forceTts` (switch)
    - `preset` (dropdown)
    - `voiceAccent` (dropdown)
    - `notionDatabase` (dropdown)
    - `mode` (disabled until orchestrator updates)
    - `uploadOption` (radio buttons: `auto`, `force s3`, `skip`)
  - “Apply to all queued jobs” checkbox.
- **JobTable**:
  - Displays jobs submitted this session (and optionally recently completed jobs loaded from backend).
  - Columns: jobId, file, state, createdAt, startedAt, finishedAt, manifestPath, voice/preset summary.
  - Row actions:
    - Copy Notion link (clipboard icon).
    - Regenerate audio (button; calls stub until new endpoint exists).
- **ActivityFeed**:
  - Chronological list of events (state transitions, errors).
  - Taps SSE stream for entries.
- **NotificationManager**:
  - Requests browser notification permission.
  - Sends notification when all jobs in a batch succeed or when any job fails.

---

## 5. Real-Time Updates (SSE)

- **Connection**: Once the tutor logs in, the frontend opens `new EventSource(<backend>/jobs/events, { withCredentials: true })`.
- **Authentication**: SSE endpoint should honor the same cookies/session as the HTTP API.
- **Reconnection**: Implement exponential backoff reconnect (e.g., after 1s, 2s, 5s, max 30s). While disconnected, show a warning banner (“Live updates unavailable; falling back to manual refresh”).
- **Data flow**:
  - SSE events update the job map in React Query.
  - If an event is received for a job we don’t know about, append it to the table (useful if multiple clients are active).
  - When an event indicates `state: succeeded` or `failed`, push entry to ActivityFeed and check notification conditions.

---

## 6. Rate Limiting & TTS Concurrency

- **Backend responsibility**: Orchestrator/batch-backend must enforce ElevenLabs concurrency (3 simultaneous requests for the “starter” tier). Implementation options:
  - Redis-based semaphore that wraps the TTS adapter.
  - Dedicated BullMQ queue for TTS tasks with concurrency=3.
  - Configurable limit via env (`ELEVENLABS_CONCURRENCY_LIMIT`).
- **Frontend responsibilities**:
  - Display state hints (e.g., if backend exposes `waitingForTtsSlot: true`, show “Waiting for TTS capacity” in the row).
  - Do NOT attempt to throttle submissions—the tutor should be able to queue unlimited jobs.
  - Respect backend rate limits for our own requests (batch job creation already goes through queue; SSE is a single connection; uploads are sequential or limited concurrency by default).

---

## 7. Job Actions

- **Copy Notion Link**:
  - Each job row includes an icon button.
  - If `manifestPath` includes a Notion URL (or backend returns `notionUrl`), copy that to clipboard.
  - Otherwise copy `manifestPath` or show “Not available yet”.
- **Regenerate Audio**:
  - Shown for jobs with `state = succeeded`.
  - For now it triggers a modal with a warning (“Audio regeneration is coming soon”). Once the new backend endpoint exists, it will POST e.g. `/jobs/:jobId/rerun/audio` with selected voice/preset overrides and add the rerun job to the table.
  - Make sure concurrency limits still apply; backend should treat reruns like normal jobs.

---

## 8. State Management & Libraries

- Use **React Query** to cache:
  - Job status responses (`GET /jobs/:id`).
  - Config metadata (`/config/job-options`).
  - User profile (`/auth/me`).
- Use **React Context** for:
  - Auth (`AuthContext`).
  - SSE connection state (optional).
- Maintain local state for:
  - Submission queue (files + settings).
  - Activity feed (recent events).
  - Notifications (pending/completed).

---

## 9. Error Handling & UX

- **Uploads**: show inline errors per file with retry button.
- **Job submission**: on failure, highlight the affected file, keep others processing.
- **SSE disconnect**: display banner + fallback to manual refresh.
- **Auth**: surface backend messages (invalid credentials, weak password, etc.) directly in forms.
- **Rate limit errors**: if backend returns `429`, show toast (“Rate limit exceeded, please wait X seconds”).

---

## 10. Extensibility Roadmap

- Plug in the upcoming “mode” options (auto/dialogue/monologue) once orchestrator merges `feature/new-module`.
- Replace SSE with WebSockets if we later need bi-directional control (e.g., cancel jobs).
- Add global job search once backend exposes list endpoints.
- Integrate email/SMS notifications when backend supports it.
- Swap authentication to OAuth when the connector is ready—keep the current context modular so we can inject new providers.

---

## 11. Implementation Checklist

1. **Backend**:
   - Implement `/jobs/events` SSE + metadata endpoint (`/config/job-options`).
   - Ensure `/uploads`, `/jobs`, `/auth/*` are available when extended API flag is enabled.
   - Add TTS concurrency limit (Redis semaphore or queue).
   - Expose Notion URLs in job status (or a dedicated field for the copy button).
   - Provide stub for audio regeneration (even if it just returns “Not implemented yet”).
2. **Frontend**:
   - Refactor API client to drop `/api` prefix or rewrite via proxy.
   - Build new `JobUploader`, `JobSettingsForm`, `JobTable`, `ActivityFeed`, and `NotificationManager` components.
   - Implement SSE listener with reconnect + fallback.
   - Add auth modals and context.
   - Finalize job actions (copy link, regen audio stub).
   - Polish UX (toasts, tooltips, responsive layout).
3. **Testing**:
   - Add unit tests for API helpers and auth context.
   - E2E smoke test: upload multiple files, see SSE updates, copy link, etc. (Playwright/Cypress optional).
   - Verify rate-limit/backoff behaviors.

---

By following this design, the batch frontend will provide a smooth, real-time experience for tutors: log in, drag/drop lessons, tweak options, watch jobs progress instantly, and re-run audio when necessary—all while respecting backend constraints and paving the way for future features. Let's keep this document updated as the implementation evolves. 
