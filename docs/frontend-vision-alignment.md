# Frontend Vision Alignment Report

Last reviewed: 2025-03-10

This report compares `docs/design/FRONTEND_VISION.md` to the current batch-frontend implementation.
It highlights what is implemented, partially implemented, missing, or backend-blocked, with a
status matrix and verification guidance.

## Summary

- Strong alignment on dashboard layout, wizard flow, editor, and core job/student workflows.
- Partial alignment on transcript review richness, notes UX, and publish-time controls.
- Missing items are primarily LLM generation and backend-backed job stage/ETA metadata; the student detail view exists but awaits richer data.
- Dark theme and API key settings exist and are working.

## Status matrix (high-level)

| Feature area | Status | Dependency / blocker | Notes |
| --- | --- | --- | --- |
| Dashboard layout + quick actions | Implemented | None | Matches the vision’s command center flow. |
| Wizard steps 1–5 | Implemented | None | End-to-end flow is in place. |
| Transcript review richness | Partial | Transcript metadata granularity | Currently textarea + audio. |
| Lesson notes quick-add + profile snapshot | Partial | Student profile summary API | Current notes + prompt selectors. |
| Draft editor split view + validation | Implemented | None | Matches the vision. |
| LLM draft generation | Missing | LLM service/API | Drafts are user-created. |
| Publish settings (TTS/Notion/Upload) | Partial | Usage/cost data + toggles | Missing cost estimate + heading/audio toggles. |
| Job stage visualization + ETA | Partial | Backend per-stage progress | Guarded UI renders when fields exist. |
| Student profile detail view | Partial | Student detail metadata API | New route with overview + timeline; focus/vocab pending. |
| Notifications log + browser notifications | Implemented | None | Log added in UI. |
| Dark theme support | Implemented | None | Theme toggle + tokens exist. |
| API keys settings | Implemented | Backend storage | Notion + ElevenLabs keys available. |

## Implemented (matches vision intent)

- Dashboard home with quick actions, activity feed, pending approvals, and weekly summary.
  - `packages/batch-frontend/src/ui/dashboard/Dashboard.tsx`
  - `packages/batch-frontend/src/ui/dashboard/QuickActions.tsx`
  - `packages/batch-frontend/src/ui/jobs/ActivityFeed.tsx`
  - `packages/batch-frontend/src/ui/dashboard/PendingApprovals.tsx`
  - `packages/batch-frontend/src/ui/dashboard/WeeklySummary.tsx`
- Wizard flow with five steps and progress indicator.
  - `packages/batch-frontend/src/ui/wizard/AssignmentWizard.tsx`
  - `packages/batch-frontend/src/ui/wizard/StepIndicator.tsx`
- Step 1: student selection + drag-and-drop audio upload + progress.
  - `packages/batch-frontend/src/ui/wizard/Step1SelectStudent.tsx`
  - `packages/batch-frontend/src/ui/shared/DropZone.tsx`
  - `packages/batch-frontend/src/ui/shared/UploadProgress.tsx`
- Step 4: split editor + preview + validation panel.
  - `packages/batch-frontend/src/ui/wizard/Step4ReviewDraft.tsx`
  - `packages/batch-frontend/src/ui/editor/SplitEditor.tsx`
  - `packages/batch-frontend/src/ui/editor/MarkdownEditor.tsx`
  - `packages/batch-frontend/src/ui/editor/ValidationPanel.tsx`
- Job monitoring view with live updates and actions.
  - `packages/batch-frontend/src/ui/jobs/JobTable.tsx`
  - `packages/batch-frontend/src/context/JobMonitorContext.tsx`
  - `packages/batch-frontend/src/ui/jobs/JobConnectionBanner.tsx`
- Student management workspace with search and history/timeline.
  - `packages/batch-frontend/src/ui/students/StudentWorkspace.tsx`
- Settings for job defaults and API keys.
  - `packages/batch-frontend/src/ui/settings/JobSettingsForm.tsx`
  - `packages/batch-frontend/src/ui/profile/ProfilePage.tsx`
- Dark theme and theme toggle.
  - `packages/batch-frontend/src/context/ThemeContext.tsx`
  - `packages/batch-frontend/src/index.css`
  - `packages/batch-frontend/src/ui/App.tsx`
- Notifications panel with browser notifications + recent toast log.
  - `packages/batch-frontend/src/ui/notifications/NotificationsPanel.tsx`
  - `packages/batch-frontend/src/context/NotificationContext.tsx`

