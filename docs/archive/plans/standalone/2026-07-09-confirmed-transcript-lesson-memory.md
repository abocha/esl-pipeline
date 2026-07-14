# Confirmed Transcript Lesson Memory Plan

## Meta

- Audience: founder-maintainer, implementation agents, and future reviewers of the first-lesson
  alpha flow.
- Status: archived.
- Last Verified Against: 2026-07-14 repo state.
- Exit Trigger: archive after the confirmed-transcript lesson-memory PR merges, or supersede if the
  first-lesson flow changes before implementation.
- Archive Reason: shipped in the confirmed-transcript lesson-memory implementation and retained as
  historical design and acceptance trace.

## Problem

The first-profile assignment flow currently shows a loading state that says lesson memory is being
built after the transcript is ready, but production logs showed no lesson-memory job being queued.
The UI was wired to wait on `GET /students/:id/memory/health`, while the backend only requested
lesson-memory generation after prompt package creation or as a draft-generation fallback.

That mismatch happened because the product flow changed. Originally, the tutor had a prompt-package
step between transcript readiness and assignment generation. By the time they created the prompt
package, they had usually seen enough of the transcript to notice if the selected student or audio
file was wrong. Later, the prompt package became an on-the-fly implementation detail behind the
`Generate assignment` action. That made the flow smoother, but removed the human checkpoint that
used to protect learner memory from bad evidence.

The result is bad in two different ways:

1. If lesson memory is not queued, the tutor sees an endless loading animation and cannot understand
   whether the system is working.
2. If lesson memory is queued automatically on transcript readiness, the system can permanently add
   wrong-student or wrong-audio evidence before the tutor has accepted it.

The second problem is more serious. Student memory is intended to be trusted long-lived context, and
there is currently no tutor-facing memory management UI for deleting or correcting a bad lesson
memory entry after it has influenced the learner profile and future assignment context.

## Decision

Use a tutor confirmation gate as the primary lesson-memory trigger.

After a transcript becomes ready, the `Add teaching context` step should show a small confirmation
surface inside the existing flow. It should not redesign the whole transcript UI. It should reuse
the current transcript area and add a clear decision point:

```text
Transcript ready

Use this transcript for Cora's learner context

Change student
Replace audio

Nothing is added to learner memory until you confirm.
```

Do not include a separate `Lesson memory not started` label. The note already explains the state,
and the extra label reads like internal system status rather than tutor guidance.

When the tutor clicks `Use this transcript for Cora's learner context`, the backend should enqueue
lesson-memory generation with a trigger such as `teacher-confirmed-transcript`. Only after this
confirmation should the UI show the spinner/copy:

```text
Building lesson memory (1-2 minutes)
```

The existing prompt-package and draft-generation lesson-memory hooks should remain as idempotent
fallbacks. They should not be the normal path for this flow, and they must not cause duplicate model
work for the same current transcript version.

## Why Confirmation Is Important

Transcript readiness is a technical state, not a trust boundary. It only proves that STT returned
text. It does not prove that:

- the uploaded audio belongs to the selected student,
- the selected student was not accidentally left over from a previous workflow,
- the transcript text is good enough to use as learner evidence,
- the tutor has noticed a wrong file, wrong language mix, or bad speaker labeling,
- the tutor wants this lesson to shape future learner context.

The confirmation click creates the missing trust boundary: the tutor has seen the transcript and
has accepted it as evidence for this learner.

This is especially important for closed alpha because tutors are being introduced to the workflow
for the first time. The UI should not ask them to understand internal concepts like prompt packages,
queue jobs, or memory snapshots. It should ask a human question in plain language:

```text
Should this transcript become learner context for this student?
```

## Roadblocks

### Roadblock 1: no memory management UI

If bad evidence gets into lesson memory, there is no simple tutor workflow to remove it. Building a
full memory management interface now would be too broad for the alpha path and would distract from
the immediate reliability issue.

The workaround is prevention:

- do not enqueue lesson memory until the tutor confirms the transcript-student pairing,
- keep provenance on every generated lesson memory entry,
- make the confirmation button consequence-specific rather than generic.

### Roadblock 2: duplicate triggers can waste model calls

The system already has lesson-memory request hooks after prompt package creation and draft
generation fallback. Adding a new confirmation trigger could waste work if every trigger caused a
new extraction call.

The workaround is idempotency:

- one current transcript version should produce at most one active pending or ready lesson-memory
  job,
- later fallback triggers should perform a cheap request/dedupe check and no-op when current
  pending or ready memory already exists,
- transcript edits create a new source version and are allowed to request fresh lesson memory.

The existing `ensurePendingLessonMemoryEntry` path already has the right shape because it compares
lesson-memory freshness against `transcripts.updated_at` and returns `ready_exists` or
`pending_exists` when current work is already available.

