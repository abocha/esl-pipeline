# Batch Frontend Implementation Plan

This plan breaks the work into bite-sized phases for a junior developer. Tackle the phases in order; each should be completable in a single focused session.

---

## Phase 1 – Project Setup & Groundwork

1. **Clean start**
   - Ensure `pnpm install` runs cleanly at repo root.
   - Remove any unused auth/upload code that no longer fits the new design (e.g., the existing JobForm if it’s easier to start fresh). Keep the AuthContext as a placeholder if we plan to reuse parts of it.
2. **API client adjustments**
   - Update `src/utils/api-client.ts` so the Axios base URL targets the actual backend (`/jobs`, `/uploads`, etc.) instead of `/api` or add a proxy rewrite in Vite.
   - Add helper functions to fetch metadata (`/config/job-options`) and open SSE streams.
3. **State libraries**
   - Install and configure React Query (or confirm it’s already in the template).
   - Set up a query client provider in `src/main.tsx`.
4. **Documentation check**
   - Review `design-batch-frontend.md` to understand the desired components and flows.
   - Confirm there’s no missing dependency (e.g., for toasts or notifications). If we plan to use a lightweight library (like `react-hot-toast`), add it now.

_Deliverable_: Clean base, updated API helpers, React Query wired up.

---

## Phase 2 – Authentication Flow

1. **Auth context refactor**
   - Revisit `src/context/AuthContext.tsx`. Streamline it so it:
     - Restores user data from `/auth/me` on load.
     - Provides `login`, `register`, `logout`, and `refresh` functions.
     - Stores minimal user info and exposes `isAuthenticated`.
   - Remove unused cookie helpers from the previous implementation (if any).
2. **UI components**
   - Create a header section containing:
     - Branding text.
     - Auth status: if logged in, show user email + logout button; if not, show “Login” / “Register” buttons.
   - Implement login and register forms (modal or inline). Fields:
     - Login: email, password.
     - Register: email, password, confirm password, optional role dropdown.
     - Show backend error messages via inline alerts.
3. **Guarding content**
   - Wrap the rest of the app in `AuthProvider`.
   - Show a friendly message in the main area if the user is not authenticated (“Please log in to submit jobs”).

_Deliverable_: Auth flow works end to end (register → login → header updates → logout).

---

## Phase 3 – Metadata & Settings Panel

1. **Metadata fetch**
   - Add a React Query hook to fetch `/config/job-options` on app load.
   - Provide sensible fallback values if the endpoint is unavailable (e.g., hardcoded presets).
2. **Job settings component**
   - Build `JobSettingsForm` with the following controls:
     - `preset` dropdown (options from metadata).
     - `voiceAccent` dropdown.
     - `notionDatabase` dropdown.
     - `withTts` toggle.
     - `forceTts` toggle.
     - `upload` radio group (`auto`, `s3`, `none`).
     - Reserved section for `mode` (render input but disable it with helper text “Coming soon when dialogue/monologue modes land”).
   - Provide an “Apply to pending uploads” checkbox.
3. **State management**
   - Store the current settings in context or in the uploader component so both the uploader and job table can access them.

_Deliverable_: Settings panel fully interactive with data from the backend.

---

## Phase 4 – Multi-File Upload & Job Submission

1. **Drag-and-drop uploader**
   - Implement a new `JobUploader` component:
     - Drag/drop area + “Select files” button.
     - List each selected `.md` file with name, size, and status (idle/uploading/submitted/error).
   - For each file:
     - Sequentially (or with limited concurrency) upload to `/uploads`.
     - On success, call `POST /jobs` with the current settings + returned `md`.
     - Store the backend `jobId` in the file entry.
2. **Error handling**
   - If upload or job submission fails, show an inline error and provide a “Retry” button for that file.
   - Ensure other files continue processing even if one fails.
3. **Integration with settings**
   - Apply the currently selected settings to each job. Allow per-file overrides if time permits (not required initially).

_Deliverable_: Dragging multiple files submits multiple jobs; the UI shows each file’s progress and final job id.