## Partially aligned

- Step 2 transcript review:
  - Current UI is audio + plain textarea; vision shows timestamped, speaker-labeled transcript with richer metadata.
  - `packages/batch-frontend/src/ui/wizard/Step2ReviewTranscript.tsx`
- Step 3 lesson notes:
  - Vision calls for quick-add chips and a read-only student profile summary; current UI is notes + prompt selectors.
  - `packages/batch-frontend/src/ui/wizard/Step3AddNotes.tsx`
- Step 4 actions:
  - Vision includes a dedicated "Regenerate" affordance; current flow saves/updates draft and continues.
  - `packages/batch-frontend/src/ui/wizard/Step4ReviewDraft.tsx`
- Step 5 publish controls:
  - Vision includes estimated TTS cost, heading colorization toggle, and audio attach toggle.
  - Current UI covers preset, DB, upload target, TTS toggles/voices/strategy.
  - `packages/batch-frontend/src/ui/wizard/Step5Publish.tsx`
- Student profile detail view:
  - Detail route with overview + timeline is implemented; focus/vocab areas are placeholders pending API fields.
  - `packages/batch-frontend/src/ui/students/StudentProfile.tsx`
- Settings scope:
  - Notion + ElevenLabs keys are present; Deepgram/AWS keys are not exposed in the UI yet.
  - `packages/batch-frontend/src/ui/profile/ProfilePage.tsx`

## Missing vs vision

- LLM generation step ("Generate Homework via LLM") is not implemented.
  - Draft creation is user-driven rather than LLM-driven.
- Student profile detail view lacks focus/vocab log data until the API provides those fields.
- Job monitoring renders stage/queue/ETA only when backend metadata is present; contracts do not include them yet.
- Student notification after publish is not implemented in the UI.

## Design system alignment

- Glassmorphism, gradients, and motion match the vision’s aesthetic direction.
- Light and dark theme tokens are present; dark theme matches the vision palette more closely.
  - `packages/batch-frontend/src/index.css`

## Notes

- The notification log is an enhancement beyond the vision but supports the “don’t miss errors” goal.
- Vision assumes all backend functionality exists; some missing items are blocked by that (LLM generation).

## V2 Readiness Addendum (Reviewer Scan)

These notes are specific to `docs/design/FRONTEND_VISION_V2.md` and its implementation manual.

- Wizard completion panel requires a flow change: current publish callback resets state and navigates home immediately.
- Transcript step already retries and shows a processing message; explicit processing/missing states should key off recording status.
- Notification log is implemented but only surfaced as a panel on Dashboard/Jobs/Settings; v2 needs a global entry point.
- Student profile detail route is implemented with overview + timeline; focus/vocab awaits backend metadata.
- Job stage/ETA/queue are still absent from `JobStatusDto`; UI is guarded and will render when contracts extend.
- LLM draft generation endpoints do not exist in the API client; UI is prompt package + manual draft today.

### Phase A (UI-only) — Completed

- Wizard completion panel with Notion link and quick actions is implemented.
  - `packages/batch-frontend/src/ui/wizard/Step5Publish.tsx`
  - `packages/batch-frontend/src/ui/wizard/AssignmentWizard.tsx`
- Transcript processing indicator is explicit and status-driven (processing vs failed).
  - `packages/batch-frontend/src/ui/wizard/Step2ReviewTranscript.tsx`
- Wizard summary sidebar is visible on desktop and updates with wizard state.
  - `packages/batch-frontend/src/ui/wizard/WizardSummary.tsx`
- Global notification drawer is available across routes via the app shell.
  - `packages/batch-frontend/src/ui/notifications/GlobalNotificationDrawer.tsx`
  - `packages/batch-frontend/src/ui/App.tsx`

## Verification (recommended)

### Manual checks
- Dashboard: verify Quick Actions, Activity Feed, Pending Approvals, Weekly Summary.
- Wizard: complete steps 1–5 with a real recording and publish a job.
- Draft editor: confirm split view + validation warnings + jump-to-line.
- Job monitoring: confirm live updates and actions (copy link, approve).
- Students: search, edit profile, and view timelines.
- Settings: validate defaults updates + API key save.
- Theme: toggle light/dark and verify contrast.

### Automated checks
- `pnpm --filter @esl-pipeline/batch-frontend test`
- `pnpm --filter @esl-pipeline/batch-frontend lint`
- `pnpm --filter @esl-pipeline/batch-frontend typecheck`
