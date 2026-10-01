# @esl-pipeline/batch-frontend

## Meta

- Audience: maintainers and implementing agents.
- Authority Level: package entrypoint and operational usage guide.
- Last Verified Against: 2026-09-14 provider-account failure handling.
- Owner: batch-frontend maintainers + automation agents.
- Review Cadence: monthly or after major UI/workflow changes.
- Status: `active`.

React + Vite UI for `@esl-pipeline/batch-backend`.

## Role

This package is the operator-facing frontend for:

- authenticated assignment flow
- recording/transcript/prompt/draft/publish workflow
- student-area directory, overview, learning, history, and schedule/billing views
- student Learning page memory health support details for founder/operator diagnosis
- student Learning page profile-draft change review after approved candidate refresh
- student and business schedule follow-up actions that mark elapsed lessons completed and open lesson-linked homework assignment context
- capability-gated job actions

Canonical behavior and current status live in:

- [`docs/backend-frontend/backend-frontend-alignment.md`](../../docs/backend-frontend/backend-frontend-alignment.md)
- [`docs/PIPELINE_INTEGRATION_VISION.md`](../../docs/PIPELINE_INTEGRATION_VISION.md)

## Runtime Notes

- API traffic goes through `src/utils/api.ts` and `@esl-pipeline/contracts`.
- Base URL resolution uses runtime override first, then Vite env, then `/api`.
- The app assumes the extended backend API is enabled.
- Cache-hit uploads can reuse transcription artifacts without moving another student's recording;
  the returned recording/transcript IDs remain owned by the selected student.
- Lesson source entry supports either a supported recording upload or a tutor-pasted existing transcript. Pasted
  transcripts are persisted through `POST /recordings/transcript-source`, retain explicit
  `manual_transcript`/`manual` provenance, and never enqueue speech-to-text work. Ordinary uploads
  accept the backend's probed direct-audio policy (MP3, PCM16 WAV, AAC/M4A, Ogg/Opus, and
  WebM/Opus). MP4/AAC, MOV/AAC, and WebM/Opus video are convenience inputs only: the backend
  stream-copies and retains their single audio stream without transcoding.
- The browser rejects files larger than 2 GiB before making a request; backend byte, temp-capacity,
  media-integrity, and 100-minute checks remain authoritative. Recording state is projected
  consistently through upload reconciliation, polling, SSE, and resume as Checking, Waiting,
  Transcribing, Trying again, Ready, or a terminal needs-attention state. Normal tutors cannot retry
  successful STT; terminal recovery is a new or replacement recording upload. A provider-account
  terminal state instead tells the tutor to contact the service operator because replacing the recording
  will not help.
- A same-workspace transcript-cache hit owns independent recording/transcript lineage, creates no
  transcription run, retains no audio, and renders Ready with `audioLifecycle=not_retained` and no
  audio control.
- An uploaded recording can be replaced in place while its assignment remains unfinished. The
  replacement retains the assignment session and scheduled lesson link; confirming the new Source
  supersedes the old lesson-memory lineage before later assignment generation can continue. On
  resume, replacement remains available for an eligible unfinished session; opening it counts as a
  user edit, while passive rehydration does not persist assignment-session changes.
- The authenticated Calm Studio shell uses a persistent workspace rail and a focused five-step
  assignment flow: Student, Lesson source, Teaching context, Create, and Review & share. Back and
  completed-step navigation are user-owned and keep the current assignment state instead of
  redirecting as readiness updates. Step 2 keeps the prepared source visible and asks which of two
  anonymous speakers is the tutor; unusual speaker counts retain explicit role pickers. Step 3
  starts with lesson guidance and a compact learner dossier. Step 4 centers generation when empty.
  Step 5 requires a current preview before Share, keeps queued/running publication distinct from a
  succeeded handout with a URL, and offers Start another assignment only after that handout exists.
  Advanced rerun and republish actions appear only for a succeeded handout with a URL; technical
  settings are nested there, while provenance and diagnostics live under Support details.
