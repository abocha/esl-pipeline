# ESL Pipeline Batch System Guide

This document is the unified reference for the batch frontend and backend system. For detailed backend internals, see [`batch-backend-ssot.md`](batch-backend-ssot.md). For API contract status, see [`backend-frontend-alignment.md`](backend-frontend-alignment.md).

---

## 1. System Overview

The batch system enables tutors to process multiple ESL homework assignments through a web interface:

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Batch Frontend │────▶│  Batch Backend   │────▶│   Orchestrator  │
│  (React + Vite) │ SSE │  (Fastify+Redis) │     │   (Pipeline)    │
└─────────────────┘◀────└──────────────────┘     └─────────────────┘
```

**Key capabilities:**
- Dashboard home with quick actions, activity stream, pending approvals, and weekly summary
- Route-based navigation (Dashboard, Wizard, Students, Jobs, Settings)
- Multi-file drag-and-drop upload
- Real-time job progress via Server-Sent Events (SSE)
- Job actions: copy Notion link, regenerate audio (pending)
- Authentication with email/password
- Transcription workspace (recording scan, transcript review, prompt package, draft)
- Student workspace (student selection, profile CRUD, timeline)

---

## 2. User Journey

1. Tutor logs in with email + password
2. Lands on the Dashboard with quick actions and pending approvals
3. Starts a new assignment or opens an awaiting approval job
4. Configures job settings (TTS, preset, voice, Notion DB) and submits
5. SSE stream shows real-time progress in the jobs table and activity feed
6. On completion, tutor receives notification and can copy Notion link

Phase 2+ (native transcription, implemented with gaps):
1. Recordings are scanned from a mounted folder and transcribed via Deepgram.
2. Tutor reviews transcript, assembles prompt package, and saves draft.
3. Draft is materialized and approved through the existing job approval flow.
4. Recording list supports search plus status/source/student filters.
5. Student workspace allows selection, profile editing, and timeline review.

---

## 3. Frontend Architecture

### Page Layout

```
┌────────────────────────────────────────────────────────────┐
│ Header (branding, nav, theme, user)                        │
├────────────────────────────────────────────────────────────┤
│ Route content                                              │
│ - Dashboard: quick actions, activity feed, pending approvals, weekly summary
│ - Wizard: multi-step assignment flow (select → transcript → notes → review → publish)
│ - Students: student workspace
│ - Jobs: job table + activity feed + notifications
│ - Settings: job settings + notifications
└────────────────────────────────────────────────────────────┘
```

### Components

| Component | Responsibility |
|-----------|---------------|
| `AuthProvider` | Login/register modals, session context |
| `Dashboard` | Quick actions + summary panels |
| `PendingApprovals` | Awaiting approval jobs + deep links |
| `WeeklySummary` | Job + student summary panels |
| `JobMonitorProvider` | SSE + job/recording hydration |
| `JobUploader` | Multi-file upload, per-file progress |
| `JobSettingsForm` | Preset, TTS, voice, Notion DB dropdowns |
| `StudentWorkspace` | Student list, profile metadata/content, timeline |
| `JobTable` | Job list with actions |
| `ActivityFeed` | Chronological event log from SSE |
| `NotificationsPanel` | Notification settings + recent notices |

### State Management

- **React Query**: cache API responses (jobs, config, user)
- **React Context**: auth, job monitor, settings, student selection, notifications, theme
- **Local state**: upload queue, activity feed, wizard forms

---

## 4. Backend Integration Points

| Endpoint | Purpose |
|----------|---------|
| `POST /uploads` | Upload .md files (returns file identifier) |
| `POST /jobs` | Submit job with settings |
| `GET /jobs/:id` | Get job status |
| `GET /jobs/events` | SSE stream for real-time updates |
| `GET /config/job-options` | Load presets, voices, Notion DBs |
| `POST /auth/login` | Email/password login |
| `POST /auth/register` | User registration |
| `POST /auth/refresh` | Refresh access token (uses refresh cookie) |
| `POST /auth/logout` | Clear refresh cookie |
| `GET /auth/me` | Fetch user profile (access token required) |
| `GET /students` | List student profiles |
| `GET /students/summary` | Student summary (last lesson + pending drafts) |
| `GET /students/:id` | Read student profile |
| `POST /students` | Create student profile |
| `PUT /students/:id` | Update student profile |
| `DELETE /students/:id` | Delete student profile |
| `GET /students/:id/timeline` | Student timeline (supports `type`/`status` filters and pagination; `job_awaiting_approval` for pending approvals) |
| `GET /profiles` | List prompt profiles |
| `GET /profiles/:id` | Read prompt profile text |
| `PUT /profiles/:id` | Update prompt profile text |
| `DELETE /profiles/:id` | Delete prompt profile text |
| `GET /drafts/:id` | Read draft text |
| `POST /drafts/:id/materialize` | Materialize draft (optional job overrides) |
| `GET /recordings/:id/audio` | Stream recording audio (Range supported) |
| `POST /validation/markdown` | Validate markdown (errors/warnings/meta) |
| `GET /user/jobs` | List jobs for current user (filters + pagination) |
| `GET /user/jobs/summary` | Job summary counts for dashboard |
| `POST /jobs/:jobId/actions` | Job actions (`edit_metadata`, `rerun_audio`, `cancel`) |

All extended routes require `BATCH_BACKEND_ENABLE_EXTENDED_API=true`.

---

## 5. SSE Real-Time Updates

- Connect via `new EventSource('/jobs/events', { withCredentials: true })`
- Events update React Query job cache
- Reconnection: exponential backoff (1s, 2s, 5s, max 30s)
- Fallback: polling when SSE disconnects
- Show banner: "Live updates unavailable"

---

## 6. Job Settings

| Field | Type | Description |
|-------|------|-------------|
| `preset` | dropdown | Notion color preset |
| `withTts` | switch | Enable TTS generation |
| `forceTts` | switch | Force regenerate even if cached |
| `voiceAccent` | dropdown | british/american preference |
| `voiceId` | dropdown | explicit voice selection |
| `notionDatabase` | dropdown | Target Notion DB |
| `ttsStrategy` | dropdown | auto/dialogue/tts |
| `upload` | radio | auto/s3/none |

---

## 7. Job Actions

| Action | Status | Behavior |
|--------|--------|----------|
| Copy Notion Link | ✅ Ready | Copies `notionUrl` to clipboard |
| Edit Metadata | ✅ Ready | Updates preset/voice/tts fields for awaiting_approval jobs |
| Regenerate Audio | ⏳ Pending | Stub returns 501 |
| Cancel Job | ⏳ Pending | Stub returns 501 |

---

## 8. Error Handling

- **Upload errors**: inline per-file with retry button
- **SSE disconnect**: warning banner + polling fallback
- **Auth errors**: surface in form (invalid credentials, etc.)
- **Rate limits**: toast with wait time

---

## 9. Development Quickstart

```bash
# Install
pnpm install

# Configure backend URL (optional)
export VITE_BATCH_BACKEND_URL=http://localhost:8080
# or set the dev proxy target
export BATCH_BACKEND_URL=http://localhost:8080

# Start frontend
cd packages/batch-frontend && pnpm dev

# Start backend (requires Postgres + Redis)
cd packages/batch-backend && pnpm dev
```

Environment: Set `BATCH_BACKEND_ENABLE_EXTENDED_API=true` on backend.

---

## 10. Related Documentation

- **Backend Architecture**: [`batch-backend-ssot.md`](batch-backend-ssot.md)
- **API Contracts & Status**: [`backend-frontend-alignment.md`](backend-frontend-alignment.md)
- **Environment Variables**: [`../reference/env.md`](../reference/env.md)
- **Frontend Design Vision**: [`../design/FRONTEND_VISION.md`](../design/FRONTEND_VISION.md)
