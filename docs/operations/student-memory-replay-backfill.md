# Student Memory Replay and Backfill

## Meta

- Audience: operators and implementation agents maintaining the batch backend.
- Read Time: 5 minutes.
- Authority Level: active operations runbook.
- Last Verified Against: 2026-03-21 repo state.
- Owner: batch-backend maintainers + automation agents.
- Review Cadence: after student-memory tooling changes.
- Status: `active`.

## Purpose

- Explain how to replay canonical student-memory artifacts from source truth.
- Keep repair workflows backend-first and read-only with respect to generated memory rows.
- Document the homework-memory and student-memory snapshot tools that ship with the backend.

## Core Rules

1. Repair generated student-memory artifacts by replaying from source truth.
2. Do not hand-edit lesson-memory, homework-memory, or snapshot rows in place.
3. Use `--dry-run` first when scoping a wider replay or backfill.
4. Use provider/model overrides only when intentionally re-running extraction on a different
   structured-output-capable model path.
5. Assignment-level provenance inspection remains on `GET /prompt-packages/:id`.

## Homework Memory Replay

Homework memory is canonical only after publish succeeds, so replay operates from succeeded publish
jobs and the canonical published markdown source.

Host-run command:

```bash
pnpm --filter @esl-pipeline/batch-backend exec tsx --tsconfig tsconfig.json src/tools/refresh-homework-memory.ts [options]
```

Supported options:

- `--dry-run`
- `--limit <n>`
- `--selection missing|failed|all`
- `--student-id <student-id>`
- `--job-id <job-id>`
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
artifacts.

Host-run command:

```bash
pnpm --filter @esl-pipeline/batch-backend exec tsx --tsconfig tsconfig.json src/tools/refresh-student-memory-snapshots.ts [options]
```

Supported options:

- `--dry-run`
- `--limit <n>`
- `--selection missing|failed|all`
- `--student-id <student-id>`
- `--provider openai|google_ai_studio|openrouter`
- `--model <model-id>`

Operator notes:

1. `missing` includes students with no ready snapshot and students whose latest ready snapshot is
   older than newer canonical lesson/homework memory.
2. Snapshot replay is eventually consistent and does not block prompt-package creation.
3. Snapshot replay only uses canonical ready lesson-memory and homework-memory inputs.

Example:

```bash
pnpm --filter @esl-pipeline/batch-backend exec tsx --tsconfig tsconfig.json src/tools/refresh-student-memory-snapshots.ts --selection missing --limit 20
```

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
