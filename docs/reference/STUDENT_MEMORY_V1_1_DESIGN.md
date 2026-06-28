# Student Memory v1.1 Design: Bounded Snapshot Refresh and Memory Observability

## Meta

* Suggested path: `docs/reference/STUDENT_MEMORY_V1_1_DESIGN.md`
* Audience: founder-maintainer, Codex implementation agents, backend/frontend maintainers.
* Authority level: design reference for the v1.1 student-memory hardening slice.
* Status: validated design reference; execution is split under `docs/plans/student-memory-system-upgrade/`.
* Intended timing: before Closed Alpha.
* Scope type: structural v1 improvement, not a v2 rewrite.
* Last verified against: 2026-06-28 repo state.
* Related:

  * `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`
  * `docs/plans/student-memory-system-upgrade/README.md`
  * `docs/plans/student-profile-enrichment/README.md`
  * `docs/reference/HOMEWORK_PROMPTING_SYSTEM_GUIDE.md`
  * `packages/batch-backend/src/application/process-student-memory-snapshot-job.ts`
  * `packages/batch-backend/src/application/student-memory-snapshot-prompt.ts`
  * `packages/batch-backend/src/application/student-profile-candidates.ts`
  * `packages/batch-backend/schema.sql`

## Executive Summary

Student Memory v1 is architecturally sound, but its long-term snapshot refresh path is currently unbounded.

The assignment-generation path is stable and should not be disturbed. Current observed token usage is acceptable for:

* lesson memory generation: approximately 11k–13k input tokens
* homework memory generation: approximately 11k–13k input tokens
* assignment generation: approximately 18k input tokens
* profile draft generation: approximately 21k input tokens

The problem is the long-term student-memory snapshot refresh path, which currently sends approximately 120k–130k input tokens for active students. That is too large for the current pre-alpha/alpha readiness phase. It creates provider cost, latency, noise, duplicate downstream profile candidates, and unnecessary operational complexity.

Student Memory v1.1 should fix this before Closed Alpha.

The v1.1 goal is not to redesign memory from scratch. The goal is to keep the v1 architecture and make it bounded, observable, and less wasteful.

Core v1.1 direction:

```text
Do not rebuild the long-term snapshot from full history during normal operation.

Instead:
previous ready snapshot
+ one new canonical memory source
+ limited supporting context
+ unresolved/backlog continuity
= next ready snapshot
```

Full-history snapshot rebuild should remain available only as an explicit maintenance/admin/backfill action.

## Validation Summary

This design is valid with a few repo-grounded corrections.

Confirmed:

1. `processStudentMemorySnapshotJob` currently loads all ready lesson memory and all ready homework
   memory on the normal snapshot-refresh path.
2. `requestStudentMemorySnapshotRefresh` already carries `trigger` and `sourceEntryId`, so the
   incremental path can use the existing queue contract instead of inventing a second worker.
3. Recent-memory repository helpers already exist:
   `listRecentReadyLessonMemoryByStudentId` and `listRecentReadyHomeworkMemoryByStudentId`.
4. Memory inspection is not starting from zero. The backend already has
   `student-memory-inspection.ts`, the transport exposes memory-snapshot list routes, the frontend
   API can list snapshots, and the Learning page already shows a basic student-memory summary.
5. Candidate refresh currently inserts rejected duplicate/stale candidate records, so the candidate
   noise concern is grounded in implementation, not just product intuition.
6. Token estimation should reuse the existing generation-budget estimator path used by student
   memory pacing instead of introducing a separate estimator.

Corrections to the original draft:

1. Treat v1.1 observability as an extension of existing inspection surfaces, not a new dashboard
   from scratch.
2. Prefer `generation_notes` first for v1.1 strategy, coverage, metrics, and candidate-refresh
   details. Add explicit columns only if implementation needs indexed filtering or if the UI cannot
   stay simple with parsed notes.
3. Treat the existing `refresh-student-memory-snapshots` tool as the seed for manual rebuild and
   backfill operations, but make strategy and reason explicit before using it as the v1.1 full
   rebuild interface.
4. Use an explicit bootstrap strategy name when no prior ready snapshot exists, so first-snapshot
   behavior is auditable.