- Step 1 shows four recent assignment lineages initially. Reruns are collapsed only when an existing
  `sourceJobId` relationship proves the lineage, while every exact version remains selectable.
  Older lineages are revealed progressively through the existing job and assignment-session APIs;
  this is a short recovery/reference surface, not a searchable assignment archive.
- This visual overhaul currently covers the authenticated shell and assignment workflow. Student,
  Business routes remain operational on their existing content designs.
- Local UI iteration can use the Vite mock-auth sandbox without a backend:
  - PowerShell:
    ` $env:VITE_BATCH_FRONTEND_SANDBOX='mock-auth'; pnpm --filter @esl-pipeline/batch-frontend dev -- --host 127.0.0.1 --port 5173`
  - POSIX:
    `VITE_BATCH_FRONTEND_SANDBOX=mock-auth pnpm --filter @esl-pipeline/batch-frontend dev -- --host 127.0.0.1 --port 5173`
  - The sandbox is dev-only, marks the UI with `Mock data`, bypasses frontend auth only, and uses
    seeded mock API responses for the assignment builder.
  - Sandbox scenarios are allow-listed through `sandboxScenario`; unknown values use the default:
    - `http://localhost:5173/?sandboxScenario=default`
    - `http://localhost:5173/?sandboxScenario=step-one-no-recent`
    - `http://localhost:5173/?sandboxScenario=step-one-resume-states`
    - `http://localhost:5173/?sandboxScenario=step-one-resume-error`
    - `http://localhost:5173/?sandboxScenario=step-one-no-learners`
    - `http://localhost:5173/?sandboxScenario=step-one-learner-error`
    - `http://localhost:5173/?sandboxScenario=step-one-slow`
  - Add `jobId` or `sessionId` to any sandbox URL to inspect initial assignment hydration. For
    example, open `http://localhost:5173/?sandboxScenario=default&jobId=job-sandbox` to resume
    the seeded completed assignment with all primary stages unlocked for copy/layout review.
- Student-area pages prefer route-level payloads under `/students/:id/surfaces/*`, with granular student APIs retained as compatibility/fallback paths.
- The Learning page can read `/students/:id/memory/health` for collapsed operator support details;
  manual full snapshot rebuild remains outside the frontend and CLI-only for v1.1.
- Ordinary Learning page profile edits save directly as active revisions. Draft review controls
  remain available for candidate-derived drafts.
- Approved-candidate draft refresh opens a review-mediated profile draft and shows a standalone
  deterministic diff table against the active editor baseline. The table uses shared
  current/proposed headers, field-level change pills, and line-level addition/removal highlights;
  model-generated change classification remains intentionally deferred.
- Lesson follow-up reminders use in-app actions first; Telegram/email delivery remains outside the frontend surface for this slice.
- Job-event SSE subscriptions should target known `jobId` and `recordingId` values; wildcard all-job streams are explicit.

## Assignment Recovery and Confirmation

- Each primary CTA confirms one semantic boundary. Artifact readiness and navigation never mark a
  step complete. Back is non-destructive; forward navigation cannot bypass an earlier dirty
  boundary.
- Transcript, notes/profile context, draft text, and publishing settings recover automatically.
  Confirmation flushes the latest safe pending write before advancing. Routine Save, Refresh, and
  Reload controls are absent; bounded transient retries run automatically and contextual Retry is
  reserved for exhausted or ambiguous outcomes.
- Resume loads the newest durable working values, opens the earliest dirty Source, Context, or
  Create boundary, then falls back to the destination derived from `confirmedStep`. Completed
  post-cutover jobs use their retained assignment-session link to reopen every confirmed step for
  reference without permitting session mutations. Pre-cutover jobs have no retained session link
  and remain limited to their historical output and post-share actions.
