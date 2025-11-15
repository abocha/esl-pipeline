# Batch Frontend Implementation Notes

The detailed step-by-step “Phase 1–8” guide has been replaced with this lightweight playbook. Treat [`backend-frontend-alignment.md`](backend-frontend-alignment.md) as the authoritative source for API status, backend prerequisites, and milestone tracking. Use this file only for day-to-day execution hints on the frontend side.

---

## Quickstart Checklist

1. **Environment**  
   - `pnpm install` at repo root.  
   - Set `VITE_BACKEND_URL` (or proxy) so `/uploads`, `/jobs`, `/auth/*`, `/config/job-options`, and `/jobs/events` point at the batch backend with `BATCH_BACKEND_ENABLE_EXTENDED_API=true`.
2. **State libraries**  
   - React Query provider in `src/main.tsx`.  
   - Auth context bootstraps from `/auth/me` and guards job submission routes.
3. **API helpers**  
   - All HTTP/SSE clients import DTO types from the shared `@esl-pipeline/contracts` package once available (see alignment doc Phase 6).  
   - Fallback polling when SSE disconnects.
4. **UI slices**  
   - Uploader + settings panel share a context for defaults (preset, voice, Notion DB, upload choice, mode).  
   - Job table renders the DTO as-is; new fields flow through automatically.  
   - Activity feed + notification manager subscribe to the same store.

---

## Suggested Work Slices

Use these slices when breaking work into issues or PRs. Each slice assumes backend dependencies in the alignment plan are ready.

1. **Auth & shell**  
   - Header with login/register modal, session guard, and logout button.  
   - Friendly empty state when unauthenticated.
2. **Metadata + settings**  
   - Fetch `/config/job-options`, memoize for 60 s, populate presets/voices/DBs.  
   - Include disabled UI hints for upcoming features (e.g., dialogue/monologue modes).
3. **Uploader + queue**  
   - Drag/drop, sequential uploads, POST `/jobs`, per-file retries.  
   - Share selected settings with each queued upload item.
4. **Job monitoring**  
   - Table + filters + actions (copy Notion link, regen audio stub).  
   - Activity feed + notifications sourced from SSE events.  
   - Polling fallback banner.

Document deviations or additional slices back in the alignment plan so both teams stay synchronized.