## Product Readiness Context

The project North Star is that a solo ESL tutor can create and publish a useful homework assignment in under 12 minutes, without technical setup, while reliably tracking lesson-package balance.

The student-memory system supports that goal only if it improves continuity without making the system expensive, opaque, or fragile.

The current 120k–130k long-term snapshot refresh is not a future scalability concern anymore. It is already a pre-alpha readiness blocker because:

1. It burns provider tokens on repeated full-history work.
2. It makes memory refresh latency and cost unpredictable.
3. It creates too many near-duplicate profile candidates.
4. It hides important memory-system behavior from the UI.
5. It increases the chance that Closed Alpha support work becomes debugging invisible backend jobs instead of helping tutors use the core flow.

This work should happen before Closed Alpha, not between Alpha and Beta.

Reasoning:

* Gate A, Founder-Operator Stability, requires repeated flow operation with low failure and no setup surprises.
* Gate B, Pre-Alpha, requires one real tutor to complete the core flow repeatedly with bounded support.
* Gate C, Closed Alpha, should admit 3–5 tutors only after obvious reliability and usability blockers are removed.
* A memory job that regularly sends 120k–130k input tokens is an obvious reliability/cost/operability blocker.

## Current Architecture

Student Memory v1 already has the right high-level architecture:

1. Runtime generation is backend-orchestrated and deterministic.
2. The live homework-generation path remains one prepared prompt package, one provider call, one reply.
3. Student context is split into:

   * foundational profile
   * lesson memory
   * homework memory
   * student memory snapshot / rollup
4. Foundational profile remains the highest-authority student document.
5. Inferred facts from lesson or homework memory do not automatically mutate the foundational profile.
6. Memory artifacts are DB-canonical, versioned, and provenance-aware.
7. Prompt packages snapshot the memory state they used.
8. The system must not depend on provider-specific prompt caching to be viable.

These decisions should remain locked for v1.1.

## Current Implementation Baseline

### Assignment Generation

The assignment-generation path is performing well enough and is not the target of v1.1.

The live assignment package already uses bounded student memory retrieval:

* latest student memory snapshot
* latest 3 lesson memory entries
* latest 2 homework memory entries
* unresolved issues
* teacher notes
* latest transcript

Observed assignment input token size is approximately 18k, which is acceptable.

Do not refactor assignment generation as part of v1.1 unless a change is strictly required to consume the improved snapshot metadata.

### Lesson Memory and Homework Memory

Lesson memory and homework memory are also acceptable for v1.1.

Observed token usage:

* lesson memory input: approximately 11k–13k
* homework memory input: approximately 11k–13k

These jobs should remain structurally similar. They are not the current source of waste.

### Long-Term Student Memory Snapshot

The current snapshot refresh path loads all ready lesson memory and all ready homework memory for the student, then builds a full prompt over all of it.

Conceptually, the current normal path is:

```text
all ready lesson memory
+ all ready homework memory
= new long-term snapshot
```

This was acceptable as the first implementation because it produced a canonical rollup from known sources. It is no longer acceptable as the normal path because real active students already produce 120k–130k snapshot-refresh prompts.

### Profile Candidate Refresh

After a snapshot is produced, the system requests a student-profile-candidate refresh.

The current candidate system is partially delta-aware because it focuses on the latest lesson memory and compares against snapshot personal facts and older lesson memory facts. However, it is still triggered by snapshot readiness and can produce many near-duplicate candidate records when the upstream snapshot job is too broad or too repetitive.

v1.1 should reduce useless candidate work by making snapshot refresh incremental and by adding candidate-generation gating and observability.

## Problem Statement

The v1 student-memory architecture stores canonical history correctly, but the snapshot refresh strategy treats the long-term snapshot as a recurring full-history summarization job.

That creates four problems.

### 1. Unbounded Prompt Growth

As the number of lesson/homework memory entries grows, snapshot-refresh input grows with it.

This violates a core v1 memory principle:

```text
All history may be stored, but only bounded selected context should be sent to model calls.
```

### 2. Repeated Work

