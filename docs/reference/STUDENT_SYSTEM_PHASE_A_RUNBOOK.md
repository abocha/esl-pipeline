# Student System Phase A Runbook (superseded)

## Meta

- Audience: maintainers and implementing agents.
- Authority Level: superseded procedure notice.
- Last Verified Against: 2026-10-01 ABO-12 cutover.
- Owner: backend maintainer.
- Review Cadence: after student persistence changes.
- Status: `reference`.

The former profile/binding backfill and verification commands are retired. Student-owned profile
revisions replace `students.profile_id`, standalone profiles and student/profile bindings.

Use [student-owned profile revision cutover](../operations/student-profile-revision-cutover.md) for
migration preflight, data-preservation checks and bounded legacy reconciliation. Fresh installs use
the generated baseline; upgrades use versioned migrations. Student Learning and onboarding create
revisions under an authorized student. There is no profile catalog bootstrap or rebinding step.
