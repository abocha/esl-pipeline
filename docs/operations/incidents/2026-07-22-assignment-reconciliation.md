# Assignment Reconciliation Incident: 2026-07-22 to 2026-07-23

## Meta

- Audience: product owner, operators, maintainers, frontend/backend agents.
- Authority Level: incident record.
- Last Verified Against: 2026-07-23 production logs, database state, deployed v10.2.3, and tutor
  reports.
- Owner: founder-maintainer + frontend/backend maintainers.
- Review Cadence: after containment ships and after the long-term upgrade ships.
- Status: `reference`.

## Summary

Across two tutoring sessions, one alpha tutor was repeatedly blocked while creating an assignment.
The visible failures moved from Teaching context to Create and then to a fresh assignment's Lesson
source step. Production inspection established three separate defects connected by one authority
problem: frontend loading and authoring state could temporarily assemble structural lineage that
only the backend should own.

No malformed assignment was published. Confirm and Share failed closed, source media and transcript
content remained intact, tutor-edited draft content remained stored, and profile revision history
was preserved. The tutor nevertheless lost substantial time and could not complete the assignment
without operator investigation.

## Impact

- One alpha tutor was blocked across two days.
- An existing learner profile received an unnecessary additional generated revision after the UI
  incorrectly offered first-profile population.
- A generated assignment draft could not pass Create confirmation because its persisted ownership
  did not match the current prompt package.
- A recommended fresh-assignment workaround also stalled because exact-audio reuse collided with
  the original unfinished assignment.
- The interface presented apparent no-ops or generic HTTP errors instead of safe recovery actions.
- No invalid handout or job reached Preview, Share, or publication.

## Production Sequence

### 2026-07-22: profile authority and Create recovery

1. The tutor reached Teaching context with an already populated and approved learner profile.
2. Focus return briefly exposed an alternate empty-profile state.
3. Initial containment repaired partial profile lineage, but a later refresh still displayed
   `Populate first profile from lesson` while learner/profile discovery was unresolved.
4. The tutor followed the visible instruction. The backend created and activated another profile
   revision while retaining the previous revision as history.
5. Teaching context confirmed and generation succeeded.
6. Create confirmation rejected recovery because mutable recovery profile fields were empty while
   the durable confirmed Context snapshot held complete profile lineage.
7. Releases v10.2.1 through v10.2.3 progressively made profile lineage atomic, repaired Create from
   confirmed Context, made session lineage authoritative during hydration, and hid first-profile
   actions until authority resolved.

### 2026-07-23: regenerated draft crossed prompt lineage

1. The original assignment reached Review & share.
2. The tutor returned to Create and removed required draft sections. Validation correctly reported
   the missing structure.
3. The tutor requested generation again after the confirmed Create boundary had become dirty.
4. The frontend created a fresh prompt package and generated new text from it.
5. Draft persistence saw an existing draft and updated that older draft instead of creating a draft
   owned by the fresh prompt package.
6. Session recovery pointed at the fresh prompt and the older draft. Create confirmation correctly
   returned `ASSIGNMENT_STEP_LINEAGE_INVALID`.

### 2026-07-23: exact-audio workaround collided with canonical ownership

1. The tutor copied the draft and started a fresh assignment for the same student and audio.
2. Exact-audio cache reuse returned the original recording and transcript identifiers.
3. The original unfinished assignment already owned that recording.
4. Recovery writes for the new session violated the active-recording uniqueness constraint.
5. The backend logged the database constraint failure, but the Source CTA exposed neither the
   conflict nor the existing assignment to resume. No Source confirmation request was sent.

## Root Causes

### Asynchronous profile discovery overrode session authority

The refreshed client treated an asynchronously loaded learner option as profile authority. During
the loading gap, the pre-v10 first-profile helper interpreted unresolved state as no profile. This
allowed a valid existing profile to be repopulated and allowed incomplete lineage into recovery.

### Prompt and draft creation were frontend-coordinated

Generation created a prompt package, generated text, and persisted a draft through separate client
operations. Draft persistence selected update-versus-create based only on whether any draft was
loaded, not whether that draft belonged to the current prompt. The backend rejected the malformed
pair only at confirmation.