The same old memory entries are summarized repeatedly. The system pays again and again to process facts that are already present in the previous snapshot.

### 3. Candidate Noise

Broad snapshot refresh creates many profile candidate opportunities that are already known, stale, or near-duplicates.

Deduplication catches some of this, but too much useless work is happening before or during candidate generation.

### 4. Poor Operational Visibility

Important memory-system internals are not visible enough in the UI:

* latest snapshot status
* strategy used
* input token estimate
* included lesson/homework memory count
* candidate count
* skipped duplicate count
* failed job reason
* snapshot staleness
* retry/full rebuild actions

The backend is deeper than the current UI reveals.

## v1.1 Goal

Student Memory v1.1 should make the existing memory architecture bounded, observable, and operationally safe for Closed Alpha.

The main goal:

```text
Reduce normal long-term snapshot refresh from ~120k–130k input tokens
to a bounded target range, ideally ~15k–30k.
```

This is not an exact guarantee because transcript and memory size vary. It is a target for normal incremental refresh. Full rebuild may still be larger when explicitly requested.

## Non-Goals

v1.1 must not become a v2 rewrite.

Out of scope for v1.1:

1. Embedding search.
2. Agentic runtime memory retrieval.
3. Full semantic retrieval redesign.
4. Legal/data lifecycle work such as export/delete/redaction workflows.
5. Advanced tutor-facing memory editing UX.
6. Large eval framework or AI-lab-style repeated quality experiments.
7. Broad assignment-generation refactor.
8. Provider-specific prompt caching dependency.
9. Automatic mutation of foundational profiles from inferred memory.
10. Full product dashboard redesign.

Data lifecycle remains important for future product maturity, but it is intentionally deferred because the product is not yet publicly launched and the immediate blocker is unbounded memory work.

## Design Principles

### 1. Keep v1 Architecture

Do not replace the architecture. Tighten it.

Keep:

* DB-canonical artifacts
* deterministic backend-owned retrieval
* stateless provider calls
* provenance-aware memory records
* foundational profile authority
* prompt-package lineage
* bounded online assignment generation

### 2. Snapshot Is State, Not Archive

The database is the archive.

The long-term snapshot is the current compressed state.

Normal snapshot refresh should update the current state using new evidence, not reread the whole archive every time.

### 3. Delta First

Normal refresh should be delta-based:

```text
previous snapshot
+ source memory entry that triggered refresh
+ small supporting context
= next snapshot
```

### 4. Full Rebuild Is Explicit

Full-history rebuild remains useful for:

* repair
* migration
* backfill
* manual replay
* debugging
* quality audit

But it must not be the default refresh path.

### 5. Measure Before Model Calls

Every memory-generation path should record enough prompt metrics to diagnose waste:

* estimated input tokens
* output tokens when available
* source counts
* strategy
* trigger
* model/provider
* created/skipped candidate counts

### 6. Useful Work Only

A memory job should have a plausible useful output.

If the system expects mostly duplicate candidates or no meaningful snapshot change, it should skip, compact, or mark no-op instead of sending a large model request.

## Proposed v1.1 Architecture

### Snapshot Refresh Modes

Introduce explicit snapshot refresh strategies.

Recommended strategy enum:

```ts
type StudentMemorySnapshotRefreshStrategy =
  | 'incremental_v1_1'
  | 'bootstrap_incremental_v1_1'
  | 'full_rebuild_v1'
  | 'manual_rebuild_v1_1';
```

Recommended behavior:

| Strategy              | Normal path? | Input shape                                                           | Purpose                             |
| --------------------- | -----------: | --------------------------------------------------------------------- | ----------------------------------- |
| `incremental_v1_1`    |          yes | previous ready snapshot + trigger source + bounded supporting context | normal operation                    |
| `bootstrap_incremental_v1_1` | yes, first snapshot only | latest bounded lesson/homework memory set | first snapshot without full history |
| `full_rebuild_v1`     |           no | all ready lesson/homework memory                                      | legacy compatibility and comparison |
| `manual_rebuild_v1_1` |           no | explicitly selected broader memory set                                | repair/backfill/admin action        |

### Snapshot Coverage Metadata

