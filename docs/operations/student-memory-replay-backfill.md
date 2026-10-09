# Student Memory Replay and Backfill

## Meta

- Audience: operators and implementation agents maintaining the batch backend.
- Read Time: 5 minutes.
- Authority Level: active operations runbook.
- Last Verified Against: 2026-10-03 repo state (ESL-16 / GitHub #330).
- Owner: batch-backend maintainers + automation agents.
- Review Cadence: after student-memory tooling changes.
- Status: `active`.

## Purpose

- Explain how to replay canonical student-memory artifacts from source truth.
- Keep repair workflows backend-first and read-only with respect to generated memory rows.
- Document the homework-memory and student-memory snapshot tools that ship with the backend.
- Document the separately gated OpenAI Batch replay tool without authorizing its use.

## Core Rules

1. Repair generated student-memory artifacts by replaying from source truth.
2. Do not hand-edit lesson-memory, homework-memory, or snapshot rows in place.
3. Use `--dry-run` first when scoping a wider replay or backfill.
4. Use provider/model overrides only when intentionally re-running extraction on a different
   structured-output-capable model path.
5. Assignment-level provenance inspection remains on `GET /prompt-packages/:id`.
6. Compose-managed production must run `student-memory-worker`; `batch-worker` does not consume
   lesson-memory, homework-memory, or snapshot jobs.
7. OpenAI Batch replay is disabled by default and is not a deployment, target-model, or paid-call
   authorization.

## Evidence availability and continuity (ESL-38)

Existing verified observations are teaching evidence even when the originating assignment is
historical. Source proof and new execution admission are separate: historical extraction,
regeneration, initial enrichment and legacy Batch import remain blocked. Never infer missing
provenance or retrofit confirmed bindings to make old evidence eligible.

Snapshot selection and publication verify both lesson and homework contributors. Homework proof
requires a retained ready observation, its succeeded source job, the matching root publication
lineage and the same student throughout that lineage. Historical job format alone does not reject
this proof. Missing, foreign, deleted or superseded contributors make established history
repair-required; incremental refresh cannot carry that coverage forward. Explicit rebuild input
includes only eligible materialized homework observations, while inspection retains raw audit rows.

Memory overview/health, transcript progress and teaching context expose the shared aggregate
`availability`: `absent`, `available`, `repair_required`, or `repository_unavailable`, with a bounded
reason and lesson/homework reference counts. Stored status and pending/failed work are independent.
Counts describe referenced evidence, not complete history or learner mastery. Reads never enqueue
repair, verify by writing, or change stored status. MCP adds this field beside `context`; its closed
`mcp_teaching_context.v1` content and disclosure limits remain unchanged.

Genuine source invalidation conservatively rejects contaminated snapshots. New invalidations retain
`continuityReason: source_invalidated` in existing generation notes under the student lock; blocked
automatic refreshes retain `continuityReason: repair_required` on their failed intent. Old rows are
classified from retained successful-result output/history without backfilling guesses. Failed or
cancelled first intents alone do not establish history. Without an eligible parent, established
history blocks the normal five-lesson/three-homework bootstrap before generation and at publication.
A genuine first bootstrap remains bounded; an eligible-parent refresh remains incremental.

An explicitly requested `manual_rebuild_v1_1` or `full_rebuild_v1` with replay key and operator reason
uses all eligible materialized episodes and the existing currentness/cancellation/idempotency fences.
This capability does not authorize production invocation. Do not start automatic full-history
provider work, claim subtraction, learner scans, replay or reconciliation as part of rollout.

### Compatible application rollout and rollback

No table/data migration or new memory artifact schema is required. Preserve observations, reviewed
profiles/revisions, snapshots and frozen prompt-package bytes. The additive availability result is
backward compatible for existing consumers that ignore new fields; new frontend fields are optional
when reading older API responses. Use a minor release for the added public projection; no closed
MCP context-version change is needed.

For a separately authorized rollout, stop new refresh admission and quiesce **all old API and memory
worker writers**, including already active snapshot work, before enabling new admission. Do not mix
old/new workers: an old in-flight refresh could still publish a recent-only bootstrap. Retain queued
intents and cancellation/supersession evidence. New workers re-read the durable intent, frozen target,
source state and continuity before processing retained jobs; repair-required work becomes durably
blocked rather than generated. Coordinate API/worker replacement, then frontend, and restore normal
admission only with the compatible writer set. GET/health/MCP remain read-only throughout.

The corrected reader may immediately expose already verified stored snapshots without provider calls
or row rewrites. This is a read-policy correction, not reconstruction. Separately verify availability
and stored-versus-selectable status after deployment; provider-backed learner recovery needs a new
bounded approval/preflight. No production recovery is established by local fixtures.

Rollback must quiesce writers again and use a compatible API/worker set. Earlier readers hide
historical evidence again and earlier workers lack the continuity guard; do not resume their automatic
refresh processing for repair-required learners. Rollback never revives superseded/cancelled work or
clears repair notes. Preserve post-rollout writes and audit evidence; prefer forward repair if a safe
compatible writer set is unavailable. Batch retirement remains ABO-26, outside this change.

## Disabled OpenAI Batch Replay

Use the Batch tool only for explicit, non-urgent replay of eligible lesson evidence or native AssignmentV1 history after separate maintainer
authorization. It never replaces fresh online student-memory work.

```bash
pnpm --filter @esl-pipeline/batch-backend student-memory:batch -- dry-run \
  --workload lesson_memory --model <allowlisted-openai-model> --id <transcript-id>
```

- `dry-run` is local and writes neither database state nor provider requests.
- `submit --apply`, `status`, `poll`, `reconcile`, `retry --apply`, and `cancel --apply` require
  `STUDENT_MEMORY_OPENAI_BATCH_ENABLED=true`, an OpenAI API key, and an allowlisted model before
  any remote access. Do not enable that flag as part of normal deployment.
- Submit one workload/model slice at a time. Reconcile only terminal runs. The importer locks the
  item and claim, rechecks source freshness, writes the stable canonical destination, and marks the
  item imported in one database transaction.
- Unknown, duplicate, malformed, grounding-invalid, and stale results are terminal/audited. Only
  provider errors and incomplete work from an expired Batch may be retried after reconciliation.
- CLI output is safe diagnostics only: do not redirect envelopes, JSONL, raw source text, or raw
  provider output to durable local files.

## Production Worker Runtime

Production Compose includes a dedicated `student-memory-worker` service using the backend runtime
image and command:

```bash
node dist/transport/student-memory-worker.js
```

After deploying or replaying memory work on the VPS, collect bounded worker evidence:

```bash
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  ps student-memory-worker
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  logs --tail=120 student-memory-worker
```

If replay commands request work but the worker is absent or stopped, memory rows may remain pending
and the student workspace can look stale even though the replay command accepted the request.

### ESL-7 historical Batch cutover

Historical Markdown homework is read-only under ABO-30. Do not submit, retry, reconcile/import or
regenerate it. Before migration 0064, refresh every remotely submitted historical homework Batch
run with the updated tool's `status` or `poll` action, including rows already labelled `cancelled` or
`reconciled`. This is a separately authorized provider-status read plus local status/audit update.
It does not authorize paid generation or historical result import.

```bash
pnpm --filter @esl-pipeline/batch-backend student-memory:batch -- status --run-id <run-uuid>
```

Use the approved target DB/provider configuration with automatic migration disabled until quiescence
is verified. The existing Batch access gate still applies. Cancellation requests can return OpenAI
`cancelling` while requests remain in flight; the tool persists that as blocking `in_progress` and
reports the raw status. Poll until an actual terminal response is recorded. The audit stores
`remoteStatusConfirmation` with matching Batch id, raw status and observation time. Migration 0064
rejects a remotely submitted historical run without matching terminal evidence, even when its old
state says `cancelled`. A confirmed terminal response preserves `reconciled` bookkeeping; a
nonterminal refresh makes the run blocking again. Unknown statuses remain blocking.

## Homework Memory Replay

### Durable ordinary replay contract

Ordinary replay uses persisted memory intent, the existing BullMQ student-memory queue, normal
generation, a transactional canonical commit, and existing downstream delivery. Batch remains
separately gated pending the later ABO-26 retirement slice.

- Every operator run supplies `--replay-key <key>`. Keep the key when retrying/resubmitting the
  same intended run, including after an uncertain response. Identity is scoped to the assignment
  lineage for homework and the student for snapshots, and survives Redis retention and terminal
  intent state. A failed intent may resume with its original target. Completed, cancelled, or
  obsolete intent stays terminal; choose a new key for genuinely new regeneration.
- A new manual snapshot key supersedes older pending/failed manual replay for that student. New forced
  homework regeneration supersedes prior pending/failed intent for the same published job. Retry
  uses the original provider/model and snapshot strategy/reason/candidate policy, even if current
  configuration or command overrides differ. A new key can select a new explicit target.
- Snapshot completion locks the student and exact pending intent. Canonical ready-source changes,
  confirmed Source ownership changes, and snapshot writers share the student lock. Manual replay
  freezes the canonical source-set fingerprint and latest ready snapshot at intent creation;
  automatic refresh captures them before building its prompt. Both recheck before dispatch and
  commit. New relevant lesson/homework state, lost Source authority, a newer snapshot, cancellation,
  or supersession discards late output. Manual replay no longer overwrites newer valid state.
- Lesson publication/replacement and Source confirmation/reconfirmation acquire that student lock
  before transcript, binding, or memory-row locks. Homework retains its lineage job lock before
  the student and memory rows. Triggers enforce participation but cannot repair reversed application
  lock ordering. Migration `0061` is runtime-incompatible with previous writers: use the existing
  deploy quiescence and schema-compatible recovery procedure; image-only rollback is blocked.
- Snapshot canonical insertion, superseding prior ready state, and linking the pending intent to
  its result commit together. Duplicate completion returns that same result, preserving lineage,
  included/covered IDs, parent, prompt/source metadata, strategy, and ownership. Homework keeps its
  existing publication-sequence ordering and transactional canonical commit.
- Cancel by exact intent UUID using either tool with `--cancel-intent <uuid> --student-id <uuid>
--reason <reason>` (add `--dry-run` to inspect the request). Cancellation is durable on the original
  pending/failed row (`superseded`, `cancelledAt`, `cancellationReason`). It cannot undo an already
  committed result. Redis removal alone does not cancel work. Checks before dispatch and canonical
  commit fence an in-flight late response; provider execution or billing is not exactly once.
- The worker's existing five-second reconciliation tick checks at most 50 lesson/homework/snapshot
  deliveries, rotating by `deliveryCheckedAt`. It repairs committed intent without a queue job,
  including retained failed/completed BullMQ delivery, using the persisted provider/model. Linked
  canonical homework without downstream snapshot intent and explicitly requested snapshot
  candidate delivery in `pending`/`failed` state are recovered without regenerating canonical
  memory. Existing failed/cancelled downstream intent is not replaced automatically. Provider
  failures still use existing pacing/retries and terminal failure policy.
- Ready canonical lesson extraction with a missing `sourceEntryId` snapshot obligation is also
  discovered in bounded batches for saved no-homework sources and promoted finish evidence that
  still matches current authority. The shared student-locked ensure path converges scanner and
  direct-worker requests, reuses pending/fulfilled lineage, and respects failed/cancelled/obsolete/
  superseded obligations. A ready lesson retry repairs only this handoff; it never invokes the
  extraction provider again or changes ready extraction to failed. Completion of the tutor's
  transcript-only workflow preserves memory and eligible initial-enrichment admission. This repair
  does not authorize replay of unrelated historical ready sources or terminal extraction failures.
- Before recovered pending snapshot generation can enter BullMQ, reconciliation repairs the existing active
  Batch claim supersession prerequisite. A failed fence leaves delivery retryable and unqueued;
  a later Batch import cannot overwrite recovered ordinary output through an old active claim.
  The existing Batch fencing transaction locks items/claims before the student and exact intent,
  matching Batch import and ordinary completion ordering. It commits supersession only while that
  intent is still pending; otherwise it rolls back, including if completion raced the recovery
  selection. Redelivery of a completed intent preserves later Batch ownership and repairs downstream work.
- Failure marking merges failure-owned metadata into current database JSONB. Concurrently adopted
  replay identity, currentness, and delivery metadata survive, so same-key retry resumes the same
  intent and frozen provider/model target.

Inspect the original intent UUID and its `superseded_by_id` together with the linked result's
`generation_notes.pendingEntryId`. `obsoleteReason` records discarded replay. Use a new key only
after reviewing why the original attempt became obsolete. No new provider work is needed to
recover downstream delivery of an already current canonical result.

Homework memory is canonical only after publish succeeds, so replay operates from succeeded publish
jobs and the frozen native AssignmentV1 artifact. Historical Markdown jobs remain available for
inspection and export but cannot be replayed or regenerated.

Host-run command:

```bash
pnpm --filter @esl-pipeline/batch-backend exec tsx --tsconfig tsconfig.json src/tools/refresh-homework-memory.ts [options]
```

Production-container command:

```bash
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/refresh-homework-memory.js [options]
```

Supported options:

- `--dry-run`
- `--limit <n>`
- `--selection missing|failed|all`
- `--student-id <student-id>`
- `--job-id <job-id>`
- `--replay-key <key>` (required unless dry-run or cancellation)
- `--cancel-intent <pending-intent-uuid>` with `--student-id` and `--reason`
- `--provider openai|google_ai_studio|openrouter`
- `--model <model-id>`

Operator notes:

1. `missing` requests work only for succeeded publish jobs that do not yet have canonical homework
   memory.
2. `failed` and `all` force regeneration even when published markdown content has not changed.
3. Republishing to extra targets alone does not create a new canonical homework-memory content row.
4. Publish success is never downgraded by homework-memory replay failure.

Example:

```bash
pnpm --filter @esl-pipeline/batch-backend exec tsx --tsconfig tsconfig.json src/tools/refresh-homework-memory.ts --selection failed --student-id student_123 --dry-run
```

## Student-Memory Snapshot Replay

Snapshot replay rebuilds the student rollup from canonical ready lesson-memory and homework-memory
artifacts. Normal lesson/homework-triggered snapshot refresh is incremental; this tool is the
explicit manual rebuild/backfill path. During Gate B, manual full rebuild remains CLI-only; a
guarded operator app action is a possible Gate C follow-up, not current product behavior.

Host-run command:

```bash
pnpm --filter @esl-pipeline/batch-backend exec tsx --tsconfig tsconfig.json src/tools/refresh-student-memory-snapshots.ts [options]
```

Production-container command:

```bash
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/refresh-student-memory-snapshots.js [options]
```

Supported options:

- `--dry-run`
- `--limit <n>`
- `--selection missing|failed|all`
- `--student-id <student-id>`
- `--strategy manual_rebuild_v1_1|full_rebuild_v1`
- `--reason <operator-reason>` (required unless `--dry-run`)
- `--candidate-refresh` (explicitly request downstream profile-candidate refresh)
- `--replay-key <key>` (required unless dry-run or cancellation)
- `--cancel-intent <pending-intent-uuid>` with `--student-id` and `--reason`
- `--provider openai|google_ai_studio|openrouter`
- `--model <model-id>`

Operator notes:

1. `missing` includes students with no eligible ready snapshot and students whose latest eligible
   ready snapshot is older than newer canonical lesson/homework memory. A ready snapshot is
   eligible only when every lesson-memory ID exists, belongs to the same student, remains ready,
   and has confirmed-source provenance. Homework-only snapshots remain eligible.
2. Snapshot replay is eventually consistent and does not block prompt-package creation.
3. Snapshot replay only uses canonical ready lesson-memory and homework-memory inputs.
4. Non-dry-run replay must name the strategy and operator reason so manual rebuilds are auditable.
5. Prefer `manual_rebuild_v1_1` for v1.1 manual replay. Use `full_rebuild_v1` only for explicit
   legacy comparison or compatibility checks.
6. `--candidate-refresh` is opt-in. Use it only when the reviewed replay is also intended to
   refresh profile candidates from the resulting snapshot.
7. The CLI exits after its enqueue summary; snapshot and candidate processing remain asynchronous.
   Verify worker events and persisted outcomes separately before declaring recovery complete.

Example:

```bash
pnpm --filter @esl-pipeline/batch-backend exec tsx --tsconfig tsconfig.json src/tools/refresh-student-memory-snapshots.ts --selection missing --limit 20 --strategy manual_rebuild_v1_1 --reason "Backfill missing alpha snapshots" --replay-key alpha-snapshots-2026-10-03
```

### Snapshot eligibility repair recovery

Migration 0045 supersedes stored ready or pending snapshots that reference retired, missing,
cross-student, or provenance-free lesson memory. It does not enqueue model work. After deploying a
release that includes 0045, stop after each step and review its bounded output before continuing:

1. Confirm `batch-backend` and `student-memory-worker` are healthy and the migration head is 0045.
2. Run a dry-run with the exact limit approved for recovery:

   ```bash
   docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
     --env-file /var/lib/esl-pipeline/deploy/current-images.env \
     exec batch-backend node dist/tools/refresh-student-memory-snapshots.js \
     --selection missing --limit <approved-limit> --strategy manual_rebuild_v1_1 \
     --reason "Repair ineligible snapshots after migration 0045" --candidate-refresh --dry-run
   ```

3. Compare the selected student count with the pre-deploy read-only audit. Obtain explicit operator
   approval before removing `--dry-run`.
4. Execute the same bounded command without `--dry-run`, adding a stable `--replay-key`, only after
   that approval.
5. Verify each processed student has an eligible ready snapshot and candidate-refresh metadata with
   `enqueueStatus` equal to `enqueued` or `not_requested` for a documented policy reason.
6. Confirm `student_profile_candidate_refresh_requested` and a processed job event or persisted
   candidate outcome. `requested: true` by itself is not completion evidence.

If an eligible ready snapshot records requested candidate refresh but enqueue delivery is `pending`,
`failed`, or legacy metadata has no delivery state, retry only that explicit snapshot ID:

```bash
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  exec batch-backend node dist/tools/retry-student-profile-candidate-refresh.js \
  --snapshot-id <eligible-ready-snapshot-uuid>
```

The candidate-only command revalidates snapshot eligibility and recorded candidate intent. It does
not regenerate memory or infer candidate intent. Do not run either production command without a
reviewed scope and explicit operator authorization.

## Student Lesson Artifact Export

Use this host-run tool when you need a human-readable zip bundle for one student that includes:

- lesson transcripts
- lesson memory text exports
- homework memory text exports when available for the same lesson context
- readable `00-summary.txt` files per lesson plus a top-level `LESSON_INDEX.txt`

Host-run command:

```bash
pnpm --filter @esl-pipeline/batch-backend student-artifacts:export -- --student-id <student-id> [--out tmp/student-artifacts/<student-id>.zip]
```

Operator notes:

1. The tool loads `.env` and normalizes host Postgres access automatically for Linux
   host runs.
2. The export defaults to canonical ready lesson-memory and homework-memory artifacts only.
3. Homework memory that cannot be tied back to a transcript or recording is placed under an
   `unmatched-homework-memory/` folder in the zip instead of being dropped silently.

## Sampled Rollout Verification

Use this workflow after replay or before trusting a broader rollout on a few representative
students.

1. Open the student workspace and inspect the read-only student-memory section for:
   - latest ready snapshot summary
   - unresolved issues
   - recent lesson memory entries
   - recent homework memory entries
2. Inspect one recent assignment for the same student and confirm prompt-package memory provenance:
   - snapshot id used
   - selected lesson/homework memory ids
   - retrieval policy version
   - explicit layer availability markers
3. Compare the prompt-package lineage against the latest transcript and current student-memory
   overview.
4. If continuity looks stale:
   - correct source truth first when needed
   - run the targeted replay command with `--dry-run`
   - rerun without `--dry-run`
   - re-check the student workspace and prompt-package provenance

Verification rule:

1. The student workspace is the read-only inspection surface for current memory state.
2. `GET /prompt-packages/:id` and `GET /prompt-packages/:id/lineage` remain the canonical
   assignment-level provenance surfaces.
3. Replay should rebuild canonical artifacts from source truth rather than patching generated rows
   manually.

## Related

- [`docs/plans/student-memory-system-upgrade/README.md`](../plans/student-memory-system-upgrade/README.md)
- [`docs/backend-frontend/BATCH_SYSTEM.md`](../backend-frontend/BATCH_SYSTEM.md)
- [`packages/batch-backend/README.md`](../../packages/batch-backend/README.md)
