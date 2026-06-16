# Chunk 4 Profile and New Student Readiness

## Goal

Make the first invited-tutor student flow reliable enough to create a student, work from a DB-owned
learner profile, activate a draft, and return to an overview that shows only current useful state.

## Scope

- Remove the normal tutor dependency on selecting an existing path-like learner profile during
  student creation.
- Keep foundational profile revisions as the canonical editing model.
- Fix profile revision labels and actions in the Learning page.
- Prevent contradictory activation feedback after activating the first empty draft.
- Keep old profile drafts out of the student overview's normal attention story.

## Non-Goals

- Do not change profile revision DTOs, database schema, or canonical revision semantics.
- Do not implement Chunk 5 tutor assignment cleanup.
- Do not implement Chunk 6 defaults unless a direct blocker appears while testing this flow.

## Test Plan

1. Add frontend red tests for student creation:
   - default creation submits only DB student data when no starter profile is filled;
   - the visible copy does not expose `.md` profile IDs as the normal creation path.
2. Add frontend red tests for Learning page profile revisions:
   - the current revision card displays the actual active version label from revision history;
   - active revisions do not show `Restore`;
   - activating a draft clears stale profile errors and shows only the success message.
3. Add frontend red tests for Overview:
   - older non-current drafts do not drive the primary status or attention cue when an active
     profile exists.

## Implementation Notes

- Prefer deriving the active revision detail from the revisions list when the learning surface only
  includes profile content plus revision summaries.
- Treat `profile.currentRevisionId` as the primary active revision identity, with `status:
"active"` as a fallback.
- Render restore only for non-active profile revisions.
- Keep the student creation payload builder conservative: if no starter profile or explicit
  binding is chosen, create only the student record.
- Filter overview draft attention to drafts that are newer than, or otherwise not superseded by,
  the active revision.

## Validation

- Targeted frontend tests for `StudentWorkspace.student-creation`, `StudentLearningPage`, and
  `StudentOverviewPage`.
- `pnpm --silent run check:fast:agent` before handoff if targeted tests pass.