Each ready snapshot should know what it covers.

Use typed structured `generation_notes` first. The current table already stores snapshot source ids,
`content_hash`, and `generation_notes`, and the existing inspection endpoints return the whole
record. This keeps v1.1 smaller before Closed Alpha.

Add explicit columns only when a field must be indexed, filtered without JSON parsing, or displayed
across large snapshot lists.

Minimum required metadata:

```ts
interface StudentMemorySnapshotCoverage {
  strategy:
    | 'incremental_v1_1'
    | 'bootstrap_incremental_v1_1'
    | 'full_rebuild_v1'
    | 'manual_rebuild_v1_1';
  parentSnapshotId: string | null;
  trigger: 'lesson-memory-ready' | 'homework-memory-ready' | 'manual-replay';
  triggerSourceKind: 'lesson_memory' | 'homework_memory' | 'manual' | null;
  triggerSourceEntryId: string | null;

  includedLessonMemoryEntryIds: string[];
  includedHomeworkMemoryEntryIds: string[];

  coveredLessonMemoryEntryIds?: string[];
  coveredHomeworkMemoryEntryIds?: string[];

  latestCoveredLessonMemoryGeneratedAt?: string | null;
  latestCoveredHomeworkMemoryGeneratedAt?: string | null;

  inputTokenEstimate?: number | null;
  outputTokenEstimate?: number | null;
  promptByteLength?: number | null;
}
```

Important distinction:

* `included*Ids` means sources included in the current model request.
* `covered*Ids` means sources represented by the resulting snapshot.

For incremental refresh, `included*Ids` should be small. `covered*Ids` may refer to the prior coverage plus the new trigger source.

### Normal Incremental Snapshot Flow

New normal path:

```text
lesson/homework memory becomes ready
→ request student-memory snapshot refresh
→ load latest ready snapshot for student
→ load trigger source entry
→ load limited supporting context
→ build incremental snapshot prompt
→ generate next snapshot
→ mark older pending/ready snapshots superseded as currently appropriate
→ request profile candidate refresh only if the snapshot changed materially
```

Recommended incremental input:

1. Previous ready snapshot.
2. Trigger source entry:

   * the lesson memory entry that just became ready, or
   * the homework memory entry that just became ready.
3. Limited supporting context:

   * last 2 lesson memory entries, excluding the trigger if already included
   * last 1 homework memory entry, excluding the trigger if already included
   * unresolved issues from previous snapshot
   * active review backlog from previous snapshot
4. Optional compact provenance summary from previous snapshot.

Do not include all historical lesson/homework memory entries.

### Incremental Prompt Contract

The new prompt should not ask the model to summarize full history.

It should ask the model to update a previous state.

Conceptual prompt shape:

```text
You are updating an existing long-term ESL student-memory snapshot.

Inputs:
1. Previous snapshot
2. New canonical memory source
3. Small supporting context

Task:
- Preserve still-valid long-term facts from the previous snapshot.
- Incorporate new durable evidence from the new source.
- Update recurring issues, review backlog, progress, personal facts, recommended assignment directions, and unresolved issues.
- Remove or de-emphasize stale items only when the new evidence clearly contradicts them.
- Do not invent facts.
- Do not duplicate semantically identical items.
- Keep the snapshot compact and useful for homework generation.
```

### First Snapshot Behavior

If no previous ready snapshot exists, use a bounded bootstrap strategy instead of unbounded full history by default.

Recommended bootstrap input:

* latest 5 lesson memory entries
* latest 3 homework memory entries
* optionally all unresolved/high-confidence items if already available
* no full-history load unless explicitly requested

Name:

```text
bootstrap_incremental_v1_1
```

Do not fold this into `incremental_v1_1` with only `parentSnapshotId: null`. The explicit strategy
name is clearer in logs, metrics, and support/debug views.

### Manual Full Rebuild

Add an explicit admin/manual path for full rebuild.

Use cases:

* migration
* corrupted snapshot
* suspected bad incremental drift
* intentional quality reset
* backfill for one student

Manual full rebuild should be visible in logs/UI and should not be automatically triggered by every lesson/homework memory update.

