# Recover an unfinished assignment after terminal recording/STT failure

## Meta

- Audience: production operators and maintainers.
- Authority Level: current operator recovery procedure.
- Last Verified Against: 2026-09-14 production recovery and current assignment-session/recording routes.
- Owner: operations maintainers.
- Review Cadence: after assignment-source recovery, recording ingest, or resume UI changes.
- Status: `runbook`.

## Purpose

Use this as a temporary operator workaround when an unfinished assignment is stuck on a terminal
recording/STT failure and the normal `Replace audio` UI path is unavailable after resuming the
assignment. The UI defect and provider-failure incident are tracked in
[#255](https://github.com/abocha/esl-pipeline/issues/255).

This is **not** a retry of the failed transcription run. Normal terminal recovery is a new or
replacement recording upload. `POST /recordings/:recordingId/transcribe` is intentionally not a
manual retry path for a terminal failed recording.

The recovery mutation below detaches the failed `recordingId` and `transcriptId` from the unfinished
assignment session. It does not delete, rewrite, or revive the failed recording or its transcription
history.

## Safety boundary

Use this procedure only when all of the following are true:

- the assignment is unfinished;
- the selected recording is terminally `failed`;
- the assignment session still has `confirmedStep: "student"`;
- `shareJobId` is null;
- the intended lesson/session identity is unambiguous; and
- the normal `Replace audio` path is unavailable or broken.

Stop if any of those checks fail. In particular, do not use this procedure to unwind a confirmed
Source/Context/Create step or a shared assignment. Do not edit assignment, recording, transcription,
queue, or reservation rows directly in PostgreSQL to reproduce this effect.

## Prerequisites

Use a trusted operator shell with `curl` and `jq`. Set these variables from the normal authenticated
operator flow; do not paste credentials or access tokens into tickets, docs, shell history, or Git:

```bash
BASE="<public-origin>/api"
TOKEN="<short-lived-access-token>"
```

## 1. Find the assignment session by lesson

Prefer a known lesson ID rather than guessing from timestamps or student names.

```bash
LESSON_ID="<lesson-id>"

curl -fsS "$BASE/user/assignment-sessions?limit=50" \
  -H "Authorization: Bearer $TOKEN" |
  jq --arg id "$LESSON_ID" '
    .sessions[]
    | select(.lessonId == $id)
    | {
        id,
        studentId,
        lessonId,
        recordingId,
        transcriptId,
        revision,
        confirmedStep,
        shareJobId,
        updatedAt
      }
  '
```

If more than one session matches, inspect the returned IDs and timestamps and choose deliberately.
Do not continue until the intended unfinished assignment is clear.

## 2. Re-read and verify the canonical session

```bash
SESSION_ID="<assignment-session-id>"

SESSION="$(
  curl -fsS "$BASE/assignment-sessions/$SESSION_ID" \
    -H "Authorization: Bearer $TOKEN"
)"

echo "$SESSION" | jq '{
  id,
  studentId,
  lessonId,
  recordingId,
  transcriptId,
  revision,
  confirmedStep,
  shareJobId,
  updatedAt
}'
```

Before mutating anything, verify manually that:

- `lessonId` is the intended lesson;
- `recordingId` is the failed recording you mean to detach;
- `confirmedStep` is exactly `student`; and
- `shareJobId` is null.

Then inspect the recording itself:

```bash
RECORDING_ID="$(echo "$SESSION" | jq -r '.recordingId // empty')"

curl -fsS "$BASE/recordings/$RECORDING_ID" \
  -H "Authorization: Bearer $TOKEN" |
  jq '{recordingId, status, errorCode, source, studentId}'
```

Continue only when the recording status is `failed`. If any identity or state is unexpected, stop.

## 3. Detach the failed source with the recovery API

Use the current session revision. The recovery route is revision-checked; do not reuse a stale
revision after a conflict.

```bash
REV="$(echo "$SESSION" | jq -r '.revision')"

jq -nc \
  --argjson rev "$REV" \
  '{
    expectedRevision: $rev,
    patch: {
      recordingId: null,
      transcriptId: null
    }
  }' |
  curl -fsS -X PATCH \
    "$BASE/assignment-sessions/$SESSION_ID/recovery" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    --data-binary @- |
  jq '{id, lessonId, recordingId, transcriptId, revision, confirmedStep, shareJobId}'
```

Expected result:

- `recordingId: null`;
- `transcriptId: null`;
- `confirmedStep` remains `student`; and
- `shareJobId` remains null.

The failed recording remains durable history. This mutation only clears the unfinished assignment
session's current recording/transcript references.

## 4. Resume through the UI and upload again

Reload the app or resume the assignment again. Step 2 should return to the no-recording Lesson
source state while keeping the selected student/lesson context.

Before uploading:

1. Open **Recording settings**.
2. Choose the intended **Transcript engine**. Leave **Automatic (recommended)** unless an explicit
   provider override is needed; for example, select **Deepgram** when deliberately bypassing an
   unavailable ElevenLabs account.
3. Upload the lesson audio again.

The upload is a new recording/transcription attempt with new lineage. Do not try to revive the old
terminal run by calling the transcription retry endpoint or by editing BullMQ/PostgreSQL state.

## Failure handling

- **409 / revision conflict:** re-fetch the assignment session, inspect the new state, and decide
  again. Never replay the old patch with a guessed revision.
- **401:** authenticate again through the normal operator flow and obtain a fresh temporary token.
- **Session/recording checks fail:** stop. The workaround is intentionally narrower than the generic
  recovery API.
- **PATCH succeeds but the browser still shows the old source:** hard-refresh and resume the
  assignment again. Do not compensate by editing production tables directly.
- **PATCH itself fails unexpectedly:** stop and investigate the route/logs before another mutation.

When finished, clear temporary shell variables containing auth/session material.

## Retirement condition

This runbook is a temporary escape hatch, not the intended tutor workflow. Remove or demote it once
`Replace audio` reliably survives assignment resume/reload and provides the normal terminal-recovery
path through the UI.

## Related

- [`ordinary-recording-ingest-rollout.md`](ordinary-recording-ingest-rollout.md)
- [`TRANSCRIPTION_PIPELINE_SPEC.md`](../design/TRANSCRIPTION_PIPELINE_SPEC.md)
- [GitHub issue #255](https://github.com/abocha/esl-pipeline/issues/255)
