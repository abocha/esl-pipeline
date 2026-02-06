# Auth Refresh Cookies + Wizard State Persistence Plan

Status: draft implementation plan

## Goals

- Keep tutors logged in across reloads and idle time.
- Preserve wizard progress (jobId, notes, draft, etc.) across reloads.
- Match the frontend vision: resilience, never lose context.

## Proposed Approach (Recommended)

- Use a short-lived access token (sent via `Authorization: Bearer`) and a long-lived refresh token stored as an HttpOnly cookie.
- On app load, call `/auth/refresh` to obtain a new access token + user profile.
- Persist wizard state locally, keyed by user, and restore on load.

## Backend Changes

### Auth endpoints

- `POST /auth/login`
  - Set refresh cookie (HttpOnly, Secure, SameSite).
  - Return `accessToken` + user in response body.
- `POST /auth/refresh`
  - Read refresh token from cookie (no body token).
  - Issue new access token + refresh cookie; return user.
- `POST /auth/logout`
  - Clear refresh cookie.

### Middleware

- Keep Bearer token auth for API requests.
- (Optional) later: allow access token from cookie.

## Frontend Changes

### Auth context

- Remove refresh token from localStorage entirely.
- Keep access token in memory; set Bearer header for API calls.
- On load, call `/auth/refresh`, set user + access token.

### Wizard state persistence

- Persist `WizardState` to `localStorage`, keyed by user:
  - `esl-wizard-state:<userId>`
- Store:
  - `currentStep`, `activeJobId`, `jobState`, `jobMd`
  - `recordingId`, `transcriptId`, `transcriptText`
  - `promptPackageId`, `draftId`, `draftText`
  - `notes`, `templateId`, `profileId`
  - `overrides`
  - `version` + `updatedAt`
- Restore on mount if authenticated.
- URL params `step`/`jobId` take precedence.
- Clear on logout or explicit wizard reset.

## Security & CORS

- If UI and API share a site:
  - Use `SameSite=Lax; Secure`.
- If cross-site:
  - Use `SameSite=None; Secure`.
  - Add CSRF protection for refresh/logout.

## Tests & Docs

- Update auth docs (`docs/backend-frontend/BATCH_SYSTEM.md`).
- Add tests for refresh bootstrap and wizard persistence.

## Implementation Plan (Stageable)

1. Backend: refresh-cookie auth
   - Add refresh cookie set/clear helpers.
   - Update `/auth/login` to set refresh cookie, return access token + user.
   - Update `/auth/refresh` to read refresh cookie, rotate, return access token + user.
   - Add `/auth/logout` to clear refresh cookie.
   - Keep Bearer auth for existing endpoints.

2. Frontend: auth bootstrap
   - Remove refresh token storage from localStorage.
   - Call `/auth/refresh` on app load; set access token in memory.
   - Ensure axios uses `withCredentials: true` (already set).

3. Wizard: state persistence
   - Persist wizard state to `localStorage` keyed by `userId`.
   - Include `version` + `updatedAt`.
   - Restore on mount; URL `step`/`jobId` win.
   - Clear on logout or wizard reset.

4. Tests + docs
   - Update batch system auth docs.
   - Add unit test(s) for wizard persistence + auth refresh flow.