Recommended CLI/admin action:

```bash
refresh-student-memory-snapshot --student-id <id> --strategy manual-rebuild --reason "..."
```

Optional flags:

```bash
--max-lesson-memory <n>
--max-homework-memory <n>
--since <date>
--dry-run
```

Repo note: `packages/batch-backend/src/tools/refresh-student-memory-snapshots.ts` already exists.
v1.1 should extend or replace that tool so manual replay can choose an explicit strategy and reason.
Do not leave `manual-replay` as an ambiguous trigger that still silently uses the full-history normal
builder.

### Token Budgeting

Add a hard budget for student-memory snapshot prompts.

Recommended defaults:

```ts
const STUDENT_MEMORY_SNAPSHOT_INCREMENTAL_TARGET_INPUT_TOKENS = 25_000;
const STUDENT_MEMORY_SNAPSHOT_INCREMENTAL_HARD_INPUT_TOKENS = 35_000;
const STUDENT_MEMORY_SNAPSHOT_FULL_REBUILD_WARN_TOKENS = 60_000;
```

Behavior:

* Estimate token/byte size before provider call.
* If incremental prompt exceeds hard budget, compact supporting context or drop optional supporting context first.
* If still over budget, fail the job with a clear error instead of sending a surprise 120k request.
* Full rebuild may exceed this budget, but should log and display a warning.

Use the existing `estimateGenerationTokens` budget-guard path. Byte length should still be recorded
for quick debugging, but it should not become a second policy estimator unless the budget helper is
unavailable.

### Snapshot Material Change Detection

Avoid triggering profile candidate refresh when the snapshot has not changed meaningfully.

Recommended lightweight approach:

1. Compute a normalized snapshot content hash.
2. Compare previous ready snapshot hash to new snapshot hash.
3. If unchanged or nearly unchanged:

   * store the refresh result as no-op or ready-with-same-content according to existing repository patterns
   * do not enqueue profile candidate refresh
   * log `snapshot_no_material_change`

If “near equality” is too much for v1.1, exact normalized hash equality is enough.

### Candidate Refresh Gating

The current candidate refresh is downstream of snapshot readiness. v1.1 should make it less noisy.

Recommended behavior:

Only request candidate refresh if at least one of the following is true:

1. The trigger source contains one or more non-transient `studentFacts`.
2. The new snapshot has materially changed personal facts.
3. The new snapshot has materially changed durable preferences/constraints.
4. Manual replay explicitly requested candidate refresh.

Do not request candidate refresh after every snapshot if the triggering memory contains no profile-worthy material.

### Candidate Dedup Policy

Keep deterministic candidate keys.

Prefer skipping duplicate candidate insertion before creating extra rejected records, unless those rejected records are intentionally used as an audit trail.

Current behavior may insert rejected records for stale or duplicate proposals. This is useful for traceability but may inflate storage and UI noise.

v1.1 decision needed:

Option A, audit-heavy:

* continue inserting rejected duplicate/stale candidate records
* add UI aggregation and hide them by default

Option B, lean:

* do not insert duplicate/stale candidate records by default
* log skipped duplicates as metrics only
* keep optional debug/audit mode for detailed duplicate records

Recommended v1.1 default: Option B.

Reason: the current pain is useless work and noisy output. The system should not preserve every duplicate as a first-class review artifact unless needed for debugging.

### Memory Observability

Extend the existing memory inspection surfaces. This is not a polished tutor-facing dashboard. It is
founder/operator observability.

Recommended placement:

* existing student-area Learning page memory card
* existing memory snapshot list route/API
* internal/admin route only if the existing student-area surface becomes too noisy

Minimum fields per student:

```text
Latest snapshot
- status
- generated_at
- strategy
- parent snapshot id
- trigger
- trigger source id
- input token estimate
- output token estimate if available
- included lesson memory count
- included homework memory count
- covered lesson memory count
- covered homework memory count
- content hash
- no-op/material-change status

Memory entries
- lesson memory ready/pending/failed count
- homework memory ready/pending/failed count
- latest failed memory job reason

Candidate refresh
- last refresh time
- created count
- skipped duplicate/stale count
- pending review count
- approved/rejected/deferred count

Actions
- retry failed snapshot
- run incremental refresh
- run manual full rebuild
- dry-run token estimate
```

