# Verification, Acceptance, and Assumptions

## Goals

1. Define the evidence required to call this upgrade implemented, not merely drafted.
2. Translate the phase-level decisions into concrete verification obligations.
3. Keep implementation assumptions explicit so future agents do not silently re-open settled
   contracts.

## Why This Doc Exists

The phase docs define what the student-memory system should be. This doc defines how we know it is
actually ready.

Passing unit tests alone is not sufficient for acceptance here. This upgrade changes:

1. canonical memory storage
2. retrieval behavior
3. prompt-package lineage
4. runtime generation inputs
5. operator trust and inspection workflows

Acceptance therefore requires both code-level verification and product-level evidence.

## Locked Decisions

1. Verification is cumulative across Phases 1 through 6; later phases do not waive earlier
   contracts.
2. Version 1 acceptance is based on a backend-orchestrated, deterministic, single-request runtime.
3. Canonical truth must live in the new memory artifacts and prompt-package lineage, not in legacy
   transcript-analysis fields.
4. Async lesson-memory, homework-memory, and snapshot generation are eventually consistent and must
   be verified as such; live homework generation must not depend on them completing first.
5. Acceptance includes provenance and inspection, not only successful generation.
6. Repair acceptance is based on replay/regenerate workflows from source truth, not manual editing
   of generated memory artifacts.
7. Rollout acceptance assumes direct cutover after verification, with rollback handled through
   normal release rollback rather than long-lived parallel runtime paths.
8. Repo-level docs and validation checks are part of acceptance, not optional cleanup.

## Verification Layers

The implementation should be verified in these layers:

1. schema and persistence
2. lesson-memory extraction
3. homework-memory extraction
4. student-memory snapshot generation and retrieval
5. prompt-package memory packaging and lineage
6. generation runtime behavior
7. read-only inspection and operational replay workflows
8. repo-wide checks and documentation integrity

## Verification Matrix

### 1. Schema and Persistence

Required verification:

1. repositories and persistence code can create and read canonical lesson-memory entries
2. repositories and persistence code can create and read canonical homework-memory entries
3. repositories and persistence code can create and read student-memory snapshots
4. append-only write behavior is covered
5. latest-ready and non-superseded retrieval behavior is covered
6. supersession behavior is covered
7. failed rows remain queryable for debugging and replay

Acceptance evidence:

1. schema/repository tests cover canonical writes and reads
2. tests prove status handling for `pending | ready | failed | superseded`
3. tests prove current-state queries do not rely on mutating old rows into new truth

### 2. Lesson-Memory Extraction

Required verification:

1. lesson memory can be built from a newly used transcript
2. lesson memory can be rebuilt for an edited historical lesson through replay
3. lesson memory can be backfilled historically
4. extraction uses the full lesson as the canonical analysis unit
5. teacher notes are included when available
6. student facts preserve authority tier and confidence
7. compact summary generation is covered without becoming the canonical payload

Acceptance evidence:

1. tests cover first-use generation, replay, and backfill paths
2. tests cover evidence-snippet handling where available
3. tests or fixtures demonstrate that noisy transcript artifacts are not blindly treated as learner
   mistakes
4. tests prove lesson-memory failure does not block current homework generation

### 3. Homework-Memory Extraction

Required verification:

1. homework memory is created only from canonical published markdown tied to successful publish
2. homework memory is generated asynchronously and does not downgrade publish success on failure
3. homework memory is regenerated only when canonical published content changes
4. multiple publish targets for the same content still resolve to one homework-memory content
   artifact
5. semantic extraction is covered for key homework regions before any optional LLM summarization

Acceptance evidence:

1. tests cover successful publish, failed memory extraction, replay, and changed-content refresh
2. tests prove unpublished drafts are not treated as canonical homework memory source
3. tests prove the artifact stores pedagogic targets and compact follow-up cues rather than full
   answer-key or full study-text payloads

### 4. Student-Memory Snapshot and Retrieval

Required verification:

1. snapshots are reproducible from ready lesson/homework memory artifacts
2. snapshots refresh when new lesson/homework memory becomes ready
3. retrieval remains deterministic in version 1
4. retrieval follows the locked default counts and current-lesson rules
5. unresolved issues are exposed explicitly

Acceptance evidence:

1. tests cover snapshot refresh and reproducible rollup generation
2. tests prove the current lesson is represented by the raw latest transcript, not duplicated as a
   lesson-memory entry in the same prompt package