---

## Phase 5 – Job Table & Activity Feed

1. **Data structures**
   - Maintain a map/list of submitted jobs in React state (or a React Query store). Each entry should hold:
     - File name (for display).
     - Backend `jobId`.
     - Latest status data (state, timestamps, manifest path, etc.).
   - Support manual addition (e.g., letting the user paste a jobId manually).
2. **Job table UI**
   - Build a table with columns: jobId, file, state (colored pill), createdAt, startedAt, finishedAt, manifest path, actions.
   - Add search/filter input to quickly find job IDs.
   - Provide a global “Pause live updates” toggle (for SSE fallback).
3. **Activity feed on the right**
   - Simple list of events (“Job lesson1.md succeeded at 12:34”).
   - Keep only the latest ~20 entries to avoid unbounded growth.

_Deliverable_: Jobs submitted in Phase 4 appear in the table, and the feed logs state transitions (for now, from manual updates or placeholders).

---

## Phase 6 – Real-Time SSE Updates

1. **Backend coordination**
   - Confirm `/jobs/events` is available; ask the backend team if any work remains.
2. **Frontend SSE listener**
   - Create a hook (`useJobEvents`) that opens an EventSource connection with credentials.
   - Handle `message` events, parse JSON, and update the job map.
   - Implement reconnect logic (clear intervals, try again with backoff).
   - Provide status (connected/disconnected) to the UI for display.
3. **Fallback polling**
   - If SSE isn’t supported or keeps failing, fall back to polling `GET /jobs/:id` every 5 s for active jobs.
   - Add a banner indicating when fallback is active.

_Deliverable_: Job statuses update instantly when backend state changes; no manual refresh needed under normal circumstances.

---

## Phase 7 – Notifications & Job Actions

1. **Browser notification opt-in**
   - Prompt the user (once) to allow notifications.
   - When all jobs in the current batch succeed, send a notification (“All 5 lessons are ready!”).
   - Also notify on failures (“Job lesson2.md failed: <error>”).
2. **Job actions**
   - **Copy Notion link**:
     - Add a clipboard icon that copies `status.notionUrl` (or `manifestPath`) to the clipboard with a toast (“Copied!”).
   - **Regenerate audio button**:
     - Visible for succeeded jobs.
     - For now, show a modal that says “Audio regeneration is under construction.” Later it will call a backend rerun endpoint.
3. **UI polish**
   - Add toasts for uploads, submissions, and notifications.
   - Ensure actions are disabled appropriately (e.g., copy link disabled if no manifest).

_Deliverable_: Tutors get notified when jobs finish and can copy Notion links; buttons exist for future audio regeneration.

---

## Phase 8 – Testing & Cleanup

1. **Unit tests**
   - Add tests for API helpers (mock Axios).
   - Write tests for AuthContext (login/logout flows).
   - Test JobSettings state changes.
2. **Manual end-to-end verification**
   - Run backend via Docker compose.
   - Start frontend (`pnpm dev`).
   - Register/log in, upload multiple files, verify SSE updates, copy Notion link, etc.
3. **Docs & housekeeping**
   - Update `README.md` and `design-batch-frontend.md` with any deviations.
   - Ensure `implementation-plan-batch-frontend.md` stays accurate as tasks complete.
   - Remove console logs and commented code; run `pnpm lint` / `pnpm typecheck`.

_Deliverable_: Tested, polished frontend aligned with the design doc.

---

## Tips for Each Phase

- Commit after every phase (or major subtask) so you can revert easily if needed.
- Keep screenshots or GIFs of the UI as it evolves—useful for review and documentation.
- Communicate with the backend team if any endpoint is missing or needs adjustments (especially for SSE and metadata).
- Don’t hesitate to create small utility components (e.g., `Toggle`, `Select`) to keep the UI consistent.

By following these phases sequentially, we build the new frontend in manageable steps while covering every requirement from the design document. Each phase stands on its own, so if priorities shift we can pause after a phase and still have a working slice of functionality. 