This can be plain and ugly. It should be useful, not beautiful.

Product boundary: normal tutors should see memory health only when it helps them recover or trust the
workflow. Token estimates, strategy ids, content hashes, and manual rebuild actions are operator
details unless the founder decides to expose an advanced/support mode.

### Memory Job Metrics

Store and log metrics consistently.

Recommended metric fields:

```ts
interface StudentMemoryJobMetrics {
  workload:
    | 'lesson_memory'
    | 'homework_memory'
    | 'student_memory_snapshot'
    | 'student_profile_candidates';

  provider?: string;
  model?: string;

  inputTokenEstimate?: number;
  outputTokenEstimate?: number;
  promptByteLength?: number;

  strategy?: string;
  trigger?: string;

  lessonMemoryInputCount?: number;
  homeworkMemoryInputCount?: number;

  candidateCreatedCount?: number;
  candidateSkippedDuplicateCount?: number;
  candidateSkippedStaleCount?: number;

  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;

  errorCode?: string;
  errorMessage?: string;
}
```

For v1.1, this should live in typed `generation_notes`, existing batch `usage` fields, and logs.
Avoid building a large telemetry system or a dedicated metrics table before Closed Alpha.

## Suggested Implementation Plan

### Phase 0: Confirm and Instrument

Goal: make the current waste visible before changing behavior.

Tasks:

1. Add snapshot prompt metrics:

   * prompt byte length
   * rough input token estimate
   * lesson memory count
   * homework memory count
   * strategy label, initially `full_rebuild_v1`
2. Log metrics before provider call.
3. Store metrics in typed `generation_notes`.
4. Surface these metrics through the existing memory inspection API and Learning page support
   details, or at least through the existing memory snapshot list endpoint.

Exit criteria:

* For a real active student, the system displays or logs that long-term snapshot refresh uses ~120k–130k input tokens.
* Assignment generation remains unchanged.
* Lesson/homework memory generation remains unchanged.

### Phase 1: Add Incremental Snapshot Path

Goal: stop full-history snapshot rebuild from being the default.

Tasks:

1. Add latest ready snapshot lookup to snapshot job dependencies.
2. Add trigger source loading:

   * if trigger is `lesson-memory-ready`, load source lesson memory by `sourceEntryId`
   * if trigger is `homework-memory-ready`, load source homework memory by `sourceEntryId`
3. Reuse existing bounded supporting context queries:

   * recent lesson memory limit 2
   * recent homework memory limit 1
   * exclude trigger source from duplicate inclusion
4. Add new incremental prompt builder:

   * `buildIncrementalStudentMemorySnapshotPrompt`
   * `buildIncrementalStudentMemorySnapshotEnvelope`
5. Keep existing full-history prompt builder for manual rebuild only.
6. Store snapshot strategy and coverage metadata in typed `generation_notes`.

Exit criteria:

* Normal lesson/homework memory completion triggers `incremental_v1_1`, not full-history rebuild.
* Normal snapshot refresh does not list all historical memory entries.
* Normal snapshot refresh input target is roughly 15k–30k for active students.
* Full rebuild still exists as manual/admin path.

### Phase 2: Add Hard Budgets and Safe Failure

Goal: prevent future silent prompt bloat.

Tasks:

1. Add configurable incremental snapshot token budget.
2. Add preflight prompt-size check.
3. Compact/drop optional supporting context if above target.
4. Fail clearly if above hard budget.
5. Display/log the failure reason.

Exit criteria:

* The system cannot accidentally send a 120k normal incremental snapshot refresh.
* Oversized jobs fail before provider call with actionable diagnostics.
* Manual full rebuild can still bypass or use a higher explicit budget.

### Phase 3: Gate Candidate Refresh

Goal: stop creating profile candidate noise when nothing profile-worthy changed.

Tasks:

1. Detect whether trigger source contains profile-worthy `studentFacts`.
2. Detect whether snapshot personal facts changed by normalized hash.
3. Enqueue candidate refresh only when useful.
4. Add candidate refresh metrics:

   * created
   * skipped duplicate
   * skipped stale
   * skipped because no profile-worthy delta
