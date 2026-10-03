# Canonical Assignment State

## Meta

- Audience: product owner, maintainers, frontend/backend agents.
- Authority Level: active product design.
- Last Verified Against: 2026-09-23 canonical source-ownership implementation.
- Owner: founder-maintainer + frontend/backend maintainers.
- Review Cadence: after the canonical assignment-state upgrade ships or practical tutor use changes
  the decision.
- Status: `spec`.

## Purpose

Define the long-term product model for assignment identity, tutor-owned working content, backend
lineage, confirmation, recovery, and reconciliation. This document records approved behavior and
authority boundaries. It is not an implementation plan.

## Core Principle

> The tutor owns the words. The backend owns what those words belong to. Confirm and continue joins
> them atomically.

The browser must never be responsible for assembling structural relationships among an assignment,
source, transcript, profile revision, prompt package, draft, preview, or published job.

For new structured assignments, AssignmentV1 is the sole durable editable content authority. The
ABO-29 Slice 2 bridge exposes pretty-printed JSON in the existing whole-document editor. Invalid
syntax/schema/domain state stays local and cannot autosave, preview, confirm, correct or publish.
Resume loads the latest valid durable object. Formatting does not change canonical identity.
Historical Markdown remains behind explicit compatibility readers; deterministic AssignmentV1-to-PMD
projection is downstream scaffolding and does not create another editable authority.

## One Canonical Owner Per Lesson Source

For one tutor, one student, and one classified canonical lesson source, there is at most one current
assignment owner.

Selecting or uploading the same audio again reopens that assignment. It does not create a competing
assignment, even after the assignment has been shared. A completed assignment opens as immutable
history and normally retains ownership because shared sessions cannot replace Source.

An unfinished assignment may select a replacement Source without releasing the confirmed source.
Only successful confirmation of that replacement transfers the assignment to the new fingerprint
and releases the old fingerprint. Failed, cancelled, stale, or merely attached replacement work
does not release confirmed ownership. A later assignment may acquire a released fingerprint, but it
receives fresh recording and transcript IDs; prior artifact and lesson-memory lineage is historical
and cannot be revived for the new owner.

Historical nonowners can read their earlier prompts and drafts but cannot make new assignment
content from the released source. Prompt packages created for an assignment retain its session ID;
fresh draft creation and provider generation recheck the current confirmed binding, including after
an operator remap. Frozen job reruns, publication repair, and valid post-Share correction continue
from their existing job and artifact lineage.

The backend owns source identity and assignment identity. Audio identity is the prepared-media
fingerprint plus its scheme; manual transcript identity is the fingerprint of the acquisition-time
NFC/LF canonical text plus its scheme. Filenames, mutable transcript hashes, component state,
browser cache, job IDs, output IDs, and frontend-generated identifiers are not source-ownership
authorities. The system may reuse immutable storage internally, but that optimization must not
create a second owner or reuse assignment artifact lineage.

Source acquisition has only two successful tutor-facing outcomes:

```text
source_attached
existing_assignment_resumed
```

When the second outcome occurs, the interface opens the canonical assignment and explains:

> This lesson already has an assignment. We reopened it.

Database uniqueness failures and internal source identifiers are never exposed as workflow errors.

## Three State Layers

The product distinguishes three cooperating layers, not two competing authorities.

### Browser buffer

The visible characters currently being edited. This is the tutor's immediate working copy. It may
temporarily be newer than the backend while a recovery write is pending.

### Durable recovery

Backend-persisted, noncanonical working content. Automatic recovery protects tutor work from
refresh, navigation, crashes, and intermittent connectivity without confirming a workflow step or
changing downstream meaning.

### Confirmed snapshot

The last valid semantic state accepted through `Confirm and continue`. Confirmed snapshots are the
canonical inputs for downstream work and immutable assignment history.

`Confirm and continue` is therefore the semantic commit boundary, not the only persistence
boundary. It flushes the latest safe browser buffer, validates recovery against the loaded backend
revision, atomically promotes the visible step, and advances only after the backend returns the new
canonical state.

## Tutor Content and Backend Structure

The tutor controls:

- transcript corrections;
- lesson guidance;
- assignment draft text;
- whether to confirm a change;
- whether to request regeneration; and
- profile corrections through the Student Learning page.

The backend controls:

- canonical assignment and source identity;
- current and confirmed transcript lineage;
- active and assignment-pinned profile lineage;
- prompt and draft ownership;
- artifact versions, hashes, and storage pointers;
- invalidation and outdated-artifact relationships; and
- legal workflow transitions.

### Dependent projection invalidation

Confirmed source identity is also authority for lesson memory and every student-memory snapshot
that covers it. Replacing or retiring a confirmed source must either invalidate dependent memory
projections in the same authoritative transition or make every canonical reader derive their
ineligibility immediately. A stored `ready` label alone cannot keep a snapshot current after its
lesson evidence loses readiness, ownership, existence, or confirmed-source provenance.

Lesson-memory intents carry the confirming assignment session. Worker commits, canonical
lesson-memory reads, and student-memory snapshot eligibility all revalidate the session's current
confirmed binding and exact source provenance. A binding remap therefore changes authority
immediately without rewriting historical sessions, jobs, memories, or handouts.

Frontend requests may echo server-issued versions, hashes, or opaque lineage tokens to prove what
the tutor saw. They may not use hidden identifiers to dictate arbitrary structural combinations.
Partial profile lineage, a prompt paired with another prompt's draft, or a source owned by another
assignment is not a representable working state.

## Navigation and Recovery

Back and completed-step navigation do not confirm, invalidate, regenerate, or discard work.
Automatic recovery may persist edited content, but navigation alone does not change semantic state.

