# Phase 6 - Frontend, Ops, Backfill, and Rollout

## Goals

1. Make the new memory system inspectable and operable.
2. Provide backfill and repair workflows for historical data.
3. Add verification and rollout guardrails before the new context package becomes the default path.

## Why This Phase Comes Last

The UI and operations layer should expose stable backend truth, not chase moving contracts.

By the time this phase starts, the backend should already support:

1. canonical lesson memory
2. canonical homework memory
3. student memory snapshots
4. prompt-package memory provenance

## Locked Decisions

1. Version 1 ships authenticated read-only inspection surfaces for student memory.
2. Version 1 includes a minimal read-only UI surface where it materially helps operator trust and
   debugging.
3. Version 1 does not include manual inline editing of lesson memory, homework memory, or student
   memory snapshots.
4. Repair in version 1 happens through replay/regenerate workflows, not through manual artifact
   editing.
5. Backfill and repair tooling should prioritize targeted operator-triggered workflows before full
   historical sweeps.
6. Rollout uses direct cutover after verification, not long-lived feature flags or shadow-mode
   prompt bifurcation.
7. Prompt-package provenance must be inspectable at the assignment level, not only as a student's
   current memory state.

## Frontend Direction

The student workspace should expose a minimal read-only memory inspection surface in version 1:

1. recent lesson memory entries
2. recent homework memory entries
3. latest student memory snapshot
4. prompt-package memory provenance for inspected assignments

Version 1 is read-only. Editing memory artifacts is a later product decision and is intentionally
out of scope here.

## Timeline and Provenance Direction

The student timeline and assignment inspection surfaces should expose events such as:

1. lesson memory refreshed
2. homework memory refreshed
3. student memory snapshot refreshed
4. prompt package created with selected memory ids

These are not required before the backend model is stable, but they become useful once operators
need to trust the system in production.

Assignment-level inspection should make it possible to answer:

1. which snapshot was used
2. which lesson/homework memory entries were selected
3. which retrieval policy version was applied
4. whether any expected memory layer was missing at generation time

## Ops and Tooling Direction

Required tools and workflows:

1. historical lesson-memory backfill
2. historical homework-memory backfill
3. student-memory snapshot refresh
4. targeted replay for one student
5. dry-run inspection modes
6. failure reporting

Targeting order:

1. first-class targeted replay for one student or one source artifact
2. bounded repair of failed rows
3. full historical sweeps after targeted workflows are proven trustworthy

Repair rule:

1. version 1 should regenerate canonical memory artifacts from source truth
2. version 1 should not support hand-editing generated memory in place
3. if a source artifact is wrong, operators should correct the source and replay generation

## Rollout Strategy

Locked rollout order:

1. build canonical artifacts without changing live prompt generation
2. verify outputs on sampled students and inspect assignment-level provenance
3. replace the old prompt-context path with the new memory-aware package in one direct cutover
4. monitor generation quality, prompt size, and repair needs

Rollout rule:

1. version 1 does not add long-lived feature flags or shadow prompt flows just for this migration
2. if the cutover proves unacceptable, rollback happens operationally through normal code/version
   rollback rather than by preserving parallel runtime prompt paths

## Documentation Updates Expected In or After This Phase

1. backend/frontend alignment status
2. batch-backend SSOT if service boundaries change
3. package READMEs if runtime surfaces expand
4. operational runbooks for backfill or repair tooling
5. prompt-template docs if the canonical system prompt changes materially

## Exit Criteria

1. Operators can inspect memory outputs for one student.
2. Historical data can be backfilled and repaired.
3. Prompt-package provenance exposes memory state clearly enough for debugging.
4. Assignment inspection surfaces expose exact memory selection used during generation.
5. Rollout path is documented and reversible via normal release rollback.