5. Prefer not inserting duplicate/stale candidate records by default unless audit mode is enabled.

Exit criteria:

* Candidate refresh is not triggered after every snapshot blindly.
* Duplicate/stale candidate noise drops sharply.
* UI/debug output shows why candidate refresh ran or was skipped.

### Phase 4: Minimal Memory Debug Panel

Goal: make memory state inspectable without building a polished dashboard.

Tasks:

1. Add backend endpoint for student memory health/debug state.
2. Extend the existing Learning page memory panel and memory snapshot list API response.
3. Show latest snapshot metrics, memory counts, candidate counts, and recent failures.
4. Add manual actions:

   * retry failed snapshot
   * run incremental refresh
   * run manual full rebuild
   * dry-run token estimate if cheap

Exit criteria:

* Founder/operator can answer “why is this student memory stale or expensive?” inside the app.
* OpenAI Platform logs are no longer the only practical observability surface.
* UI remains minimal and internal; no broad product UX redesign required.

### Phase 5: Minimal Regression Checks

Goal: protect the v1.1 behavior without creating a research project.

This is not a large eval framework.

Add a small number of deterministic tests/fixtures:

1. Incremental refresh does not call `listAllReadyLessonMemory` / `listAllReadyHomeworkMemory`.
2. Incremental prompt includes previous snapshot and trigger source.
3. Incremental prompt respects source limits.
4. Oversized incremental prompt fails before provider call.
5. Candidate refresh is skipped when there is no profile-worthy delta.
6. Manual full rebuild still uses full-history strategy.

Exit criteria:

* The system has basic guardrails against reintroducing full-history normal refresh.
* No AI-lab-style repeated model evaluation is required.

## Priority Classification

### Must Fix Before Closed Alpha

These are alpha-readiness blockers.

1. Snapshot prompt metrics and token estimates.
2. Incremental snapshot refresh as the default normal path.
3. Manual full rebuild separated from normal operation.
4. Hard budget for normal incremental snapshot prompts.
5. Minimal memory health/debug visibility.
6. Candidate refresh gating to reduce duplicate/noisy work.

### Can Happen During Closed Alpha

These are useful but should not block the first supervised alpha cohort if the main bloat is fixed.

1. More complete candidate review UX.
2. Better visual design for memory dashboard.
3. Better profile candidate grouping and filtering.
4. More refined snapshot diff display.
5. More detailed cost charts.
6. Manual memory editing UX.

### Defer Until Beta or Later

These are important but not needed to fix the current bottleneck.

1. Legal/data lifecycle:

   * export
   * delete
   * redaction
   * privacy review flows
2. Embedding retrieval.
3. Semantic memory ranking.
4. Advanced tutor customization of memory rules.
5. Public-facing audit/explainability UX.
6. Full eval harness.
7. Provider-specific prompt caching strategy.
8. Cross-student analytics.

## Recommended Code Touchpoints

Likely backend areas:

```text
packages/batch-backend/src/application/process-student-memory-snapshot-job.ts
packages/batch-backend/src/application/student-memory-snapshot-prompt.ts
packages/batch-backend/src/application/student-memory-snapshot-generation.ts
packages/batch-backend/src/application/request-student-memory-snapshot-refresh.ts
packages/batch-backend/src/application/process-student-profile-candidate-refresh-job.ts
packages/batch-backend/src/application/student-profile-candidates.ts
packages/batch-backend/src/domain/student-memory-snapshot-repository.ts
packages/batch-backend/src/domain/lesson-memory-repository.ts
packages/batch-backend/src/domain/homework-memory-repository.ts
packages/batch-backend/schema.sql
```

Likely frontend areas:

```text
packages/batch-frontend/src/utils/api.ts
packages/batch-frontend/src/ui/students/StudentLearningPage.tsx
packages/batch-frontend/src/ui/students/StudentLearningPage.test.tsx
packages/batch-frontend/src/ui/students/WorkspaceInspectionPanel.tsx
```

