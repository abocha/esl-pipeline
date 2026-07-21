# Replace Assignment Audio Design

## Goal

Allow a tutor to replace an incorrect uploaded lesson recording inside the same unfinished
assignment, without creating another scheduled lesson or assignment session and without allowing
the replaced lesson memory to remain active.

## Scope

- Add an inline `Replace audio` action to the existing Lesson source recording panel.
- Reuse the existing recording upload, transcription monitoring, transcript editor, assignment
  recovery, and Source confirmation paths.
- Keep the selected student, scheduled `lessonId`, active assignment session, and teacher context.
- Preserve the current recording and transcript when replacement upload fails or is cancelled.
- On successful replacement upload, switch recovery to the new recording/transcript and require
  Source confirmation again.
- Rely on existing Source confirmation persistence to supersede the replaced lesson-memory entry,
  supersede ready snapshots containing it, supersede pending snapshots, and invalidate prompt,
  draft, and preview artifacts.
- Prevent first-profile assistance from presenting or activating a draft tied to a replaced source.

## Non-goals

- No new HTTP endpoint, DTO, contract version, migration, or recording deletion.
- No automatic rewrite of already activated foundational profile revisions.
- No mutation of completed assignment history or Share-in-progress sessions.
- No replacement of manually pasted transcript sources in this change.

## Interaction

The Recording panel shows a secondary `Replace audio` button once an uploaded recording exists in
an unfinished assignment. Activating it reveals the existing single-file drop zone inline, with a
`Cancel replacement` action. The current recording and transcript remain visible while a new file
uploads. Failure or cancellation leaves them authoritative. Success swaps the working source to the
new recording and waits for its transcript.

The Source step becomes dirty through the existing assignment-session recovery fields. The tutor
cannot proceed downstream until `Confirm and continue` reconfirms the new recording/transcript.

## Data and invalidation

The upload continues to create a student-owned recording and transcript. Assignment recovery stores
their IDs on the existing session while retaining its `lessonId`. Source confirmation is the durable
authority boundary. When the confirmed transcript identity or hash changes, the backend already:

1. replaces the confirmed Source snapshot;
2. clears confirmed Context and Create state;
3. supersedes the previous ready or pending lesson-memory entry;
4. supersedes ready snapshots containing the old entry and all pending snapshots; and
5. queues memory generation for the replacement source.

Old rows remain as superseded audit history and are excluded from ready-memory retrieval.

## First-profile safety

Replacement mode and replacement upload suppress first-profile assistance. Changing the working
recording clears the local first-profile draft. An in-flight population response is accepted only if
the confirmed Source authority still matches the recording/transcript/hash captured when drafting
started. A stale response may leave an unactivated server draft for audit, but it cannot be offered
or activated from the assignment flow.

## Verification

- UI regression: replace action is available for an uploaded source, preserves the old source on
  failure, and switches to the replacement on success.
- Workflow regression: the same session and lesson are used, the replacement Source is reconfirmed,
  and downstream state is invalidated by the existing response.
- Profile regression: a population response from the replaced source is ignored and cannot be
  approved.
- Backend regression: retain the existing real-Postgres proof that confirming source B supersedes
  source A memory and snapshots.
