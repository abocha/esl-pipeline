# Historical learner-profile provenance backfill (retired)

## Meta

- Audience: maintainers and operators.
- Authority Level: historical procedure notice.
- Last Verified Against: 2026-10-01 ABO-12 cutover.
- Owner: backend maintainer.
- Review Cadence: after residual legacy cleanup.
- Status: `reference`.

The profile-wide `profile:provenance-backfill` command is retired with standalone profile ownership.
Migration 0059 transfers the explicitly recorded provenance of each student's current legacy profile;
unknown provenance stays unknown. There is no current profile catalog to classify or bind.

Use the [student-owned revision cutover procedure](student-profile-revision-cutover.md) for preflight,
frozen historical evidence, reconciliation and eventual archive removal. Do not run the retired tool
against the frozen legacy tables or infer ownership or enrichment from creator identity.