Add a separate internal/admin debug component only if the existing Learning/support details surface
becomes too noisy.

## Data Model Guidance

Prefer minimal schema changes for v1.1.

Decision for v1.1: use typed `generation_notes` first.

Pros:

* faster
* fewer migrations
* lower risk before alpha
* fits the existing snapshot record and inspection API shape

Cons:

* less queryable
* debug UI may need JSON parsing
* harder to index later

Deferred option: add explicit columns.

Potential columns for `student_memory_snapshots`:

```sql
strategy text;
parent_snapshot_id uuid;
trigger text;
trigger_source_kind text;
trigger_source_entry_id uuid;
input_token_estimate integer;
output_token_estimate integer;
prompt_byte_length integer;
included_lesson_memory_count integer;
included_homework_memory_count integer;
covered_lesson_memory_count integer;
covered_homework_memory_count integer;
material_change boolean;
```

Keep v1.1 data in `generation_notes`:

```json
{
  "coverage": {
    "includedLessonMemoryEntryIds": [],
    "includedHomeworkMemoryEntryIds": [],
    "coveredLessonMemoryEntryIds": [],
    "coveredHomeworkMemoryEntryIds": []
  },
  "promptMetrics": {
    "inputTokenEstimate": 0,
    "promptByteLength": 0
  },
  "candidateRefresh": {
    "requested": true,
    "reason": "profile_worthy_delta"
  }
}
```

Revisit explicit columns after Gate B if operators need cross-student filtering, cost reports, or
large-list sorting by these fields.

## Compatibility and Migration

Existing snapshots were created by the full-history v1 strategy.

Migration approach:

1. Treat existing ready snapshots as valid parent snapshots.
2. Mark missing strategy as `full_rebuild_v1`.
3. When first v1.1 incremental snapshot is created:

   * parent = latest ready v1 snapshot
   * strategy = `incremental_v1_1`
   * coverage = inherited/best-effort
4. Do not force full rebuild for all students.
5. Allow manual rebuild per student if a snapshot appears corrupted or stale.

This avoids a costly migration wave.

## Success Criteria

v1.1 is successful when:

1. Normal long-term snapshot refresh no longer sends full history.
2. Normal long-term snapshot refresh is usually around 15k–30k input tokens for active students.
3. A normal snapshot job cannot silently send ~120k input tokens.
4. Full rebuild remains possible but is explicit/manual.
5. Assignment generation behavior remains stable.
6. Lesson/homework memory behavior remains stable.
7. Profile candidate duplicates/noise drop materially.
8. Founder/operator can inspect memory health in the app.
9. Closed Alpha can begin without relying on OpenAI Platform logs to understand student-memory behavior.

## Resolved Implementation Defaults

1. Store strategy, metrics, coverage, and candidate-refresh decisions in typed `generation_notes`
   for v1.1. Defer explicit columns.
2. Skip duplicate/stale candidate inserts by default; record counts and reasons in metrics/logs.
   Add an audit/debug mode later only if needed.
3. Reuse the existing generation-budget token estimator; also record prompt byte length.
4. Bootstrap with latest 5 lesson memory entries and latest 3 homework memory entries.
5. CLI first, by extending the existing refresh tool with explicit strategy and reason. Add a
   guarded UI action after backend semantics are clear.
6. Use exact normalized content-hash equality for v1.1 material-change detection.
7. Gate candidate refresh after snapshot generation using trigger-source profile-worthiness plus
   exact personal-facts hash/material-change checks.

## Product Decisions To Review

1. Should operator-only memory support details live directly on Learning, behind a `<details>`
   disclosure, or on a separate internal route?
2. Should tutors ever see "memory stale" or "memory refresh failed" labels, or should those remain
   founder/operator support signals until Closed Alpha evidence says otherwise?
3. Should manual full rebuild be exposed in the app during Gate B, or kept CLI-only until Gate C?

## Implementation Warning

Do not “clean up” the stable assignment path as part of this work.

The assignment pipeline is already tuned and stable. Student Memory v1.1 should improve the internal long-term snapshot and memory observability layers without broad refactors to homework generation.

This is a surgical hardening slice, not a remodel.