### Roadblock 3: prompt package is now hidden behind assignment generation

The old prompt-package trigger fired too late for the new first-profile flow because the tutor needs
learner context before generating the first assignment.

The workaround is to expose the correct product action directly in `Add teaching context`: confirm
the transcript as learner evidence, then build lesson memory, then populate the first profile draft.

### Roadblock 4: generated lesson titles are currently missing

The lesson source area currently falls back to `Untitled lesson`, which creates busywork and makes
the history harder to scan. Tutors should not have to manually rename routine lessons.

The workaround is to let lesson-memory extraction produce a short lesson title while it is already
reading the transcript semantically.

## Lesson Title Decision

Lesson memory should generate a short human-readable lesson title, for example:

- `Small Talk and Client Updates`
- `Past Tense Story Practice`
- `Meeting Phrases and Confidence`
- `First Lesson and Speaking Baseline`

This title should update the lesson/source label only when the existing title is still an automatic
placeholder such as `Untitled lesson`. If the tutor already renamed the lesson manually, generated
memory must not overwrite it.

The title is metadata, not long-lived learner evidence. A mediocre generated title is easy to edit
later and is much less risky than a wrong memory fact. Still, title generation should be conservative:

- 3-7 words,
- no invented student names,
- no sensitive personal details,
- no over-specific claim if the transcript is thin,
- fallback to the current placeholder if no useful title can be derived.

## Proposed UX

The UI change should be local to the existing assignment flow.

### Before confirmation

Show the confirmation gate in the `Add teaching context` learner-context area when all of these are
true:

- a student is selected,
- a transcript is ready,
- there is no selected learner profile yet,
- no current lesson memory is ready for this transcript/student pairing,
- no first-profile draft has already been generated.

The gate should include:

- a `Transcript ready` status row with a check icon,
- primary action: `Use this transcript for {studentName}'s learner context`,
- secondary action: `Change student`,
- secondary action: `Replace audio`,
- warning/help note: `Nothing is added to learner memory until you confirm.`

The primary button should be specific because `Confirm` is too vague. The label should name both the
artifact and the learner.

### After confirmation

After the backend accepts the confirmation and enqueues or finds pending work:

- show `Building lesson memory (1-2 minutes)`,
- keep the existing animated spinner/dots treatment,
- keep the `Check now` action,
- continue polling `memory/health`,
- show the first-profile populate action only when ready lesson memory exists.

### If the tutor notices a mismatch

`Change student` should take the tutor back to the student selection point without creating learner
memory.

`Replace audio` should take the tutor back to the upload/source action without creating learner
memory.

If the tutor changes student after confirmation but before memory finishes, the UI should reset the
first-profile assist state for the newly selected student and should not imply that the previous
student's pending work applies to the new student.

## Backend Shape

Add an explicit backend action for confirmed transcript evidence. Two acceptable route shapes:

```text
POST /students/:studentId/lesson-memory/requests
```

or:

```text
POST /recordings/:recordingId/lesson-memory
```

The student-scoped route is clearer because the product action is "use this transcript for this
student's learner context." The request body should include `recordingId` and `transcriptId`.

The backend must verify:

- the user is authenticated,
- the student exists and is accessible to the user,
- the recording exists,
- the transcript exists,
- the transcript belongs to the recording,
- the request student is the selected/bound student for this confirmation,
- a current pending or ready lesson-memory entry does not already exist for this transcript version.

After validation, call `requestLessonMemoryGeneration` with:

```text
trigger = teacher-confirmed-transcript
studentId = confirmed student
recordingId = confirmed recording
transcriptId = confirmed transcript
promptPackageId = null
```

The response should make the UI state explicit:

```text
created | pending_exists | ready_exists
```

If it returns `created` or `pending_exists`, the UI can show `Building lesson memory`.

If it returns `ready_exists`, the UI can immediately refresh health and expose the populate-profile
action.

## Edge Cases

### Wrong student selected before upload

The tutor uploads audio while the wrong student is selected. The transcript becomes ready, but no
lesson memory is created until confirmation. The tutor can choose `Change student` before any memory
is written.

### Wrong audio uploaded for the selected student

The tutor sees the transcript and realizes the file is not the intended lesson. The tutor can choose
`Replace audio`. No learner memory has been created.

### Tutor confirms the wrong pairing anyway

The system cannot fully prevent a human from confirming the wrong evidence. The mitigation is to
make the confirmation label explicit, keep the warning note visible, and preserve provenance on the
lesson memory entry:

- student id,
- recording id,
- transcript id,
- transcript updated timestamp,
- trigger,
- generated timestamp,
- provider/model.

This does not require building memory management now, but it keeps a future repair/admin path
possible.

### Transcript is edited before confirmation

