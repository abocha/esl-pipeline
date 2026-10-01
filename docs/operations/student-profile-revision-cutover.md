# Student-owned profile revision cutover (ABO-12)

## Meta

- Audience: maintainers and operators.
- Authority Level: migration and reconciliation procedure.
- Last Verified Against: 2026-10-01 implementation and isolated PostgreSQL fixtures.
- Owner: backend maintainer.
- Review Cadence: before upgrade or residual legacy removal.
- Status: `runbook`.

## Runtime contract

Student is the sole ownership root. `student_profile_revisions.student_id` references students;
`status = 'active'` and the single-active partial unique index select the current revision.
There is no active pointer on another table. Structured content, text/hash, version, source/creator,
activation/deprecation timestamps and same-student restore ancestry remain available. Student profile
provenance and initial-enrichment completion are student readiness facts, not a second identity.

Every profile route authenticates, resolves membership workspace and authorizes the student before
child access. Revision queries include both student and revision. Missing, archived and foreign
students share the same non-enumerating 404. Profile candidates and their draft/promotion links
have same-student foreign keys. Teacher edits, activation, restore, initial enrichment,
`teaching_context.v1`, Learning and assignment context all use that student-owned history.

API contract 6 removes `/profiles` catalogs/detail/revisions/query aliases and student bindings.
Use `GET/PUT /students/:id/profile`, `GET/POST /students/:id/profile/revisions`,
`GET /students/:id/profile/revisions/:revisionId`, and POST revision `activate`/`restore`.
Student create/update and assignment recovery cannot accept standalone profile selection/rebinding.
Prompt bootstrap imports templates only; `PROMPT_PROFILE_PATH` is retired. The legacy runtime DDL
catalog and its override, binding backfill/verification and profile-wide provenance backfill are retired.
DB contract 1 makes the schema cutover explicit. Old binaries must not run against the new schema.

## Migration 0059

The migration runs transactionally. A temporary, commit-discarded map uses explicit references from
students, historical bindings, prompt packages, sessions (including confirmed concrete revisions),
initial-enrichment operations and candidate links. It never infers an owner from `created_by`.

For each attributed student, the complete referenced profile history is copied with deterministic ID
`md5('abo12:' || student_id || ':' || legacy_revision_id)::uuid`. Shared profiles become independent
histories, including when the old students span workspaces. Revisions are numbered chronologically
across each student's histories, with original profile/revision/version retained as `legacy_*`
metadata. Content, hashes, structured JSON, creators, sources and original timestamps are copied.
Restore parents are remapped within the same student. Only the old active-status revision belonging
to `students.profile_id` stays active; historical active rows become deprecated. Historical bindings
never select current authority. Recorded profile provenance is transferred unchanged; unknown stays
unknown. New students start tutor-only without inventing historical enrichment evidence.

Current candidate/promotion and enrichment seed/result links are remapped to the student's copies.
Historical enrichment operation `legacy_profile_id` is metadata only; new operations leave it null.
Multiple historical successes/exact-source attempts are preserved. Conflicting live attempts must be
reconciled before the per-student live-operation constraint can be installed.

Prompt-package revision/hash/version/profile fields and session confirmed JSON/selection metadata
are left intact. New confirmations omit standalone identity; new packages have no independent
profile ID. Historical generation resolves a recorded revision only through the authorized student
and its exact hash; original IDs/version labels remain in resulting lineage. A confirmed null profile
never falls back to mutable current state. Existing packages remain explainable without bindings.

## Read-only upgrade preflight

Run these queries on an authorized restored backup first. This task does not access production.
Before an operator-authorized upgrade, retain a consistent backup and stop old writers/workers.
The checks below target schema 0058; do not apply them blindly after the rename.