- Opening an assignment session always re-fetches backend authority rather than hydrating from the
  resume-list copy. A ready upload or pasted transcript is not installed through generic recovery:
  the frontend calls the explicit source-attachment command. If attachment reports existing source
  ownership, including a completed assignment, the UI discards the losing session transition,
  reopens backend authority, and explains `This lesson already has an assignment. We reopened it.`
  If the backend materializes fresh released-source lineage, the UI rehydrates that returned session
  rather than continuing with stale candidate IDs.
- Source Continue waits for the canonical attachment result, persists a linked lesson through
  ordinary session recovery separately, and confirms the attached recording/transcript through the
  Source confirmation endpoint. Generic recovery never reattaches source IDs.
- Prompt and draft recovery is lineage-safe: a generated draft is created against the exact prompt
  returned by that generation operation, prompt/draft IDs recover as a compatible pair, and Create
  navigation plus draft editing stays locked while prompt or draft generation is in flight.
- Teaching context reads assignment-scoped learner authority from the backend on entry, resume,
  return from Student Learning, and focus. Initial profile enrichment runs automatically after
  confirmed Source; the tutor can edit guidance while it prepares and confirm Context against the
  visible profile revision. The assignment has no profile draft or approval controls.
- Cross-tab session and artifact conflicts retain the tutor's local buffer, adopt the newest server
  revision only as a compare-and-swap base, and suppress automatic overwrite until the tutor
  explicitly reconciles the visible value.
- Browser unload, router links, Back/Forward, and Logout are guarded only while local work is not
  durably recovered or a mutation outcome is ambiguous. Durable-but-unconfirmed recovery does not
  produce a data-loss warning. Pending debounced recovery is flushed and fully drained before SPA
  navigation proceeds, including edits made while an earlier recovery request is in flight.
- Stable assignment/session, learner, and profile data refresh on entry, focus return, or directly
  related mutation completion. Recording, job, and pending initial profile enrichment states poll
  only while asynchronous work remains and stop at terminal state.
- Share uses one stable request/job ID across automatic retry, remount, focus reconciliation, and
  lost responses. Share is enabled only when confirmed recovery and current artifacts are clean,
  and it drains pending session recovery before reservation; if authoritative recovery is dirty,
  the tutor is returned to the earliest affected step with a concrete reconfirmation action. Once
  Share is confirmed, the session is immutable workflow history; changing the lesson starts a new
  assignment and never revokes the existing handout. Reopening a completed
  session is reference-only. An ordinary queued/running root remains in **Publishing assignment…**;
  a failed root offers **Retry publication** with the retained Share request ID.
  **Correct published assignment** appears only for a succeeded HTML publication
  with a non-empty URL.
  Correction mode edits the current mutable draft without reopening session confirmation, drains
  durable autosave before publishing, and submits the exact saved version/hash through a stable
  correction request. **Republish published version** remains the historical frozen-output action;
  it does not publish mutable draft changes.

Use these for deeper detail:

- [`packages/batch-backend/README.md`](../batch-backend/README.md)
- [`docs/design/CANONICAL_ASSIGNMENT_STATE.md`](../../docs/design/CANONICAL_ASSIGNMENT_STATE.md)
- [`docs/reference/env.md`](../../docs/reference/env.md)

## Admin prompt control plane

Admins use Administration > Prompts at `/admin/prompts`; `/prompts` redirects there for admins.
Users and viewers see only Workspace navigation and are redirected away from either prompt route.
Backend admin authorization protects all template management APIs independently of frontend gating.

The page shows the active DB revision beside the deployed template asset, matched by exact content
hash rather than the newest DB revision. It highlights updates awaiting explicit activation and
unimported shipped content. DB-only and archived templates remain inspectable without inventing a
shipped version. An ordered line diff and revision inspection precede activation; revision history,
restore/rollback, archive, and default selection remain available. The editor is collapsed and
explains that saving a manual operator edit activates it immediately. Reads never import or activate.

## Validation

```bash
pnpm --filter @esl-pipeline/batch-frontend build
pnpm --filter @esl-pipeline/batch-frontend test
```
