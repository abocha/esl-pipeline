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
- Multi-file drag-and-drop upload
- Real-time job progress via Server-Sent Events (SSE)
- Job actions: copy Notion link, regenerate audio (pending)
- Authentication with email/password
- Phase 2+ transcription workspace (recording scan, transcript review, prompt package, draft)

---

## 2. User Journey

1. Tutor logs in with email + password
2. Drags lesson `.md` files into the uploader
3. Configures job settings (TTS, preset, voice, Notion DB)
4. Clicks "Submit" — files upload, then jobs are created
5. SSE stream shows real-time progress in the jobs table
6. On completion, tutor receives notification and can copy Notion link

Phase 2+ (native transcription, implemented with gaps):
1. Recordings are scanned from a mounted folder and transcribed via Deepgram.
2. Tutor reviews transcript, assembles prompt package, and saves draft.
3. Draft is materialized and approved through the existing job approval flow.
4. Recording list supports search plus status/source/student filters.

---

## 3. Frontend Architecture

### Page Layout

```
┌────────────────────────────────────────────────────────────┐
│ Header (branding, auth status, logout)                     │
├─────────────────────────────────┬──────────────────────────┤
│ Left Column (2/3)               │ Right Column (1/3)       │
│ ├─ Job Submission Panel         │ ├─ Help/Instructions     │
│ │  ├─ Drag/drop zone            │ ├─ Activity feed         │
│ │  ├─ Settings form             │ └─ Notification toggle   │
│ │  └─ Upload queue              │                          │
│ └─ Active Jobs Table            │                          │
│    ├─ Status, times, actions    │                          │
│    └─ Copy link, Regen audio    │                          │
└─────────────────────────────────┴──────────────────────────┘
```

### Components

| Component | Responsibility |
|-----------|---------------|
| `AuthProvider` | Login/register modals, session context |
| `JobUploader` | Multi-file upload, per-file progress |
| `JobSettingsForm` | Preset, TTS, voice, Notion DB dropdowns |
| `JobTable` | Job list with actions |
| `ActivityFeed` | Chronological event log from SSE |
| `NotificationManager` | Browser notifications on completion |

### State Management

- **React Query**: cache API responses (jobs, config, user)
- **React Context**: auth state, SSE connection
- **Local state**: upload queue, activity feed

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
| `GET /auth/me` | Session restoration |

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
| `notionDatabase` | dropdown | Target Notion DB |
| `mode` | dropdown | auto/dialogue/tts (future) |
| `uploadOption` | radio | auto/force s3/skip |

---

## 7. Job Actions

| Action | Status | Behavior |
|--------|--------|----------|
| Copy Notion Link | ✅ Ready | Copies `notionUrl` to clipboard |
| Regenerate Audio | ⏳ Pending | Shows "coming soon" modal |
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

# Configure backend URL
export VITE_BACKEND_URL=http://localhost:8080

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