3. tests prove fallback behavior when no snapshot is available
4. tests prove retrieval uses the locked version-1 policy rather than dynamic or agentic ranking

### 5. Prompt Package and Lineage

Required verification:

1. prompt packages include the locked memory layers
2. prompt packages persist exact memory provenance
3. missing memory context is represented explicitly
4. legacy lightweight lesson-history packaging is removed from the canonical path

Acceptance evidence:

1. prompt-package tests cover:
   - `studentMemorySnapshotId`
   - `studentMemorySnapshotHash`
   - `selectedLessonMemoryIds`
   - `selectedHomeworkMemoryIds`
   - `retrievalPolicyVersion`
2. tests prove provenance is snapshot data, not recomputed live after the fact
3. tests prove missing layers are explicit instead of silently omitted in a misleading way

### 6. Generation Runtime

Required verification:

1. runtime remains one prepared context package -> one provider request -> one reply
2. prompt assembly is stateless and block-structured
3. current homework generation can proceed even if async memory artifacts are still pending or
   missing
4. recent homework memory is prioritized correctly for avoiding repetition
5. runtime does not depend on provider-specific token caching for correctness

Acceptance evidence:

1. generation tests cover the new stateless context package behavior
2. tests prove generation does not block on lesson-memory or snapshot completion
3. tests prove the system prompt and assembly path no longer rely on fake prior-chat continuity

### 7. Inspection, Replay, and Rollout

Required verification:

1. operators can inspect memory outputs for a student
2. operators can inspect assignment-level prompt-package provenance
3. targeted replay for one student or source artifact is supported
4. failed artifacts can be regenerated from source truth
5. rollout evidence exists for sampled-student verification before cutover

Acceptance evidence:

1. read-only inspection surfaces expose:
   - recent lesson memory
   - recent homework memory
   - latest student-memory snapshot
   - assignment-level selected memory provenance on `GET /prompt-packages/:id`
2. replay tooling can repair failed rows without manual inline editing
3. rollout notes capture sampled verification before direct cutover

### 8. Repo-Wide Checks

Required verification:

1. repo checks remain green
2. docs/router surfaces remain coherent after the new docs and contracts land

Acceptance evidence:

1. `pnpm check:fast`
2. `pnpm docs:generate:indexes`
3. `pnpm docs:check`

## Acceptance Gates

The upgrade should be treated as accepted only when all of these gates are true:

1. Canonical artifact contracts are implemented in code and verified against append-only lifecycle
   rules.
2. Lesson memory works for new lessons, replayed historical lessons, and backfill.
3. Homework memory works from canonical published outputs only and has stable provenance.
4. Student-memory snapshots are reproducible, refreshable, and retrievable via the locked
   deterministic policy.
5. Prompt packages capture the exact memory state used during generation.
6. Generation runtime remains single-request, stateless, and non-agentic.
7. Read-only inspection and replay workflows exist for operator trust and repair.
8. Legacy `summary_json` transcript analysis is no longer treated as canonical truth.

## Non-Acceptance Conditions

The upgrade should not be considered complete if any of these are still true:

1. homework memory is sourced from unpublished drafts
2. current homework generation blocks on async memory extraction finishing first
3. inferred student facts can silently overwrite profile-grade truth
4. prompt packages cannot explain which memory was selected
5. rollout depends on long-lived feature flags or parallel prompt paths
6. repair requires manual hand-editing of generated memory rows
7. the live path still depends on the old lightweight lesson-history block as canonical behavior

## Assumptions

1. Runtime retrieval remains deterministic in version 1.
2. Prompt caching is optional and provider-specific, not a correctness requirement.
3. Existing student profile, prompt-package, and lineage systems remain the anchor for memory
   integration.
4. Legacy transcript analysis under `summary_json` is non-canonical once the new memory tables are
   live.
5. Batch-friendly async processing may be added later, but provider batch APIs are not required for
   initial correctness.
6. Rollback, if needed, happens through normal release/code rollback rather than by preserving
   multiple long-lived runtime prompt paths.
7. The expected release label for the eventual implementation is likely `release:minor` because
   this is a backward-compatible capability expansion rather than a deliberate breaking contract
   change.

## Exit Criteria

1. Evidence exists for every verification layer in this doc.
2. Every acceptance gate is satisfied.
3. No non-acceptance condition remains true.
4. Repo-wide checks are green.
5. The implementation agent can point to concrete tests, provenance surfaces, and replay workflows
   rather than relying on informal confidence.