Unsaved browser content remains visible while the assignment is open. Durable recovery survives a
reload and resumes as visibly unconfirmed work. A small local recovery copy may supplement backend
recovery for an interrupted write, keyed by assignment, step, and loaded backend revision, but it is
never canonical and never overrides newer backend state silently.

An earlier-step edit changes downstream meaning only when the tutor confirms it.

## Serialized Operations

Operations that replace or depend on working content are serialized. While generating a draft, the
interface disables draft editing, regeneration, confirmation, and changes to generation inputs. It
shows a direct status such as:

> Generating a new draft...

While confirming a step, that step's editable controls and primary action remain locked until the
operation succeeds, fails, or is reconciled after an ambiguous response. Double clicks, delayed
responses, focus events, and overlapping recovery writes cannot reorder assignment meaning.

## Atomic Prompt and Draft Lineage

Generating an assignment produces one atomic authoring result:

```text
Prompt B + Draft B owned by Prompt B
```

The previous pair remains untouched until the replacement succeeds. A fresh prompt never updates
an existing draft owned by another prompt. If generation fails or its result becomes stale, the
previous visible pair remains authoritative and the late result cannot install itself.

The frontend receives the complete pair and displays it. It does not coordinate separate structural
writes or infer which existing draft should be reused.

## Outdated, Not Corrupt or Deleted

When the tutor confirms an earlier-step change, downstream content may cease to represent the new
meaning. The backend preserves that content and records it as outdated relative to the new confirmed
lineage.

For example, confirming changed Teaching context:

1. saves and confirms the new Context;
2. returns the workflow to Authoring;
3. retains the previous prompt/draft pair as based on the earlier Context; and
4. indicates that regeneration is required to apply the new guidance.

Outdated content may be reviewed or copied, but it cannot be confirmed, previewed, or shared as if
it belonged to current inputs. Invalidation changes authority, not historical content ownership.

## Conflicts and Reconciliation

Every recovery write, confirmation, and structural command carries the server revision or artifact
working version the tutor loaded. A current version succeeds normally. A stale version preserves the
local buffer and returns a semantic conflict rather than overwriting either side.

Expected genuine conflict sources include another tab or device, stale local recovery, and an
interrupted request that later completed. Normal same-tab editing must not create structural
conflicts because incompatible operations are locked and server commands return complete state.

Errors appear beside the action that failed and explain the next safe action. Generic HTTP status
text, raw database constraints, and apparently inert buttons are not acceptable tutor feedback.

## First-Profile Onboarding Integration

The automatic onboarding defined by
[`First-profile onboarding`](FIRST_PROFILE_ONBOARDING.md) begins only after the backend has confirmed
the canonical assignment source.

Eligibility and enrichment use durable profile provenance plus the exact confirmed source identity
and transcript hash. The enrichment operation is idempotent across refresh, focus changes,
navigation, retries, and ambiguous responses. Profile revision creation and activation are atomic,
and Teaching context receives one complete authoritative revision.

The assignment flow displays the profile and lesson-specific guidance but does not edit profile
fields or expose activation mechanics. If the tutor follows `Edit learner profile`, the Student
Learning page saves normal profile history. Returning to the assignment reloads authoritative
profile state, and Context confirmation pins the exact active revision the tutor reviewed.

## Completed Assignments

Share makes the canonical assignment immutable. Reopening the same source shows its confirmed
inputs, output, and publication history without permitting assignment-session mutations. A newer
mutable draft is identified as unpublished working content, never as a changed confirmed snapshot.
A new lesson needs a genuinely different canonical source.

Structural Share confirmation is distinct from publication availability. An unpublished failed or
queued root can retry the same frozen Share identity; correction is available only from a succeeded
HTML job in the session lineage with a non-empty URL.

Reruns or output-repair actions remain children of the same canonical assignment and do not create a
second assignment identity.

Post-Share correction is an explicit child-job operation, not a session revision. The tutor enters
correction mode, durably saves the existing mutable draft, and publishes a child bound to the exact
server-authoritative URI, working version, and hash. That child runs normal content-dependent
assignment generation with its own manifest/output identity, so corrected text cannot inherit audio
or rendered artifacts from the historical parent merely because lineage exists. The completed
session and original published job remain unchanged. Historical frozen-version republishing remains
a separate rerun operation.

## Why This Matters

This model prevents:

- duplicate assignments competing for the same lesson;
- cached-source ownership failures;
- profile loading gaps masquerading as absent profile state;
- partial profile lineage;
- new prompts updating drafts owned by older prompts;
- navigation or focus events changing semantic state;
- silent loss of tutor-authored content during invalidation; and
- generic errors that leave tutors unable to recover.

It keeps automatic recovery while removing structural authority from the browser, allowing the
first-profile experience to remain the simple teaching workflow defined by the product decision.

## Non-Goals

- Defining endpoints, database migrations, delivery phases, or an implementation sequence.
- Building real-time collaborative editing or an automatic text merge engine.
- Allowing duplicate homework assignments from one canonical source.
- Moving profile editing into the assignment flow.
- Making unconfirmed recovery canonical or worker-readable.

## Related

- [`First-profile onboarding`](FIRST_PROFILE_ONBOARDING.md)
- [`Product UI preferences`](PRODUCT_UI_PREFERENCES.md)
- [`Assignment confirmation contract`](../superpowers/specs/2026-07-18-assignment-step-confirmation-contract-design.md)
- [`Assignment reconciliation incident`](../operations/incidents/2026-07-22-assignment-reconciliation.md)
- [`Hosted MVP evidence`](../operations/hosted-mvp-evidence.md)
