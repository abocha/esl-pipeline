# @esl-pipeline/batch-frontend

Learning and transcript-processing details consume the shared aggregate availability contract.
Stored-ready history can require explicit repair; repository failure remains unknown rather than
empty. Repair-required copy never suggests that recent observations restore established history.
Optional response fields permit older API responses during coordinated rollout; repair execution
remains operator-owned. See [the memory runbook](../../docs/operations/student-memory-replay-backfill.md#evidence-availability-and-continuity-esl-38).

## Meta

- Audience: maintainers and implementing agents.
- Authority Level: package entrypoint and operational usage guide.
- Last Verified Against: 2026-10-07 no-homework transcript UI and student-history placement (ESL-35).
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
- student and business schedule follow-up actions that open lesson-linked assignment context;
  backend session linking completes eligible elapsed lessons and consumes credit
- capability-gated job actions

Canonical behavior and current status live in:

- [`docs/backend-frontend/backend-frontend-alignment.md`](../../docs/backend-frontend/backend-frontend-alignment.md)
- [`docs/PIPELINE_INTEGRATION_VISION.md`](../../docs/PIPELINE_INTEGRATION_VISION.md)

## Runtime Notes

- Browser startup configures Zod in `jitless` mode before application schemas load, avoiding
  eval probes under CSP. HTML keeps the resource policy; Vite and frontend nginx supply
  `frame-ancestors 'none'` and `X-Frame-Options: DENY` as response headers. nginx also sends
  `X-Content-Type-Options: nosniff` on the SPA entry response, including fallback routes.
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
  starts with material choice, optional lesson guidance and a compact learner reference. Step 4 centers generation when empty.
  Step 5 requires a current preview before Share, keeps queued/running publication distinct from a
  succeeded handout with a URL, and offers Start another assignment only after that handout exists.
  Advanced rerun and republish actions appear only for a succeeded handout with a URL; technical
  settings are nested there, while provenance and diagnostics live under Support details.
- Step 1 shows four recent assignment lineages initially. Reruns are collapsed only when an existing
  `sourceJobId` relationship proves the lineage, while every exact version remains selectable.
  Older lineages are revealed progressively through the existing job and assignment-session APIs;
  this is a short recovery/reference surface, not a searchable assignment archive.
- The Business area uses flat day-grouped lesson rows and bounded unfinished follow-up, with
  booking/credit suggestions and recent payments behind disclosures. Stats focuses on recorded
  payments and taught lessons/hours; default-rate monetary estimates are not displayed. Student
  routes retain their existing content designs.
- Monthly recorded payments include archived students' non-voided history in the selected
  currency, with other currencies reported separately. Lesson/workload facts and the recent-payment
  list remain scoped to non-archived students. Business top-up drafts offer a discussion based on
  credit balance; they do not assert debt or renewal.
- Student pages show scheduling/payment facts and review actions without profile-coverage,
  reminder-total, recent-memory-total, or open-thread metric cards. Candidate review counts sit
  beside the relevant controls; snapshot source counts and technical memory diagnostics remain
  under Memory support details. Candidate confidence labels are not displayed to tutors.
- History uses one student-authorized activity feed with server-side category/date filters and
  older-page loading. Recorded transitions, retained outcomes and incomplete earlier records are
  distinguished; practical facts and owner links lead, with technical evidence under Details.
  Workspace timezone controls activity date display; calendar-only payment dates stay unchanged. The URL
  preserves category/date filters, while failed refreshes retain the last loaded page. A learner
  switch cannot retain another learner's data. Recording coverage is not inferred from schema
  installation, and historical transcript finishes do not imply current no-homework completion.
- Student availability distinguishes absent memory, repair-required history and repository failure.
  Failed initial Learning loads show an unavailable state with Retry; they do not present an empty
  editable profile or zero-candidate summary. History retains successful sources and previous
  entries on retry failure, names unavailable sources, and separates genuine empty results from
  incomplete history and filters with no matches. These states never initiate memory repair.
- Local UI iteration can use the Vite mock-auth sandbox without a backend:
  - PowerShell:
    ` $env:VITE_BATCH_FRONTEND_SANDBOX='mock-auth'; pnpm --filter @esl-pipeline/batch-frontend dev -- --host 127.0.0.1 --port 5173`
  - POSIX:
    `VITE_BATCH_FRONTEND_SANDBOX=mock-auth pnpm --filter @esl-pipeline/batch-frontend dev -- --host 127.0.0.1 --port 5173`
  - The sandbox is dev-only, marks the UI with `Mock data`, bypasses frontend auth only, and uses
    seeded mock API responses for the assignment builder, Business routes and Student History.
  - Add student accepts a fresh structured starter profile in memory. In the same tab, start a new
    assignment for that student, paste an existing transcript, and confirm the source to review
    Teaching context. Lesson guidance and context confirmation remain in memory; reloading resets
    these students and sessions. This walkthrough does not exercise backend persistence or generation.
  - `http://localhost:5173/?sandboxScenario=assignment-editor&sessionId=session-editor` opens a
    focused current-format editor with fictional material and the real authoring hooks. Saves stay
    in that sandbox instance's memory; reload resets the fixture. This is editor walkthrough
    evidence, not backend persistence, provider or publication evidence.
  - After changing shared-package export paths during local development, rebuild the owning package
    and restart Vite so its resolver picks up the updated exports.
  - Open `http://localhost:5173/students/student-alex/history` for fictional recorded transitions,
    transcript/homework outcomes, reversals and older-page loading. These are preview examples,
    not evidence of production action recording or authorization.
  - Open `http://localhost:5173/business/schedule` for a fictional, in-memory Business preview;
    status changes and reminder hide/undo affect only that sandbox instance.
  - Sandbox scenarios are allow-listed through `sandboxScenario`; unknown values use the default:
    - `http://localhost:5173/?sandboxScenario=default`
    - `http://localhost:5173/?sandboxScenario=step-one-no-recent`
    - `http://localhost:5173/?sandboxScenario=step-one-resume-states`
    - `http://localhost:5173/?sandboxScenario=step-one-resume-error`
    - `http://localhost:5173/?sandboxScenario=step-one-no-learners`
    - `http://localhost:5173/?sandboxScenario=step-one-learner-error`
    - `http://localhost:5173/?sandboxScenario=step-one-slow`
    - `http://localhost:5173/students/student-alex/overview?sandboxScenario=student-availability`
      shows repair-required memory in Overview and unavailable Learning/History requests.
  - Add `jobId` or `sessionId` to any sandbox URL to inspect initial assignment hydration. For
    example, open `http://localhost:5173/?sandboxScenario=default&jobId=job-sandbox` to resume
    the seeded completed assignment with all primary stages unlocked for copy/layout review.
- Student-area pages prefer route-level payloads under `/students/:id/surfaces/*`, with granular student APIs retained as compatibility/fallback paths.
- Students uses a persistent alphabetical roster next to Overview, Learning, History, and
  Schedule & Billing. Learner switches retain the section and roster search; the student page
  remounts before loading the next learner. URLs and browser history remain navigable.
- The main navigation rail can collapse independently of student focus view, with Logout
  available in the compact rail. On phones, list/detail navigation coexists with the workspace
  menu. Student creation retains optional starter notes inside a centered modal.
- Directory name search and 200-record paging use existing server contracts. Status, query and
  page changes scope rows/actions to their own results; stale responses cannot replace them.
  Archive/restore failures remain actionable, and selected-student archive requires confirmation.
- Learning registers its actual editor state and save operation with the shared navigation guard.
  Student/section changes, workspace navigation, creation/archive and logout protect unsaved
  edits. Cancel and failed saves retain the editor; draft saves remain drafts. Candidate-review
  text requires explicit discard or completion in Learning. In-flight writes must finish before
  leaving. This does not redesign student-page content or change backend ownership.
- Scheduling requires a connected selected Google Calendar; teaching, history, homework and billing
  remain available without it. Set schedule creates one-offs or several independent weekly series
  in the displayed timezone, with optional Google invitations and per-series outcomes. Later timing
  edits open Google. The shared Calendar panel owns its styles on both Business and Student routes;
  connection management is expandable, and submitted setups show their captured choices for recovery.
  Existing lesson rows stay visible during connection/sync failures. See the
  [Calendar cutover runbook](../../docs/operations/google-calendar-cutover.md) for remaining provider
  identity and operator activation gates.
- The Learning page can read `/students/:id/memory/health` for collapsed operator support details;
  manual full snapshot rebuild remains outside the frontend and CLI-only for v1.1.
- Student IDs are the sole runtime profile root. Profile content and revision actions use
  `/students/:id/profile` and `/students/:id/profile/revisions`; the UI has no global profile
  catalog, manual profile selection, or student-profile binding controls. Historical prompt
  snapshot profile identifiers remain obsolete provenance metadata.
- Ordinary Learning page profile edits save directly as active revisions. Draft review controls
  remain available for candidate-derived drafts.
- Approved-candidate draft refresh opens a review-mediated profile draft with selected approved
  wording preserved in its mapped fields. Generation shows selected/applied/omitted counts and
  omission reasons; activation shows actual linked/promoted/omitted counts and reasons. Facts
  removed or changed during review remain unpromoted. Only IDs reported applied by the backend
  are represented; draft links alone do not establish promotion. Older activation responses without
  promotion metadata are explicitly reported as unverified.
  Candidate details distinguish completed lesson occurrence time from extraction fallback when
  the lesson date is unknown. Existing historical candidate dates are not relabeled.
  The draft review also shows a standalone
  deterministic diff table against the active editor baseline. The table uses shared
  current/proposed headers, field-level change pills, and line-level addition/removal highlights;
  model-generated change classification remains intentionally deferred.
- Lesson follow-up reminders use in-app actions first; Telegram/email delivery remains outside the frontend surface for this slice.
- Job-event SSE subscriptions should target known `jobId` and `recordingId` values; wildcard all-job streams are explicit.

## Assignment material (Step 3)

Fresh assignments select Generated. Authentic requires a public HTTP(S) source link and editable
source text; articles use pasted excerpts. YouTube retrieval runs only after Fetch transcript,
through the authenticated backend. Missing configuration or provider failures retain the manual
editor and Get transcript manually link. Source text is separate from the lesson transcript.
The 60,000-character source limit rejects oversized content explicitly; it never truncates it.

Switching modes preserves Authentic draft fields in assignment recovery, while confirmed Generated
inputs omit them from generation. A changed source identity retains the text but requires explicit
reuse or replacement; equivalent YouTube URL variants retain their association. Fetching cannot
overwrite existing text without consent or attach results after newer edits, another session,
material changes or leaving/confirming the step. Save and fetch status remain independent.
Continue to Create saves and confirms without generating. Step 4 uses backend-confirmed material.

In the frontend sandbox, use a fresh fictional student and pasted lesson source. Authentic retrieval
is mocked in memory: `https://www.youtube.com/watch?v=ESL84demo01` succeeds and
`https://www.youtube.com/watch?v=ESL84fail01` demonstrates the manual fallback. These illustrative
IDs are test inputs, not real videos. Reload resets sandbox students/sessions; this demonstrates UI
behavior only, not backend persistence or live provider success.

## Assignment Recovery and Confirmation

- Each primary CTA confirms one semantic boundary. Artifact readiness and navigation never mark a
  step complete. Back is non-destructive; forward navigation cannot bypass an earlier dirty
  boundary.
- Transcript, notes/profile context, draft text, and publishing settings recover automatically.
  Confirmation flushes the latest safe pending write before advancing. Routine Save, Refresh, and
  Reload controls are absent; bounded transient retries run automatically and contextual Retry is
  reserved for exhausted or ambiguous outcomes.
- ESL-83 replaces normal JSON editing with a current-format workbook in step 4.
  `AssignmentEditor` edits the same AssignmentV1 object through the authoring controller.
  A desktop section rail keeps each part focused. Prompts, answers and explanations edit together
  on the page; source, speaker and metadata settings open on demand. Assignment teaching notes are separate from
  step-3 generation guidance and absent from Learner view, including hidden DOM.
  The editor covers current grammar/mission/rationale shapes and all six pronunciation modes;
  it does not provide older-format forms, conversions, new speaker sets, new groups or mode pickers.
  It supports contextual drag/menu list operations, selection-based Highlight and session-local
  Undo/Redo. Highlight serializes to existing paired backticks; contenteditable DOM is only a text
  projection, never a stored HTML format. No-op moves do not create history or notifications.
  Autosave acknowledgements retain history; a new assignment, hydration or regeneration starts a
  new edit session. Regeneration explicitly asks before replacing the workbook.
- Incomplete fields stay visible with errors and remain browser-local. Only valid objects may
  autosave, preview, confirm, correct or share. Reload restores the latest valid saved assignment;
  there is no crash-recovery promise. Save status describes the current acknowledged canonical
  object. Autosave, explicit save and reconciliation share one in-flight write, preserve newer
  typing/Undo and retain working-version CAS. A conflict stays latched through further typing;
  inspect the saved version and explicitly choose local or saved content against a fresh version
  check. Failed saves preserve edits and offer Retry. Source identity, supplied URLs and lineage
  remain constrained by the pinned validation context.
- Step-4 Learner view uses `learner-handout` for current valid content. It does not confirm Create
  or satisfy step 5's authoritative preview/share gates. Completed current assignments remain
  read-only until the existing correction entry. Text edits do not imply regenerated audio.
  Preview still submits the validated canonical object with its pinned prompt ID; canonical key
  formatting remains irrelevant to identity. Historical formats retain read-only access.
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
- Lesson source offers a saved, default-unchecked native **No homework for this lesson** checkbox.
  Checked sessions use **Review transcript**, await source text/role/recovery saves and enter
  **Review & finish** with Teaching context/Create skipped. Review and choice save never confirm
  Source or claim completion. **Confirm transcript and finish** submits the exact reviewed
  server version/hash. The result is a read-only transcript with actual lesson/credit status and
  collapsed **Processing details** for lesson notes, student summary, and profile suggestions,
  without handout/Share controls. Pending, failed, unavailable, and inapplicable processing remain
  distinct and never block transcript completion or **Create homework**.
  **Create homework** explicitly promotes the same owner to Context; reselecting none before
  downstream work remains unfinished until another finish. Context/prompt/draft/Share work disables
  opt-out with an explanation. Refresh/resume restores saved intent and completed results. Completed results
  are discoverable through **Lesson transcripts** on the student's **History** page and
  **View transcript** on linked lesson rows. Unlinked transcripts remain accessible through History.
  The student-scoped list filters existing tutor history pages locally and advances by server
  result counts, including mixed homework/transcript pages. Empty partial pages offer older results;
  student changes reset the list and ignore stale responses. Completed transcripts remain separate
  from Step 1's unfinished/resume chooser. Server-side student filtering is deferred unless mixed
  history volume makes browsing materially inefficient.
  Schedule/business **View transcript** uses the nullable result-session reference; only current
  completed no-homework suppresses its lesson follow-up. Linking an elapsed scheduled lesson can
  already complete/charge it before transcript review; finish does not introduce a billing action.
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

On entry, the page selects the effective default returned by the API (including the configured
fallback), then the first visible template if that default is unavailable. Catalog refreshes after
operator actions prefer the explicitly selected template. The retired DB-only, inactive
`hw prompt markdown block.md` entry is hidden only on this page; its stored revisions and API access
are preserved. It remains visible if active, shipped, or selected as the effective default. Other
historical templates remain available.

The page shows the active DB revision beside the deployed template asset, matched by exact content
hash rather than the newest DB revision. It highlights updates awaiting explicit activation and
unimported shipped content. DB-only and archived templates remain inspectable without inventing a
shipped version. An ordered line diff and revision inspection precede activation; revision history,
restore/rollback, archive, and default selection remain available. The editor is collapsed and
explains that saving a manual operator edit activates it immediately. Reads never import or activate.
Unimported shipped content offers **Import & activate** in one click. The backend reads the deployed
asset and performs the import and normal activation. Success refreshes active/shipped state and
history. Failure also refreshes persisted state and shows an actionable error; an imported draft
remains available for explicit activation if only the import completed.

## Validation

Public legal disclosures live on the unauthenticated landing host at
`https://eslpipeline.com/privacy/` and `https://eslpipeline.com/terms/`. The sign-in screen,
authentication dialog, workspace rail and Calendar connection screen link to them. Legal links
open a separate tab so assignment recovery/navigation state remains intact. The legal pages are approved for the alpha with an effective date of 20 October 2026; see [OAuth/legal readiness](../../docs/operations/google-oauth-legal-readiness.md).

```bash
pnpm --filter @esl-pipeline/batch-frontend build
pnpm --filter @esl-pipeline/batch-frontend test
```

## Historical assignment access (ESL-7)

AssignmentV1 is the only editable/executable assignment format. Historical Markdown jobs, drafts,
and prompt-backed sessions open as read-only evidence with original text and produced output links.
Correction, regeneration, preview rendering, retry/recovery, rerun and autosave are unavailable for
these records. The backend rejects legacy processing even when an old client requests it; no
conversion is attempted. See [AssignmentV1 retirement](../../docs/reference/ASSIGNMENT_V1.md).
