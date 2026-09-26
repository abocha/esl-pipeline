# Historical learner-profile provenance backfill

## Meta

- Audience: operators and backend maintainers.
- Authority Level: operations runbook.
- Last Verified Against: 2026-09-26 repository state.
- Owner: batch-backend maintainers + automation agents.
- Review Cadence: after profile provenance tooling changes.
- Status: `active`.

This maintenance tool classifies historical `unknown` profiles only when durable evidence proves
completed evidence enrichment. It never assigns `tutor_only`; ambiguous profiles remain `unknown`.
The historical cohort is `profiles.created_at` strictly before the recorded `applied_at` of
`0056_first_profile_onboarding` in `schema_migrations`. Unknown profiles created at or after that
cutoff are reported as `OUT_OF_SCOPE`, separate from historical `KEEP_UNKNOWN` rows. Profiles with
unverifiable creation time are also out of scope. The cutoff is included in the reviewed report and
fingerprint.
It does not change runtime onboarding eligibility rules, profile content, revisions, active pointers,
candidate history, bindings, or restore lineage.

## Review a dry run

Run from a source checkout with the normal backend PostgreSQL environment configured:

```sh
pnpm --filter @esl-pipeline/batch-backend profile:provenance-backfill
```

The default invocation begins a read-only, repeatable-read transaction and prints JSON. Save and
review the report outside the repository as appropriate. It includes classifier and executable-code
hashes, database name and latest migration, counts, action/reason codes, profile IDs, supporting
revision/candidate/prompt-package IDs, proposed completion time and its basis, per-profile evidence
fingerprints, and an overall fingerprint. It contains no profile prose or candidate facts. The
observed counts must be derived from the database; prior production projections are not an input.

`CLASSIFY_EVIDENCE_ENRICHED` requires a `lesson_population` revision, a candidate link whose stored
evidence includes a nonempty quote (including a link copied to a manual draft), or hash-consistent
same-profile restore ancestry,
plus durable activation proof for that exact revision. Current activation needs a consistent active
pointer, status, and activation time. Historical activation can instead be proven by a dated
candidate promotion or an exact profile/revision/hash prompt-package observation with `active`
status. Draft creation and deprecation alone are insufficient. Evidence conflicts and unexpected
initial-enrichment operations defer to `KEEP_UNKNOWN`.

For historical backfill, `initial_enrichment_completed_at` is the **earliest durable timestamp
proving enrichment had completed by then**. It is an upper bound on original completion time, not
the exact first completion. Eligible sources are the qualifying activation time, candidate
promotion time, or prompt-package active-observation creation time. Draft creation, deprecation,
migration, and apply time are never substituted.

## Apply boundary

Production apply requires separate explicit authorization. After reviewing the report and its
fingerprint, the operator may run the same executable against the same database with:

```sh
pnpm --filter @esl-pipeline/batch-backend profile:provenance-backfill --apply --fingerprint <reviewed-report-fingerprint>
```

Apply uses a serializable transaction and locks eligible historical `unknown` profile rows in ID
order. It re-reads and reclassifies metadata, then rejects a changed overall fingerprint. It does
not take table-wide write-blocking locks. A changed
executable, migration state, profile state, or material evidence requires a new dry run and review.
Dry run requires migration 0056. Apply also requires migration 0057, which makes the profile
`updated_at` trigger preserve that column for an otherwise unchanged historical provenance-only
transition. Applying 0057 changes the report fingerprint, so review a fresh dry run afterward.
The only update sets `profiles.provenance` and `profiles.initial_enrichment_completed_at`, guarded
by the row still being historical `unknown` with null completion. Previously classified rows are no-ops; a
repeat dry run reports their current state without rewriting timestamps. A concurrent conflict
aborts the transaction; it must not be bypassed with a stale fingerprint.