```sql
BEGIN TRANSACTION READ ONLY;
-- One independent live enrichment operation is allowed per student after cutover.
SELECT student_id, array_agg(id ORDER BY created_at, id) AS operations
FROM profile_initial_enrichment_operations
WHERE state IN ('waiting_evidence','queued','submitting','result_ready','uncertain')
GROUP BY student_id HAVING count(*) > 1;

-- Review contradictory old active authorities instead of silently choosing an owner.
SELECT s.id AS student_id, s.profile_id, p.active_revision_id, r.id AS status_active_id
FROM students s JOIN profiles p ON p.id = s.profile_id
LEFT JOIN profile_revisions r ON r.profile_id = p.id AND r.status = 'active'
WHERE p.active_revision_id IS DISTINCT FROM r.id;

-- Cross-profile restore ancestry stays exact in the frozen archive; it requires
-- explicit reconciliation before the archive can ever be removed.
SELECT child.id, child.profile_id, child.restored_from_revision_id, parent.profile_id
FROM profile_revisions child JOIN profile_revisions parent
ON parent.id = child.restored_from_revision_id
WHERE child.profile_id <> parent.profile_id;
ROLLBACK;
```

Any nonempty result requires a recorded operator decision on the restored backup. For duplicate live
attempts, inspect each exact session/source/seed/submission/result evidence. Never resubmit or erase
an uncertain/submitting provider attempt to obtain a clean count. Reconcile confirmed provider
outcomes through the owning workflow; only explicitly supersede an unsubmitted obsolete attempt
when its durable evidence justifies that decision. Active-pointer disagreement requires choosing the
intended active revision explicitly before cutover. Do not infer either choice from creator identity.
Migration constraints fail closed and roll back if remapped workflow references cannot be attributed.

Rehearse migration, `db:verify` and generated `db:verify-baseline` on the restored backup. Compare
student/revision counts, content/hash/source/creator/restore copies, candidate and enrichment links,
and every historical package/snapshot against the pre-upgrade export. Exercise same-workspace
read/edit/draft/activate/restore and cross-student/workspace denial before an authorized rollout.
The destructive cleanup below is not a prerequisite for runtime containment of issue #280.

## Frozen residual storage and bounded cleanup

`legacy_profiles`, `legacy_profile_revisions` and `legacy_student_profile_bindings` retain the exact
old rows. Row triggers reject their insert/update/delete, including cascades that would destroy old
evidence. Normal runtime never reads them or resolves authority through them. Student deletion is
product archival; meaningful historical rows cannot be physically deleted incidentally.

The archive is deliberately temporary storage, not a new runtime abstraction. Unbound profiles and
unattributable history have no invented student owner. The repository cannot establish which of
those production rows are meaningful or disposable, so this PR cannot safely drop them.

Before a later, separately authorized drop:

1. On a consistent restored production backup, inventory every archived revision/profile/binding,
   plus old IDs in all package lineage, confirmed session JSON, selections and enrichment metadata.
   Join `legacy_profile_revisions.id` to `student_profile_revisions.legacy_revision_id`; group by
   explicit student references to identify unbound, multi-student and unmapped rows. Include historical
   sessions/packages with missing student attribution and cross-profile restore parents.
2. Verify deterministic copied IDs and byte/content/hash/source/creator/timestamp fidelity for all
   attributable rows. Verify same-student restored parents, candidate links and operation seed/result
   lineage. Confirm package and snapshot values are unchanged, including original version labels.
3. For every unmapped or ambiguous item, record a reviewed disposition: independently verified
   student attribution with an explicit copy, or retention in a recoverable immutable export with
   retention/access policy. Deletion of meaningful evidence requires an explicit decision. Creator
   identity, names and inferred workspace similarity do not establish ownership.
4. Account for all historical identifiers and cross-profile ancestry before removing archive foreign
   keys/triggers/tables. Keep `legacy_revision_id` and original labels in student revisions while
   historical assignments still need their exact recorded evidence. No binding table is needed for
   historical runtime reproduction. Rehearse the smallest follow-up drop migration and verify restore
   and historical package generation on the reconciled backup before requesting production authority.

Issue #280's runtime exposure is eliminated by the landed cutover; closing it does not claim that
this separately bounded archive reconciliation has happened. No production facts or cleanup result
are asserted by the local fixture evidence.