### Source caching and assignment uniqueness had no application-level reconciliation

Recording upload correctly reused immutable transcript work for identical audio, and the assignment
session correctly enforced one unfinished owner for a recording. No application command joined
those two rules. The resulting database uniqueness error was therefore treated as a failed recovery
write instead of `existing_assignment_resumed`.

### Recovery fields could represent illegal partial structures

Backend validation protected confirmed snapshots but allowed recovery to temporarily contain
partial profile lineage, partial source lineage, or a mismatched prompt/draft pair. Those states
made the UI appear ready while guaranteeing that a later confirmation would fail.

## Contributing Factors

- The first-profile helper predated the v10 confirmation and recovery model.
- Standard manual smoke generated once and advanced forward; it did not return from Review & share,
  dirty Create, and regenerate.
- Prompt invalidation coverage asserted that a fresh prompt was requested but did not assert that a
  fresh draft was persisted under it.
- Recording-cache coverage tested reuse and cross-student cloning without attaching one cached
  recording to a second assignment session for the same tutor and student.
- Recovery failures and confirmation lineage errors were not consistently translated into
  actionable CTA feedback.
- The fresh-assignment workaround assumed storage reuse implied assignment reuse was legal.

## What Protected Data Integrity

- Confirmed snapshots remained separate from mutable recovery.
- Source and Create confirmation revalidated artifact versions, hashes, and ownership.
- The active-recording unique index prevented two unfinished sessions from owning the same source.
- Create confirmation rejected the cross-prompt draft.
- Share and publication consume confirmed Create state rather than arbitrary recovery pointers.

These controls converted corruption into visible blockage. The remaining product requirement is to
make the safe recovery automatic and understandable.

## Containment Decision

The safety hotfix will:

1. convert canonical-source collisions into an existing-assignment resume outcome;
2. reconcile the affected empty newer session to the older canonical assignment;
3. preserve tutor draft text while repairing the recoverable prompt/draft mismatch or, when that
   cannot be proved safe, return to confirmed Context with the old draft retained as outdated;
4. prevent a fresh prompt from updating a draft owned by another prompt;
5. serialize incompatible generation, editing, and confirmation actions; and
6. show semantic recovery or confirmation failures beside the active CTA.

This containment does not implement the larger assignment-state or first-profile redesign.

## Long-Term Product Decision

The approved durable model is documented in
[`Canonical assignment state`](../../design/CANONICAL_ASSIGNMENT_STATE.md). It establishes:

- lifetime uniqueness for tutor, student, and canonical lesson source;
- backend-owned assignment identity and structural lineage;
- browser buffer, durable recovery, and confirmed snapshot as three distinct layers;
- atomic prompt/draft generation;
- preserved outdated artifacts after confirmed upstream changes;
- serialized structural operations and semantic conflicts; and
- automatic first-profile enrichment only after canonical Source confirmation.

The canonical assignment-state and first-profile onboarding designs are expected to ship together
as one future upgrade package. They are product decisions in this incident response, not part of the
safety hotfix implementation.

## Verification Needed for Containment

- Exact audio selected in another new session resolves to the canonical assignment without a raw
  uniqueness failure.
- The existing malformed prompt/draft recovery state becomes confirmable without losing draft text.
- Regeneration after returning from Review & share creates a new prompt/draft pair.
- Editing and confirmation cannot race an in-flight generation.
- Recovery and confirmation failures remain on the current step and appear beside its CTA.
- The original first-profile hydration regressions remain green.
- Preview and Share consume only the newly confirmed Create snapshot.

## Privacy

This record intentionally omits tutor email, student name, source filename, transcript content,
lesson guidance, assignment content, and production identifiers. Operational evidence remains in
restricted production logs and database history.

## Related

- [`Canonical assignment state`](../../design/CANONICAL_ASSIGNMENT_STATE.md)
- [`First-profile onboarding`](../../design/FIRST_PROFILE_ONBOARDING.md)
- [`Hosted MVP evidence`](../hosted-mvp-evidence.md)
- [`Assignment confirmation contract`](../../superpowers/specs/2026-07-18-assignment-step-confirmation-contract-design.md)