The tutor edits the transcript first, then confirms. Lesson memory should be generated from the
edited transcript version.

### Transcript is edited after confirmation

Editing the transcript changes the source version. The UI should require confirmation again or
clearly offer `Update learner context from edited transcript`. The backend may request fresh lesson
memory because `ensurePendingLessonMemoryEntry` treats older ready/pending entries as stale when
`transcripts.updated_at` advances.

### Duplicate clicks

Double-clicking the confirmation button must not enqueue duplicate model work. The UI should disable
the button while the request is in flight, and the backend must dedupe by transcript freshness.

### Existing pending lesson memory

If the tutor confirms while a current pending lesson-memory entry already exists, return
`pending_exists` and show the building state. Do not enqueue another job.

### Existing ready lesson memory

If current ready lesson memory already exists, return `ready_exists` and unlock the populate-profile
action immediately.

### Prompt-package and draft fallback hooks fire later

The existing prompt-package and draft fallback hooks should remain as self-healing paths for older
or unusual flows. They must be idempotent and should no-op when the confirmed-transcript path has
already created current pending or ready memory.

### Upload cache returns a reused transcript

If upload cache reuse returns an existing transcript/recording, the confirmation endpoint must still
bind the action to the currently selected student. It should not blindly trust stale recording
student metadata from a previous cached upload if that would attach memory to the wrong learner.

This is a key reason to make the route student-scoped and verify the requested student explicitly.

### Recording has no student

If there is no selected student, the confirmation gate should not appear. The tutor must choose a
student first.

### Student changes after transcript readiness

If the tutor changes student after transcript readiness and before confirmation, the confirmation
button label must update to the new student. Any local first-profile assist state should reset.

### Student changes after confirmation

If the tutor changes student after lesson memory is already pending for the old student, the UI must
not reuse that pending/ready status for the new student. Health polling is student-specific and
should reset.

### Worker failure

If lesson-memory generation fails, `memory/health` already exposes failed counts and latest failed
reason. The UI should show the failure and allow a retry/check action rather than spinning forever.

### Lesson title already manually edited

Generated lesson title must not overwrite a tutor-edited lesson title. Only automatic placeholder
titles are eligible for replacement.

### Generated title is empty or low quality

If the extractor cannot produce a useful title, keep the existing placeholder. Do not invent a title
from weak evidence.

## Implementation Notes

Likely backend touch points:

- `packages/batch-backend/src/application/request-lesson-memory-generation.ts`
- `packages/batch-backend/src/transport/extended-routes/students-routes.ts`
- `packages/batch-backend/src/application/generate-lesson-memory-entry.ts`
- `packages/batch-backend/src/application/lesson-memory-extraction.ts`
- `packages/batch-backend/src/domain/lesson-memory-model.ts`
- `packages/batch-backend/src/domain/lesson-memory-repository.ts`
- lesson/session repository code responsible for the visible lesson title

Likely frontend touch points:

- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx`
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.css`
- `packages/batch-frontend/src/utils/api.ts`
- sandbox API/test harness files for first-profile sessions

The follow-up PR should avoid a broad transcript UI redesign. The goal is a small confirmation gate
inside the current `Add teaching context` step.

## Acceptance Criteria

- Transcript readiness alone does not enqueue lesson memory.
- The first-profile assist shows the confirmation gate after transcript readiness.
- Clicking `Use this transcript for {studentName}'s learner context` requests lesson-memory
  generation.
- The UI changes to `Building lesson memory (1-2 minutes)` only after confirmation.
- Duplicate confirmation/fallback triggers do not cause duplicate model work for the same current
  transcript version.
- Editing a transcript can request fresh lesson memory after reconfirmation.
- Wrong-student and wrong-audio escape hatches are visible before memory is created.
- Lesson memory can produce a short lesson title.
- Generated title updates only automatic placeholders such as `Untitled lesson`.
- Manual lesson titles are preserved.
- Tests cover wrong-student prevention, duplicate trigger dedupe, transcript-edit freshness, and
  title overwrite rules.

## Non-Goals

- Do not build a full memory management UI in this slice.
- Do not redesign the transcript editor.
- Do not remove the prompt-package or draft fallback hooks.
- Do not make transcript completion itself the primary memory trigger.
- Do not overwrite tutor-authored lesson titles.

## Open Implementation Questions

1. Which persisted lesson/source field is the canonical visible title in the current assignment flow?
2. Should transcript edits after confirmation reset the UI to the same confirmation gate, or show a
   more specific `Update learner context from edited transcript` action?
3. Should the confirmation endpoint update recording/student binding when the selected student
   differs from cached recording metadata, or should it reject and require a new recording/session
   binding first?
4. What exact title placeholder values should be treated as automatic and safe to overwrite?
