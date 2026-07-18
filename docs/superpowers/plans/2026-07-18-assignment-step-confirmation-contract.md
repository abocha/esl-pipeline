# Assignment Step Confirmation Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every assignment step advance only after its semantic decision is durably confirmed, while automatically preserving recoverable edits, preventing stale-tab overwrites, and making Share retry-safe without asking tutors to manage Save or Refresh actions.

**Architecture:** Hard-cut pre-existing assignment sessions, drafts, and prompt packages, then replace the workflow with a revisioned aggregate containing separate working/recovery and confirmed snapshots. Resume and active/completed presentation derive from `confirmedStep` plus earliest dirty recovery; no stage or archive state is persisted. Transcript/draft autosaves use content-addressed recovery blobs and working-version CAS. Source confirmation copies the exact server URI/hash/version tuple into the session and automatically drives hash-keyed lesson memory from that immutable URI. Share reserves one stable job in the existing jobs table and reconciles/retries that same job identity through existing database and BullMQ state.

**Tech Stack:** TypeScript 6, Node.js 24, pnpm workspaces, Fastify, PostgreSQL, BullMQ, React 19, Vite, Vitest, Testing Library, Zod, existing filesystem/S3 transcription storage adapters.

## Global Constraints

- Follow the approved design in `docs/superpowers/specs/2026-07-18-assignment-step-confirmation-contract-design.md`.
- Treat deployment as a hard closed-alpha cutover: delete every pre-cutover assignment session,
  draft, and prompt package in that order, and provide no legacy resume, repair, hydration, or
  payload compatibility.
- Preserve completed jobs, handouts, published URLs, and their required artifacts as read-only
  history; pre-cutover editor artifacts cannot enter a new assignment lineage.
- Every new transcript and draft starts with working version `1`, a server hash, and a
  content-addressed recovery object. Never initialize a historical artifact on first edit.
- Tutor actions own semantic confirmation; automatic persistence owns recovery, retry, and freshness.
- Do not add routine `Save`, `Refresh`, or `Reload` controls. Expose `Retry` only after bounded automatic retry fails.
- Navigation alone must not confirm, invalidate, or advance durable workflow state.
- Preserve local input across revision conflicts and show the newest server state before asking the tutor to reconcile.
- Treat `AssignmentSessionDto.confirmed` as a validated public contract, not an open JSON extension point.
- Every session recovery write, confirmation, Share reservation, and Share completion uses
  compare-and-swap revision semantics.
- Do not persist `currentStage` or session archival. Derive resume/completion from `confirmedStep`,
  durable dirty recovery, and the linked job.
- Retain `confirmedStep` as the atomically maintained scalar for workflow queries, resumable-session
  filtering, completion checks, and frontend status; do not repeatedly infer it from snapshot JSON.
- Transcript/draft autosaves CAS a working version. Source/Create snapshots copy the confirmed
  content-addressed URI, server hash, and working version; never overwrite such an object.
- Do not build recovery-object garbage collection in this issue; unreachable content-addressed
  blobs are acceptable closed-alpha residue.
- The server computes content hashes and validates artifact ownership and lineage; clients echo only
  server-issued working versions, while confirmation responses supply the server-owned immutable
  URI/hash/version tuple.
- Existing shared handouts remain immutable history. Invalidation only clears the active session lineage.
- Share success means one stable approved job is durably linked and enqueued or already
  running/succeeded. Confirmed Share is completed; there is no archival cleanup. A terminal worker
  failure retries the same job identity through a focused reset/re-enqueue operation.
- Treat `confirmedStep = 'share'` as the canonical completed predicate in active lookups, recent
  counts, create-or-reuse, uniqueness, lesson/business dashboards, and frontend resume. Do not add a
  second completion flag.
- Lesson memory accepts only the confirmed Source URI/hash, keys durable intent and BullMQ identity
  by transcript plus confirmed hash, and never reloads mutable `transcripts.storage_uri` in a worker.
  Unconfirmed autosaves do not affect memory; every changed confirmed hash regenerates automatically.
- Supersede old current lesson memory and any student-memory snapshot that could expose it when a new
  source hash is confirmed. Treat the memory layer as refreshing/unavailable until replacement
  succeeds, then refresh downstream snapshots automatically.
- Share retry keeps the database job ID and BullMQ job ID stable. Do not create an attempt ledger or
  a rerun child; intentional reruns remain unchanged child jobs with `source_job_id` lineage.
- Guard route/browser navigation only for unrecovered local changes or ambiguous mutation outcome,
  never merely because durable recovery is unconfirmed.
- Refresh stable data only on load, focus return, or directly related mutation completion;
  poll only genuinely asynchronous recording/job states.
- Remove the old assignment-session create/PATCH routes and revisionless transcript/draft update contracts in the same major release.
- Keep code, `packages/batch-backend/README.md`, `packages/batch-frontend/README.md`, and backend/frontend alignment docs synchronized.
- Use the existing `:agent` validation lanes where available and inspect their log artifacts before widening a failed run.

---

## Locked External Review Cadence

Implementation proceeds inline, but the following review gates are blocking. Do not begin work past
a gate until its review is complete, every valid finding is fixed inline by the primary agent, and
the affected validation has been rerun successfully.

| Gate | Trigger       | Required review scope                                                                                                                                          |
| ---- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | After Task 1  | Public contracts, migration safety, cutover deletion order, schema constraints, and release versions                                                           |
| 2    | After Task 4  | Tasks 2-4 together: artifact CAS, session CAS, confirmation atomicity, lesson-memory authority, supersession, and cross-tab races                              |
| 3    | After Task 6  | Tasks 5-6 together: confirmed downstream inputs, stable Share identity, BullMQ reconciliation, terminal retry, and rerun separation                            |
| 4    | After Task 9  | Tasks 7-9 together: frontend confirmation state, automatic recovery, derived resume, navigation protection, refresh limits, and completed-session presentation |
| 5    | After Task 10 | Complete branch diff against the approved specification and plan, including docs, migration baseline, contract versions, and all validation evidence           |

Every gate uses a **new instance** of `@sol_reviewer`; never reuse a reviewer instance from an
earlier gate. Request the `gpt-5.6-sol` model with high reasoning when the runtime supports that
override. Give the reviewer the approved specification, this plan, the gate's exact diff/commits, and
the test/check evidence. The reviewer is read-only and reports concrete correctness gaps,
inconsistencies, missing tests, or unjustified scope.

The primary agent owns disposition: verify each finding against the live code and contracts, reject
invalid findings with evidence, fix valid findings inline, and rerun the smallest sufficient focused
checks plus any gate-level check affected by the fix. A follow-up is optional rather than automatic:
request it only when the fixes
materially change the reviewed behavior or leave a correctness question that needs reviewer
confirmation. When needed, send the follow-up to the **same reviewer instance that opened that
gate**, so it can verify its findings against the fixes with full context. Record the reviewer
verdict, finding dispositions, fixes, and fresh validation in the execution handoff. Do not defer
valid findings to a later gate merely because the current task's tests pass.

No reviewer is spawned while preparing or approving this cadence. The first reviewer is created only
after Task 1 implementation and validation are complete.

---

## Planned File Structure

### Public contracts and versioning

- Modify: `packages/contracts/src/index.ts` - confirmed snapshot, working-content, recovery, confirmation, Share, and conflict DTOs.
- Modify: `packages/contracts/src/contract-versions.ts` - API major bump, DB minor bump, and migration head.
- Create: `packages/batch-backend/tests/contracts.assignment-confirmation-version.test.ts` - exact API version assertion.
- Modify: `packages/batch-backend/tests/contracts.db-contract-version.test.ts` - exact DB version and head assertions.

### Database and backend domain

- Create: `packages/batch-backend/migrations/0044_assignment_step_confirmation_contract.sql` - hard cutover, derived-stage removal, session confirmation/Share linkage, and artifact working CAS.
- Modify: `packages/batch-backend/schema.sql` - regenerated schema baseline.
- Modify: `packages/batch-backend/src/domain/assignment-session-model.ts` - working/confirmed aggregate model.
- Modify: `packages/batch-backend/src/domain/assignment-session-repository.ts` - revision-aware recovery, confirmation, and stable Share linkage.
- Modify: `packages/batch-backend/src/domain/transcript-model.ts` - working-version/hash fields.
- Modify: `packages/batch-backend/src/domain/transcript-repository.ts` - transcript working CAS and transactional confirmation read.
- Modify: `packages/batch-backend/src/domain/draft-model.ts` - working-version/hash fields.
- Modify: `packages/batch-backend/src/domain/draft-repository.ts` - draft working CAS and transactional confirmation read.
- Modify: `packages/batch-backend/src/domain/lesson-memory-model.ts` - confirmed source URI/hash provenance.
- Modify: `packages/batch-backend/src/domain/lesson-memory-repository.ts` - transcript-hash idempotency, supersession, and current queries.
- Modify: `packages/batch-backend/src/domain/student-memory-snapshot-repository.ts` - invalidate snapshots that could expose superseded lesson memory.
- Modify: `packages/batch-backend/src/domain/job-repository.ts` - guarded terminal failed Share reset under the same job identity.
- Modify: `packages/batch-backend/src/infrastructure/transcription-storage.ts` - content-addressed transcript/draft recovery keys.

### Backend application and transport

- Modify: `packages/batch-backend/src/application/assignment-sessions.ts` - student confirmation and recovery commands.
- Create: `packages/batch-backend/src/application/confirm-assignment-session-step.ts` - Source, Context, and Create validation/invalidation.
- Create: `packages/batch-backend/src/application/share-assignment-session.ts` - stable job-backed Share orchestration and terminal completion.
- Modify: `packages/batch-backend/src/application/update-recording-transcript.ts` - transcript working-version CAS.
- Modify: `packages/batch-backend/src/application/update-draft.ts` - draft working-version CAS.
- Modify: `packages/batch-backend/src/application/process-transcribe-job.ts` - initial transcript working content.
- Modify: `packages/batch-backend/src/application/ingest-manual-transcript-source.ts` - initial manual transcript working content.
- Modify: `packages/batch-backend/src/application/create-draft.ts` - initial draft working content.
- Modify: `packages/batch-backend/src/application/create-prompt-package.ts` - exact confirmed transcript/profile inputs.
- Modify: `packages/batch-backend/src/application/request-lesson-memory-generation.ts` - confirmed URI/hash intent and stable hash-keyed enqueue.
- Modify: `packages/batch-backend/src/application/process-lesson-memory-job.ts` - direct confirmed URI read, hash verification, and conditional publish.
- Delete: `packages/batch-backend/src/application/request-confirmed-lesson-memory.ts` - remove the redundant standalone confirmation service.
- Modify: `packages/batch-backend/src/application/generate-draft.ts` - remove unconfirmed lesson-memory fallback generation.
- Modify: `packages/batch-backend/src/application/student-memory-package.ts` - exclude superseded A while replacement B is unavailable.
- Modify: `packages/batch-backend/src/application/student-schedule-billing.ts` - active-session predicate and session-owned draft-in-progress status.
- Modify: `packages/batch-backend/src/application/teacher-business-dashboard.ts` - same canonical lifecycle/status projection.
- Modify: `packages/batch-backend/src/application/create-approval-job.ts` - stable job ID and transactional reservation support.
- Modify: `packages/batch-backend/src/application/approve-job.ts` - retry-aware enqueue of the stable reserved job.
- Modify: `packages/batch-backend/src/infrastructure/queue-bullmq.ts` - inspect and retry a retained failed BullMQ job in place.
- Modify: `packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts` - student, recovery, confirm, and terminal Share routes.
- Modify: `packages/batch-backend/src/transport/extended-routes/recordings-routes.ts` - revision-aware transcript, draft, and prompt-package requests.
- Modify: `packages/batch-backend/src/transport/extended-routes/students-routes.ts` - remove the separate manual lesson-memory confirmation route.

### Frontend API and workflow

- Modify: `packages/batch-frontend/src/utils/api.ts` - new session commands and artifact working-CAS request/response shapes.
- Create: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.confirmation.ts` - pure confirmation, dirty-state, resume, and conflict decisions.
- Create: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.confirmation.test.ts` - exhaustive pure contract tests.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx` - session revision coordinator, confirmation actions, route guard, and global save state.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.source.ts` - automatic Source recovery and confirmation flush.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.authoring.ts` - Context/Create recovery and confirmation flush, Share orchestration.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume.ts` - earliest-dirty hydration and completed-Share job routing.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-presentation.ts` - derived resume/completed presentation.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.entry-state.ts` - derived session presentation without persisted stage.
- Modify: `packages/batch-frontend/src/ui/assignments/assignment-workflow.ts` - confirmed-step status derivation.
- Modify: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.tsx` - saving/confirmed/conflict presentation without manual Save/Refresh.
- Modify: `packages/batch-frontend/src/dev/frontend-sandbox-api.ts` - sandbox parity for revisioned APIs.

### Tests and documentation

- Modify: `packages/batch-backend/tests/domain.assignment-session-repository.test.ts`.
- Modify: `packages/batch-backend/tests/domain.transcript-repository.test.ts`.
- Modify: `packages/batch-backend/tests/application.recording-transcript.test.ts`.
- Modify: `packages/batch-backend/tests/application.draft.test.ts`.
- Modify: `packages/batch-backend/tests/application.process-transcribe-job.test.ts`.
- Modify: `packages/batch-backend/tests/application.ingest-manual-transcript-source.test.ts`.
- Modify: `packages/batch-backend/tests/transport.http-server.integration.recordings-prompt-packages.test.ts`.
- Create: `packages/batch-backend/tests/application.assignment-step-confirmation.test.ts`.
- Create: `packages/batch-backend/tests/application.assignment-share.test.ts`.
- Modify: `packages/batch-backend/tests/application.student-schedule-billing.test.ts`.
- Modify: `packages/batch-backend/tests/transport.http-server.integration.business.test.ts`.
- Modify: `packages/batch-backend/tests/application.request-lesson-memory-generation.test.ts`.
- Modify: `packages/batch-backend/tests/application.process-lesson-memory-job.test.ts`.
- Delete: `packages/batch-backend/tests/application.request-confirmed-lesson-memory.test.ts`.
- Modify: `packages/batch-backend/tests/application.student-memory-package.test.ts`.
- Modify: `packages/batch-backend/tests/domain.lesson-memory-repository.test.ts`.
- Modify: `packages/batch-backend/tests/infrastructure.queue-bullmq.test.ts`.
- Create: `packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts`.
- Modify: `packages/batch-backend/tests/transport.http-server.integration.students-memory.test.ts`.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.test-harness.tsx`.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx`.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx`.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-presentation.test.ts`.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.entry-state.test.ts`.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx`.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx`.
- Modify: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.navigation.test.tsx`.
- Modify: `packages/batch-frontend/src/ui/assignments/assignment-workflow.test.ts`.
- Modify: `packages/batch-frontend/src/utils/api.student-memory.test.ts`.
- Modify: `packages/batch-frontend/src/dev/frontend-sandbox-api.test.ts`.
- Modify: `packages/batch-backend/README.md`.
- Modify: `packages/batch-frontend/README.md`.
- Modify: `docs/backend-frontend/backend-frontend-alignment.md`.

---

## Task 1: Publish the hard-cutover revision contract and migration

**Files:**

- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contract-versions.ts`
- Create: `packages/batch-backend/tests/contracts.assignment-confirmation-version.test.ts`
- Modify: `packages/batch-backend/tests/contracts.db-contract-version.test.ts`
- Create: `packages/batch-backend/migrations/0044_assignment_step_confirmation_contract.sql`
- Modify: `packages/batch-backend/tests/integration.migrations.test.ts`
- Modify: `packages/batch-backend/tests/domain.assignment-session-repository.test.ts`

- [x] **Step 1: Write failing contract-version and migration tests**

Add exact assertions for API `4.0.0`, DB `0.23.0`, and migration head
`0044_assignment_step_confirmation_contract`. Seed active and archived pre-cutover sessions, an
unfinished prompt package/draft with no job, and a completed job/handout plus homework-memory entry
whose markdown reads from the job's `md_storage_uri`. Assert the migration removes every session,
draft, and prompt package; retains the completed job, URL, rerun lineage, homework-memory entry, and
storage URI; and leaves historical transcripts uninitialized for editing.

```ts
expect(API_CONTRACT_VERSION).toBe('4.0.0');
expect(DB_CONTRACT_VERSION).toBe('0.23.0');
expect(DB_MIGRATION_HEAD).toBe('0044_assignment_step_confirmation_contract');

expect(await countRows('assignment_sessions')).toBe(0);
expect(await countRows('drafts')).toBe(0);
expect(await countRows('prompt_packages')).toBe(0);
expect(await findJob(completedJobId)).toMatchObject({ html_url: publishedUrl });
expect((await findTranscript(historicalTranscriptId)).working_version).toBeNull();
expect(await readHomeworkMarkdown(homeworkMemoryEntryId)).toBe(historicalMarkdown);
```

- [x] **Step 2: Run the focused tests and verify the expected failure**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/contracts.assignment-confirmation-version.test.ts tests/contracts.db-contract-version.test.ts tests/integration.migrations.test.ts tests/domain.assignment-session-repository.test.ts
```

Expected: version assertions report the current `3.1.0`/`0.22.0`/`0043` values and migration fixtures fail because the new columns do not exist.

- [x] **Step 3: Add the exact contract types**

Add the approved discriminated contracts to `packages/contracts/src/index.ts`:

```ts
export type AssignmentConfirmedStep = 'student' | 'source' | 'context' | 'create' | 'share';

export type AssignmentInvalidatedArtifact = 'transcript' | 'prompt' | 'draft' | 'preview';

export interface ArtifactWorkingContentDto {
  workingVersion: number;
  contentHash: string;
}

export interface AssignmentConfirmedSnapshot {
  student: { studentId: string };
  source: {
    lessonId: string | null;
    recordingId: string;
    transcriptId: string;
    transcriptWorkingVersion: number;
    transcriptStorageUri: string;
    transcriptHash: string;
  } | null;
  context: {
    teacherNotes: string | null;
    profileId: string | null;
    profileRevisionId: string | null;
    profileRevisionHash: string | null;
  } | null;
  create: {
    promptPackageId: string;
    draftId: string;
    draftWorkingVersion: number;
    draftStorageUri: string;
    draftHash: string;
  } | null;
}

export interface UpdateAssignmentSessionRecoveryRequest {
  expectedRevision: number;
  patch: Partial<{
    lessonId: string | null;
    recordingId: string | null;
    transcriptId: string | null;
    promptPackageId: string | null;
    draftId: string | null;
    publishTarget: PublishTarget | null;
    selectedTtsProvider: TtsProviderId | null;
    selectedTtsStrategy: TtsStrategy | null;
    selectedTtsModel: string | null;
    selectedPreset: string | null;
    selectedGenerationProvider: GenerationProvider | null;
    selectedGenerationModel: string | null;
    teacherNotes: string | null;
    selectedProfileId: string | null;
    selectedProfileRevisionId: string | null;
    selectedProfileRevisionHash: string | null;
  }>;
}

export type ConfirmAssignmentSessionStepRequest =
  | {
      step: 'source';
      expectedRevision: number;
      lessonId: string | null;
      recordingId: string;
      transcriptId: string;
      transcriptWorkingVersion: number;
    }
  | {
      step: 'context';
      expectedRevision: number;
      teacherNotes: string | null;
      profileId: string | null;
      profileRevisionId: string | null;
      profileRevisionHash: string | null;
    }
  | {
      step: 'create';
      expectedRevision: number;
      promptPackageId: string;
      draftId: string;
      draftWorkingVersion: number;
    };
```

Remove the persisted `AssignmentSessionStage` contract. Replace the old session DTO with `revision`,
non-null `confirmedStep`, `confirmed`, selected-profile recovery fields, and nullable
`shareJobId`; do not include `currentStage` or `archivedAt`. Define
`ConfirmStudentAssignmentSessionRequest`, `ConfirmAssignmentSessionStepResponse`,
`ConfirmAssignmentSessionShareRequest`, `ConfirmAssignmentSessionShareResponse { session; job }`,
and conflict responses containing the latest session or working artifact.

- [x] **Step 4: Add the migration and version bump**

Create the migration with:

- while API and workers are stopped, delete in exact order: `assignment_sessions`, then `drafts`,
  then `prompt_packages`;
- rely on existing `homework_memory_entries` `ON DELETE SET NULL` artifact links; do not delete jobs,
  homework-memory entries, handout URLs, job `md_storage_uri` values, rerun lineage, or any storage
  object;
- drop `assignment_sessions.current_stage` and `assignment_sessions.archived_at` plus their stage/active indexes;
- session `revision`, non-null `confirmed_step`, validated `confirmed_snapshot`, `creation_request_id`, selected profile revision fields, and `share_job_id`;
- nullable `working_version` and `content_hash` on transcripts so retained historical rows remain
  readable, and non-null CAS fields on every new draft row created after the cutover;
- `lesson_memory_entries.source_storage_uri` and `source_content_hash`, plus a unique idempotency key
  on `(transcript_id, source_content_hash)`; do not add transcript/draft content-revision tables;
- foreign key and uniqueness constraints for the session's one stable `share_job_id`, with no Share-attempt table;
- a partial unique index on `(user_id, creation_request_id)` where the request ID is non-null;
- active user/recording, user/recent, and lesson/recent partial indexes using
  `confirmed_step <> 'share'` rather than `archived_at IS NULL`.

Do not add an empty-session default. Student confirmation is the sole insert path and writes
`confirmed_step = 'student'` plus the non-null Student snapshot in that insert.

Add check constraints for `revision > 0`, working versions greater than zero when present, paired working-version/hash nullability, confirmed-step values, and 64-character lowercase SHA-256 hashes. Make `share_job_id` a unique job foreign key; the Share request UUID is the job ID, so no separate Share request column is stored.

- [x] **Step 5: Run migration and contract tests**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/contracts.assignment-confirmation-version.test.ts tests/contracts.db-contract-version.test.ts tests/integration.migrations.test.ts tests/domain.assignment-session-repository.test.ts
```

Expected: all focused tests pass, including total session/editor-artifact cutover, preserved
completed outputs and homework-memory markdown reads, the hash-keyed lesson-memory constraint, and
new active indexes that exclude confirmed Share.

- [x] **Step 6: Commit the contract boundary**

```bash
git add packages/contracts/src/index.ts packages/contracts/src/contract-versions.ts packages/batch-backend/tests/contracts.assignment-confirmation-version.test.ts packages/batch-backend/tests/contracts.db-contract-version.test.ts packages/batch-backend/migrations/0044_assignment_step_confirmation_contract.sql packages/batch-backend/tests/integration.migrations.test.ts packages/batch-backend/tests/domain.assignment-session-repository.test.ts
git commit -m "feat(contracts): add assignment confirmation contract"
```

## Task 2: Make working content content-addressed and CAS-safe

**Files:**

- Modify: `packages/batch-backend/src/domain/transcript-model.ts`
- Modify: `packages/batch-backend/src/domain/transcript-repository.ts`
- Modify: `packages/batch-backend/src/domain/draft-model.ts`
- Modify: `packages/batch-backend/src/domain/draft-repository.ts`
- Modify: `packages/batch-backend/src/infrastructure/transcription-storage.ts`
- Modify: `packages/batch-backend/src/application/process-transcribe-job.ts`
- Modify: `packages/batch-backend/src/application/ingest-manual-transcript-source.ts`
- Modify: `packages/batch-backend/src/application/create-draft.ts`
- Modify: `packages/batch-backend/src/application/update-recording-transcript.ts`
- Modify: `packages/batch-backend/src/application/update-draft.ts`
- Modify: `packages/batch-backend/src/transport/extended-routes/recordings-routes.ts`
- Modify: `packages/batch-backend/tests/domain.transcript-repository.test.ts`
- Modify: `packages/batch-backend/tests/infrastructure.transcription-storage.test.ts`
- Modify: `packages/batch-backend/tests/application.recording-transcript.test.ts`
- Modify: `packages/batch-backend/tests/application.draft.test.ts`
- Modify: `packages/batch-backend/tests/application.process-transcribe-job.test.ts`
- Modify: `packages/batch-backend/tests/application.ingest-manual-transcript-source.test.ts`
- Modify: `packages/batch-backend/tests/transport.http-server.integration.recordings-prompt-packages.test.ts`

- [ ] **Step 1: Write failing content-addressing and working-CAS tests**

Cover these cases for both transcript and draft content:

1. generated/manual transcripts and created drafts start at working version `1` with a server hash;
2. autosave writes a content-addressed object and advances only the mutable working pointer/version;
3. stale expected working version returns a typed conflict and preserves the winning pointer;
4. later autosaves leave every earlier content-addressed URI readable and unchanged;
5. cache reuse selects only content that already satisfies the new working-version/hash invariant.

```ts
const draft = await createDraft({ promptPackageId, text: 'first', userId });
expect(draft.workingVersion).toBe(1);
const firstUri = draft.storageUri;
const second = await updateDraft({
  id: draft.id,
  text: 'second',
  expectedWorkingVersion: 1,
});

await expect(
  updateDraft({ id: draft.id, text: 'stale', expectedWorkingVersion: 1 }),
).rejects.toMatchObject({ code: 'ARTIFACT_WORKING_CONFLICT', latest: second });
expect(second.storageUri).not.toBe(firstUri);
expect(await storage.getText(firstUri)).toBe('first');
expect(await storage.getText(second.storageUri)).toBe('second');
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/domain.transcript-repository.test.ts tests/infrastructure.transcription-storage.test.ts tests/application.recording-transcript.test.ts tests/application.draft.test.ts tests/application.process-transcribe-job.test.ts tests/application.ingest-manual-transcript-source.test.ts tests/transport.http-server.integration.recordings-prompt-packages.test.ts
```

Expected: tests fail because artifacts expose no working version/hash, storage overwrites stable keys,
and repository updates do not compare the expected working version.

- [ ] **Step 3: Make recovery objects content-addressed**

Keep artifact-specific write inputs but require a hash in every result:

```ts
export interface PutTranscriptOptions {
  transcriptId: string;
  text: string;
}

export interface PutDraftOptions {
  draftId: string;
  text: string;
}

export interface StorageWriteResult {
  uri: string;
  bytes: number;
  sha256: string;
}
```

Compute SHA-256 before writing. Filesystem and S3 keys are
`transcripts/<transcriptId>/content/<sha256>.txt` and
`drafts/<draftId>/content/<sha256>.md`. Writing the same content is idempotent; no save overwrites a
different object.

- [ ] **Step 4: Implement artifact-specific working CAS**

Add `workingVersion` and `contentHash` to `TranscriptRecord` and `DraftRecord`. Replace unconditional
storage-pointer updates with artifact-specific conditional functions:

```ts
export async function updateTranscriptWorkingContent(params: {
  id: string;
  expectedWorkingVersion: number;
  storageUri: string;
  contentHash: string;
}): Promise<TranscriptRecord>;

export async function updateDraftWorkingContent(params: {
  id: string;
  expectedWorkingVersion: number;
  storageUri: string;
  contentHash: string;
}): Promise<DraftRecord>;
```

Working updates condition on `working_version = expectedWorkingVersion`, increment once, and return
the winning working DTO. A stale or non-editable row throws `ArtifactWorkingConflictError` with the
latest DTO. Add client-aware `FOR UPDATE`
lookups for transcript/draft confirmation; they return the locked artifact row and create no
secondary content record.

- [ ] **Step 5: Update application and transport contracts**

Generated transcription, manual transcript ingestion, and draft creation write content-addressed
storage and insert the parent with `working_version = 1` plus the server hash. If database
persistence fails after storage succeeds, the object is unreachable and remains harmless
closed-alpha residue; this issue adds no cleanup service.

Cached-recording reuse accepts only a transcript that satisfies the new working-version/hash
invariant. The clone gets a new transcript ID and content-addressed working object at version `1`.

`PUT /recordings/:recordingId/transcript` and `PUT /drafts/:id` require
`expectedWorkingVersion: number`. Each writes the content-addressed object, CAS-swaps the working
pointer, and returns `{ workingVersion, contentHash }`. Remove revisionless update acceptance and
return HTTP 409 with the latest working DTO on conflict.

- [ ] **Step 6: Run the focused tests and typecheck**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/domain.transcript-repository.test.ts tests/infrastructure.transcription-storage.test.ts tests/application.recording-transcript.test.ts tests/application.draft.test.ts tests/application.process-transcribe-job.test.ts tests/application.ingest-manual-transcript-source.test.ts tests/transport.http-server.integration.recordings-prompt-packages.test.ts
pnpm --filter @esl-pipeline/batch-backend typecheck
```

Expected: all focused tests and backend typecheck pass.

- [ ] **Step 7: Commit content-addressed working CAS**

```bash
git add packages/batch-backend/src/domain/transcript-model.ts packages/batch-backend/src/domain/transcript-repository.ts packages/batch-backend/src/domain/draft-model.ts packages/batch-backend/src/domain/draft-repository.ts packages/batch-backend/src/infrastructure/transcription-storage.ts packages/batch-backend/src/application/process-transcribe-job.ts packages/batch-backend/src/application/ingest-manual-transcript-source.ts packages/batch-backend/src/application/create-draft.ts packages/batch-backend/src/application/update-recording-transcript.ts packages/batch-backend/src/application/update-draft.ts packages/batch-backend/src/transport/extended-routes/recordings-routes.ts packages/batch-backend/tests/domain.transcript-repository.test.ts packages/batch-backend/tests/infrastructure.transcription-storage.test.ts packages/batch-backend/tests/application.recording-transcript.test.ts packages/batch-backend/tests/application.draft.test.ts packages/batch-backend/tests/application.process-transcribe-job.test.ts packages/batch-backend/tests/application.ingest-manual-transcript-source.test.ts packages/batch-backend/tests/transport.http-server.integration.recordings-prompt-packages.test.ts
git commit -m "feat(backend): add artifact working CAS"
```

## Task 3: Implement the revisioned assignment-session aggregate

**Files:**

- Modify: `packages/batch-backend/src/domain/assignment-session-model.ts`
- Modify: `packages/batch-backend/src/domain/assignment-session-repository.ts`
- Modify: `packages/batch-backend/src/application/assignment-sessions.ts`
- Modify: `packages/batch-backend/src/application/student-schedule-billing.ts`
- Modify: `packages/batch-backend/src/application/teacher-business-dashboard.ts`
- Modify: `packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts`
- Modify: `packages/batch-backend/tests/domain.assignment-session-repository.test.ts`
- Modify: `packages/batch-backend/tests/application.student-schedule-billing.test.ts`
- Modify: `packages/batch-backend/tests/transport.http-server.integration.business.test.ts`
- Create: `packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts`

- [ ] **Step 1: Write failing student-idempotency and recovery-CAS tests**

```ts
const created = await confirmStudentAssignmentSession({
  userId,
  requestId: 'attempt-1',
  studentId,
  lessonId: null,
});
const replayed = await confirmStudentAssignmentSession({
  userId,
  requestId: 'attempt-1',
  studentId,
  lessonId: null,
});
expect(replayed.id).toBe(created.id);
expect(created.confirmed.student).toEqual({ studentId });

await expect(
  updateAssignmentSessionRecovery({
    id: created.id,
    userId,
    expectedRevision: created.revision - 1,
    patch: { teacherNotes: 'stale' },
  }),
).rejects.toMatchObject({ code: 'ASSIGNMENT_SESSION_REVISION_CONFLICT' });
```

Also assert the DTO/database mapper contains neither `currentStage` nor `archivedAt`, and recovery
cannot accept `confirmedStep`, `confirmed`, or Share linkage fields. Seed pre-Share and confirmed-Share
sessions for one recording. Prove only the pre-Share row is resumable/in progress, the completed row
does not block a new session, and create-or-reuse never mutates or returns the completed row. Seed a
bare draft and prove it cannot independently produce `draft_in_progress`.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/domain.assignment-session-repository.test.ts tests/application.student-schedule-billing.test.ts tests/transport.http-server.integration.business.test.ts tests/transport.http-server.integration.assignment-sessions.test.ts
```

Expected: tests fail because the repository accepts revisionless patches and the routes do not exist.

- [ ] **Step 3: Extend the session model and mapper**

Add `revision`, selected profile recovery identity, `confirmedStep`, `confirmed`, `creationRequestId`, and `shareJobId` to the domain record. Remove stage/archive fields. Parse `confirmed_snapshot` through a Zod schema at the repository boundary so malformed database JSON fails closed.

Define one reusable SQL predicate, `confirmed_step <> 'share'`, for active assignment sessions. Use
it in active-by-recording lookup, create-or-reuse, resumable list/count, lesson lookup, and every
recovery/confirmation update. Keep a separate lifecycle-neutral owned-by-ID read for completed
provenance and Share job reconciliation.

- [ ] **Step 4: Replace generic patching with explicit CAS repository commands**

Expose:

```ts
export async function updateAssignmentSessionRecovery(
  params: UpdateAssignmentSessionRecoveryParams,
): Promise<AssignmentSessionRecord>;
```

The update must include:

```sql
WHERE id = $1
  AND user_id = $2
  AND revision = $3
  AND confirmed_step IS DISTINCT FROM 'share'
  AND share_job_id IS NULL
```

and atomically set `revision = revision + 1`. When no row is returned, distinguish not found,
completed Share, Share in progress, and revision conflict.

Update lesson and business-dashboard joins to select only active sessions. Remove the independent
latest-draft lateral join: `draft_in_progress` means an active session exists with a non-null
`draft_id`; otherwise an active row is `session_in_progress`. Completed Share falls through to its
published/processing job presentation, and no bare draft can look partially alive.

- [ ] **Step 5: Add idempotent Student confirmation and new routes**

Implement `POST /assignment-sessions/confirm-student` and
`PATCH /assignment-sessions/:id/recovery`. Remove `POST /assignment-sessions`,
`PATCH /assignment-sessions/:id`, and `POST /assignment-sessions/:id/archive`; integration tests
assert all old routes are unavailable. Repeated `(userId, requestId)` with identical Student and
lesson recovery data returns the existing session; different data returns 409.

- [ ] **Step 6: Run tests and backend typecheck**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/domain.assignment-session-repository.test.ts tests/application.student-schedule-billing.test.ts tests/transport.http-server.integration.business.test.ts tests/transport.http-server.integration.assignment-sessions.test.ts
pnpm --filter @esl-pipeline/batch-backend typecheck
```

Expected: focused tests pass and no caller references the removed generic patch function.

- [ ] **Step 7: Commit the revisioned session aggregate**

```bash
git add packages/batch-backend/src/domain/assignment-session-model.ts packages/batch-backend/src/domain/assignment-session-repository.ts packages/batch-backend/src/application/assignment-sessions.ts packages/batch-backend/src/application/student-schedule-billing.ts packages/batch-backend/src/application/teacher-business-dashboard.ts packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts packages/batch-backend/tests/domain.assignment-session-repository.test.ts packages/batch-backend/tests/application.student-schedule-billing.test.ts packages/batch-backend/tests/transport.http-server.integration.business.test.ts packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts
git commit -m "feat(backend): revision assignment session recovery"
```

## Task 4: Confirm steps transactionally and bind lesson memory to confirmed Source

**Files:**

- Create: `packages/batch-backend/src/application/confirm-assignment-session-step.ts`
- Modify: `packages/batch-backend/src/domain/assignment-session-repository.ts`
- Modify: `packages/batch-backend/src/domain/lesson-memory-model.ts`
- Modify: `packages/batch-backend/src/domain/lesson-memory-repository.ts`
- Modify: `packages/batch-backend/src/domain/student-memory-snapshot-repository.ts`
- Modify: `packages/batch-backend/src/application/request-lesson-memory-generation.ts`
- Modify: `packages/batch-backend/src/application/process-lesson-memory-job.ts`
- Delete: `packages/batch-backend/src/application/request-confirmed-lesson-memory.ts`
- Modify: `packages/batch-backend/src/application/student-memory-package.ts`
- Modify: `packages/batch-backend/src/application/create-prompt-package.ts`
- Modify: `packages/batch-backend/src/application/generate-draft.ts`
- Modify: `packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts`
- Modify: `packages/batch-backend/src/transport/extended-routes/students-routes.ts`
- Create: `packages/batch-backend/tests/application.assignment-step-confirmation.test.ts`
- Modify: `packages/batch-backend/tests/application.request-lesson-memory-generation.test.ts`
- Modify: `packages/batch-backend/tests/application.process-lesson-memory-job.test.ts`
- Delete: `packages/batch-backend/tests/application.request-confirmed-lesson-memory.test.ts`
- Modify: `packages/batch-backend/tests/application.student-memory-package.test.ts`
- Modify: `packages/batch-backend/tests/domain.lesson-memory-repository.test.ts`
- Modify: `packages/batch-backend/tests/domain.assignment-session-repository.test.ts`
- Modify: `packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts`
- Modify: `packages/batch-backend/tests/transport.http-server.integration.students-memory.test.ts`

- [ ] **Step 1: Write the failing confirmation matrix**

For each step, cover success, missing prerequisite, wrong owner, broken lineage, stale session
revision, stale artifact working version, idempotent lost-response replay, exact URI/hash/version
capture, and exact downstream invalidation. Include the invariant that confirmation and recovery
cannot race to a last-writer-wins result.

Add the confirmed-memory matrix:

1. confirm A and prove the queued payload/worker read A's exact URI;
2. confirm A, autosave B, and prove A remains current and the worker still reads A;
3. reconfirm identical A and prove no duplicate intent/queue job, session revision, confirmed-step
   regression, or downstream invalidation;
4. confirm changed B and prove the replacement reads B's exact URI;
5. while B is pending/failed, prove A and snapshots derived from A are not current;
6. after B succeeds, prove B drives automatic snapshot refresh and future snapshots;
7. confirm from two tabs and prove artifact working-version plus session CAS reject the stale tab.

Also prove a late A worker cannot publish A after B is authoritative, and loaded content is rejected
if its SHA-256 does not match the confirmed payload hash.

```ts
expect(sourceResult.session.confirmedStep).toBe('source');
expect(sourceResult.session.confirmed.source).toMatchObject({
  transcriptWorkingVersion: transcript.workingVersion,
  transcriptStorageUri: transcript.storageUri,
  transcriptHash: transcript.contentHash,
});
expect(sourceResult.invalidated).toEqual(['prompt', 'draft', 'preview']);

await expect(confirmAssignmentSessionStep(staleRequest)).rejects.toMatchObject({
  code: 'ASSIGNMENT_SESSION_REVISION_CONFLICT',
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/application.assignment-step-confirmation.test.ts tests/application.request-lesson-memory-generation.test.ts tests/application.process-lesson-memory-job.test.ts tests/application.student-memory-package.test.ts tests/domain.lesson-memory-repository.test.ts tests/domain.assignment-session-repository.test.ts tests/transport.http-server.integration.assignment-sessions.test.ts tests/transport.http-server.integration.students-memory.test.ts
```

Expected: new test file fails to import the missing application service.

- [ ] **Step 3: Implement explicit validation by discriminator**

`confirmAssignmentSessionStep` must:

1. load the owned active session at `expectedRevision`;
2. validate the immediately preceding confirmed boundary;
3. validate artifact ownership and complete lineage;
4. lock the transcript/draft and require its current working version to equal the request;
5. copy the locked row's server-owned working version, content-addressed URI, and hash into the
   confirmed Source/Create snapshot;
6. calculate the confirmed snapshot and exact invalidation list;
7. for Source, ensure the `(transcript_id, transcript_hash)` lesson-memory intent and supersede any
   previous current lesson memory/student snapshot only when the confirmed hash changes;
8. commit the confirmed snapshot, working references, `confirmedStep`, and session `revision + 1` in
   one transaction.

Use exhaustive switching:

```ts
switch (request.step) {
  case 'source':
    return confirmSourceStep(context, request);
  case 'context':
    return confirmContextStep(context, request);
  case 'create':
    return confirmCreateStep(context, request);
  default:
    return assertNever(request);
}
```

- [ ] **Step 4: Make invalidation exact and regression-safe**

Use these rules in the repository transaction:

| Changed confirmed input      | Clear dependent active state |
| ---------------------------- | ---------------------------- |
| lesson/recording/transcript  | context, create              |
| notes/profile revision       | create                       |
| prompt/draft working version | derived preview              |

Clear active working references only when they derive from an invalidated lineage. Never delete
historical jobs, completed handouts, or content-addressed objects referenced by confirmed snapshots.

- [ ] **Step 5: Make confirmed Source the only lesson-memory authority**

Change `ensurePendingLessonMemoryEntry` to use the unique transcript/hash key and persist
`sourceStorageUri` plus `sourceContentHash`. Remove freshness comparisons against mutable transcript
`updated_at`; current selection uses explicit `pending`, `ready`, `failed`, and `superseded` status.
Queue with stable ID `lesson-memory:<transcriptId>:<sourceHash>` and payload the exact URI/hash.
The pending row is the durable enqueue intent created in the Source-confirmation transaction; enqueue
runs after commit. A failed/ambiguous enqueue is reconciled automatically from that row on mutation
completion, session load, or focus return. Do not add a general outbox or a manual refresh action.
Remove `promptPackageId` and the old prompt/draft trigger variants from the assignment-flow request
and payload; Source confirmation occurs before those artifacts and lesson memory must not resolve
their mutable notes later.

The worker must:

1. load the pending entry and confirm it is still authoritative;
2. read `payload.sourceStorageUri` directly without a transcript or prompt-package repository
   lookup;
3. verify SHA-256 equals `payload.sourceContentHash`;
4. conditionally publish ready only if that same hash remains authoritative;
5. request student-memory snapshot refresh automatically after ready publication.

On a changed confirmed hash, supersede old ready/pending lesson entries and ready/pending student
snapshots in the Source confirmation transaction. For ready snapshots, use the existing
`lesson_memory_entry_ids` array to invalidate exactly snapshots containing a superseded entry; stop
all pending snapshots for that student so an A-based job cannot publish after B confirmation. Until
replacement succeeds, assembly reports refreshing/unavailable and never falls back to A. Remove
prompt-package/draft fallback triggers and the standalone
`POST /students/:id/lesson-memory/requests` assignment-flow route/control. Reconfirming the same hash
performs no semantic mutation but may reconcile a missing stable queue entry.

- [ ] **Step 6: Add `POST /assignment-sessions/:id/confirm`**

Validate the discriminated body, map typed domain failures to 400/403/404/409, and return
`ConfirmAssignmentSessionStepResponse`. Do not accept content hashes or storage URIs from the
request; both come only from the locked server artifact row.

- [ ] **Step 7: Run focused backend verification**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/application.assignment-step-confirmation.test.ts tests/application.request-lesson-memory-generation.test.ts tests/application.process-lesson-memory-job.test.ts tests/application.student-memory-package.test.ts tests/domain.lesson-memory-repository.test.ts tests/domain.assignment-session-repository.test.ts tests/transport.http-server.integration.assignment-sessions.test.ts tests/transport.http-server.integration.students-memory.test.ts
pnpm --filter @esl-pipeline/batch-backend typecheck
```

Expected: confirmation matrix, repository atomicity tests, transport tests, and typecheck pass.

- [ ] **Step 8: Commit semantic confirmation and confirmed lesson memory**

```bash
git add packages/batch-backend/src/application/confirm-assignment-session-step.ts packages/batch-backend/src/domain/assignment-session-repository.ts packages/batch-backend/src/domain/lesson-memory-model.ts packages/batch-backend/src/domain/lesson-memory-repository.ts packages/batch-backend/src/domain/student-memory-snapshot-repository.ts packages/batch-backend/src/application/request-lesson-memory-generation.ts packages/batch-backend/src/application/process-lesson-memory-job.ts packages/batch-backend/src/application/request-confirmed-lesson-memory.ts packages/batch-backend/src/application/student-memory-package.ts packages/batch-backend/src/application/create-prompt-package.ts packages/batch-backend/src/application/generate-draft.ts packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts packages/batch-backend/src/transport/extended-routes/students-routes.ts packages/batch-backend/tests/application.assignment-step-confirmation.test.ts packages/batch-backend/tests/application.request-lesson-memory-generation.test.ts packages/batch-backend/tests/application.process-lesson-memory-job.test.ts packages/batch-backend/tests/application.request-confirmed-lesson-memory.test.ts packages/batch-backend/tests/application.student-memory-package.test.ts packages/batch-backend/tests/domain.lesson-memory-repository.test.ts packages/batch-backend/tests/domain.assignment-session-repository.test.ts packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts packages/batch-backend/tests/transport.http-server.integration.students-memory.test.ts
git commit -m "feat(memory): bind lessons to confirmed source"
```

## Task 5: Pin prompt generation to confirmed Source and Context

**Files:**

- Modify: `packages/batch-backend/src/application/create-prompt-package.ts`
- Modify: `packages/batch-backend/src/transport/extended-routes/recordings-routes.ts`
- Modify: `packages/batch-backend/tests/application.prompt-package.resolution.test.ts`
- Modify: `packages/batch-backend/tests/application.prompt-package.lineage-drift.test.ts`
- Modify: `packages/batch-backend/tests/transport.http-server.integration.recordings-prompt-packages.test.ts`
- Modify: `packages/batch-frontend/src/utils/api.ts`

- [ ] **Step 1: Write failing exact-confirmed-input tests**

Confirm transcript content and the first of two profile revisions. Then autosave newer transcript
content and activate the second profile revision before generation. Assert the prompt uses the
confirmed transcript URI and confirmed profile revision, not either mutable current value. Add
rejection tests for an unowned session, missing confirmed prerequisites, and broken confirmed
artifact lineage.

```ts
const result = await createPromptPackage({
  assignmentSessionId: session.id,
  userId,
});

expect(result.resolvedProfileRevisionId).toBe(confirmedRevision.id);
expect(result.text).toContain(confirmedTranscriptMarker);
expect(result.text).not.toContain(newWorkingTranscriptMarker);
expect(result.text).toContain(confirmedRevision.marker);
expect(result.text).not.toContain(newActiveRevision.marker);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/application.prompt-package.resolution.test.ts tests/application.prompt-package.lineage-drift.test.ts tests/transport.http-server.integration.recordings-prompt-packages.test.ts
```

Expected: generation reads the transcript artifact's current storage pointer and resolves the newly
active profile revision instead of using the session's confirmed Source/Context tuple.

- [ ] **Step 3: Resolve exact inputs from the owned session**

Require `assignmentSessionId` for authenticated assignment generation. Load the owned session and
require confirmed Student, Source, and Context snapshots. Read transcript text from
`confirmed.source.transcriptStorageUri`; do not re-read `transcript.storageUri`. Load the exact
nullable profile pair from confirmed Context, validate its learner lineage, and retain
`resolvedProfileRevisionId` in the prompt-package record. The client cannot submit a replacement
storage URI, hash, transcript ID, profile ID, or profile revision for this operation.

- [ ] **Step 4: Update the frontend API request type**

Make `createPromptPackage` require `assignmentSessionId` and remove assignment-flow request fields
that duplicate confirmed Student/Source/Context identity. Keep any separate non-assignment operator
surface outside this contract unchanged.

- [ ] **Step 5: Run focused tests and typechecks**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/application.prompt-package.resolution.test.ts tests/application.prompt-package.lineage-drift.test.ts tests/transport.http-server.integration.recordings-prompt-packages.test.ts
pnpm --filter @esl-pipeline/batch-backend typecheck
pnpm --filter @esl-pipeline/batch-frontend typecheck
```

Expected: exact confirmed-input tests and both package typechecks pass.

- [ ] **Step 6: Commit confirmed generation inputs**

```bash
git add packages/batch-backend/src/application/create-prompt-package.ts packages/batch-backend/src/transport/extended-routes/recordings-routes.ts packages/batch-backend/tests/application.prompt-package.resolution.test.ts packages/batch-backend/tests/application.prompt-package.lineage-drift.test.ts packages/batch-backend/tests/transport.http-server.integration.recordings-prompt-packages.test.ts packages/batch-frontend/src/utils/api.ts
git commit -m "fix(generation): pin confirmed assignment inputs"
```

## Task 6: Make Share one stable job-backed terminal operation

**Files:**

- Create: `packages/batch-backend/src/application/share-assignment-session.ts`
- Modify: `packages/batch-backend/src/application/create-approval-job.ts`
- Modify: `packages/batch-backend/src/application/materialize-draft.ts`
- Modify: `packages/batch-backend/src/application/approve-job.ts`
- Modify: `packages/batch-backend/src/domain/assignment-session-repository.ts`
- Modify: `packages/batch-backend/src/domain/job-repository.ts`
- Modify: `packages/batch-backend/src/infrastructure/queue-bullmq.ts`
- Modify: `packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts`
- Create: `packages/batch-backend/tests/application.assignment-share.test.ts`
- Modify: `packages/batch-backend/tests/infrastructure.queue-bullmq.test.ts`
- Modify: `packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts`

- [ ] **Step 1: Write failing interruption and idempotency tests**

Use injectable orchestration boundaries to interrupt after atomic job reservation, materialization,
approval-before-enqueue, enqueue-before-confirmation, and confirmation-before-response. Resume with
the same request ID and assert one database job, one stable BullMQ ID, and one terminal session link.

```ts
for (const stopAfter of [
  'reservation',
  'materialization',
  'approval',
  'enqueue',
  'confirmation',
] as const) {
  const harness = createShareHarness({ stopAfter });
  await expect(harness.firstAttempt()).rejects.toThrow('simulated interruption');
  const recovered = await harness.retrySameRequest();
  expect(recovered.session.confirmedStep).toBe('share');
  expect(recovered.session.shareJobId).toBe(harness.reservedJobId);
  expect(harness.createdJobIds).toEqual([harness.reservedJobId]);
  expect(harness.enqueuedJobIds).toEqual([harness.reservedJobId]);
}
```

Also assert Share rejects if any Source, Context, or Create recovery field differs from its confirmed
snapshot. Change the draft's working pointer after Create confirmation and assert Share still
materializes the immutable URI/hash from `confirmed.create.draftStorageUri` and
`confirmed.create.draftHash`.

Add queue/database reconciliation cases:

- concurrent Share calls create one database job;
- queued/running/succeeded jobs are returned without duplication;
- a queued database job with a missing BullMQ entry is added with the same ID;
- an ambiguous response re-reads queue/database state and returns or re-enqueues that same job;
- a terminal failed database job with a retained BullMQ entry resets to queued and calls
  `job.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true })` under the same
  identity;
- a terminal failed job whose BullMQ entry was removed is added again with the same ID;
- retry leaves `source_job_id` unchanged and creates no rerun child;
- session CAS advances `confirmedStep` to Share exactly once; terminal retry never advances or
  revisions the session again.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/application.assignment-share.test.ts tests/infrastructure.queue-bullmq.test.ts tests/transport.http-server.integration.assignment-sessions.test.ts
```

Expected: the missing orchestration service fails to import and the current frontend-composed flow
can create another approval job after a lost response.

- [ ] **Step 3: Prepare job inputs, then reserve the stable job and session link atomically**

Split approval-job creation into a side-effect-free parameter builder and an insert operation.
Resolve settings/configuration before opening the transaction. Extend job insertion to accept a
caller-supplied ID and the transaction's database client; publish the existing `job_created` event
only after commit. Add one repository transaction:

```ts
export type ResolvedApprovalJobConfig = Omit<
  InsertJobParams,
  | 'recordingId'
  | 'transcriptId'
  | 'promptPackageId'
  | 'draftId'
  | 'studentId'
  | 'lessonId'
  | 'userId'
  | 'md'
  | 'mdStorageUri'
>;

export async function reserveAssignmentShare(params: {
  sessionId: string;
  userId: string;
  expectedRevision: number;
  requestId: string;
  jobConfig: ResolvedApprovalJobConfig;
}): Promise<{ session: AssignmentSessionRecord; job: JobRecord }>;
```

The transaction locks the session, verifies clean confirmed inputs, creates one
`awaiting_approval` job with `id = requestId`. It derives artifact identity from the locked confirmed
snapshots, sets the job's existing `md_storage_uri` to `confirmed.create.draftStorageUri`, stores the
job ID as `share_job_id`, and increments the session revision. `jobConfig` contains only resolved
publish/TTS settings, never lineage fields. Repeating the same request returns the existing linked
job even with the old expected revision. A different request conflicts; a missing/wrong-lineage
linked job fails integrity checks. While `share_job_id` is set and `confirmedStep !== 'share'`, other
session mutations return `SHARE_IN_PROGRESS`.

- [ ] **Step 4: Implement resumable Share orchestration**

`shareAssignmentSession` inspects the existing job state:

1. `awaiting_approval`: verify `job.mdStorageUri` equals the confirmed Create URI, materialize that
   exact object idempotently, approve to `queued`, then enqueue;
2. `queued`: inspect BullMQ; add a missing entry with `jobId` equal to the database ID, otherwise
   return waiting/delayed/active unchanged;
3. `running`: return unchanged; `succeeded`: return the completed result;
4. terminal `failed`: use a focused repository CAS to reset only this linked job from `failed` to
   `queued`, clear terminal error/timestamps, and preserve ID/content/lineage. If BullMQ retains the
   failed entry, call
   `job.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true })`; if it is missing,
   `queue.add` with the same ID/payload.
   A concurrent lost CAS or expected-state error re-reads both stores and converges;
5. after successful enqueue or an already running/succeeded state, conditionally set
   `confirmedStep = 'share'` and increment the session revision;
6. `confirmedStep = 'share'`: return queued/running/succeeded unchanged, or run the same terminal
   failed-job reconciliation without mutating session state.

Refactor `approveJobForPipeline` so a retry can enqueue an already-queued job with the same BullMQ ID
without re-approving or cloning it. Remove `materializeDraft`'s current fallback that creates a new
approval job when a caller-supplied job is absent or no longer `awaiting_approval`; the Share service
must treat that condition as an integrity/state check and never substitute a new job. Refactor its
input so the Share path reads the job's already-linked content-addressed URI rather than
`draft.storageUri`.

Do not widen the generic job state machine to make all failed jobs mutable. Add a focused
`resetFailedAssignmentShareJob` repository operation guarded by linked session/job identity and
`WHERE jobs.state = 'failed'`. BullMQ 5.79.1 already supplies the retained-entry operation
`job.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true })`; use it instead of
remove-and-clone so the configured automatic-attempt budget is available again. Existing automatic
queue attempts remain the first retry layer.

- [ ] **Step 5: Add the Share route and typed responses**

Add `POST /assignment-sessions/:id/share`. Its response is `{ session, job }`; it never includes
`archivePending`. Exclude `confirmedStep = 'share'` sessions from resumable-session lists and route a
direct fetch of completed Share to the linked job.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/application.assignment-share.test.ts tests/infrastructure.queue-bullmq.test.ts tests/transport.http-server.integration.assignment-sessions.test.ts
pnpm --filter @esl-pipeline/batch-backend typecheck
```

Expected: every interruption point resumes to one linked job, confirmed Share is terminal, and all
dirty-upstream Share requests fail closed.

- [ ] **Step 7: Commit crash-safe Share**

```bash
git add packages/batch-backend/src/application/share-assignment-session.ts packages/batch-backend/src/application/create-approval-job.ts packages/batch-backend/src/application/materialize-draft.ts packages/batch-backend/src/application/approve-job.ts packages/batch-backend/src/domain/assignment-session-repository.ts packages/batch-backend/src/domain/job-repository.ts packages/batch-backend/src/infrastructure/queue-bullmq.ts packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts packages/batch-backend/tests/application.assignment-share.test.ts packages/batch-backend/tests/infrastructure.queue-bullmq.test.ts packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts
git commit -m "feat(backend): make assignment share retry safe"
```

## Task 7: Build the frontend confirmation state machine and API client

**Files:**

- Modify: `packages/batch-frontend/src/utils/api.ts`
- Create: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.confirmation.ts`
- Create: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.confirmation.test.ts`
- Modify: `packages/batch-frontend/src/ui/assignments/assignment-workflow.ts`
- Modify: `packages/batch-frontend/src/ui/assignments/assignment-workflow.test.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-presentation.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-presentation.test.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.entry-state.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.entry-state.test.ts`
- Modify: `packages/batch-frontend/src/dev/frontend-sandbox-api.ts`
- Modify: `packages/batch-frontend/src/dev/frontend-sandbox-api.test.ts`

- [ ] **Step 1: Write failing pure workflow tests**

Cover confirmed completion, dirty recovery, earliest-dirty/base resume derivation, completed-Share job
routing, permissible forward navigation, Share blocking, exit safety, refresh triggers, invalidation,
and conflict reconciliation. Readiness booleans must not mark a step complete.

```ts
expect(deriveAssignmentWorkflow(sessionWithReadyUnconfirmedDraft).create.status).toBe('current');
expect(findResumeStep(sessionWithDirtySourceAndConfirmedCreate)).toBe('source');
expect(canNavigateToStep(sessionWithDirtyContext, 'review')).toBe(false);
expect(canShareAssignment(sessionWithDirtyContext)).toEqual({
  allowed: false,
  reason: 'Confirm Teaching context before sharing.',
});
expect(deriveResumeDestination(cleanConfirmedContext)).toBe('assignment');
expect(deriveResumeDestination(confirmedShare)).toEqual({ jobId: confirmedShare.shareJobId });
expect(shouldGuardAssignmentExit({ recovery: 'saved', mutation: 'settled' })).toBe(false);
expect(shouldGuardAssignmentExit({ recovery: 'pending', mutation: 'settled' })).toBe(true);
```

- [ ] **Step 2: Run pure tests and verify failure**

Run:

```bash
pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.confirmation.test.ts src/ui/assignments/assignment-workflow.test.ts src/ui/minimal/MinimalAssignment.resume-presentation.test.ts src/ui/minimal/MinimalAssignment.entry-state.test.ts src/dev/frontend-sandbox-api.test.ts
```

Expected: missing confirmation helper and old readiness-derived status tests fail.

- [ ] **Step 3: Add explicit API client functions**

Export:

```ts
export async function confirmStudentAssignmentSession(
  request: ConfirmStudentAssignmentSessionRequest,
): Promise<AssignmentSessionDto>;

export async function updateAssignmentSessionRecovery(
  sessionId: string,
  request: UpdateAssignmentSessionRecoveryRequest,
): Promise<AssignmentSessionDto>;

export async function confirmAssignmentSessionStep(
  sessionId: string,
  request: ConfirmAssignmentSessionStepRequest,
): Promise<ConfirmAssignmentSessionStepResponse>;

export async function shareAssignmentSession(
  sessionId: string,
  request: ConfirmAssignmentSessionShareRequest,
): Promise<ConfirmAssignmentSessionShareResponse>;
```

Update transcript/draft functions to require `expectedWorkingVersion` and return working version/hash.
Delete obsolete session create/update/archive exports and the standalone
`requestConfirmedLessonMemory` assignment-flow export, then match sandbox behavior to production
semantics without `currentStage`, `archivedAt`, or `archivePending`.

- [ ] **Step 4: Implement pure state derivation**

`MinimalAssignment.confirmation.ts` owns:

- content-normalized equality for notes and nullable IDs;
- per-step dirty comparison between working fields and `confirmed` snapshots;
- earliest dirty resume selection in Source → Context → Create order;
- base resume mapping from `confirmedStep` and completed Share to its linked job;
- forward-navigation and Share guards;
- exit safety from recovery durability and mutation ambiguity, independent of confirmation dirtiness;
- refresh decisions limited to load, focus return, mutation completion, and async polling;
- idempotent lost-response comparison;
- conflict resolution decisions that distinguish safe server adoption from local reconciliation.

Use exhaustive outputs rather than component-specific booleans:

```ts
export type ConfirmationSaveState =
  | { kind: 'idle' }
  | { kind: 'saving'; step: AssignmentConfirmedStep }
  | { kind: 'saved'; step: AssignmentConfirmedStep }
  | { kind: 'error'; step: AssignmentConfirmedStep; message: string }
  | { kind: 'conflict'; step: AssignmentConfirmedStep; message: string };

export type AssignmentPersistenceSafety = {
  recovery: 'saved' | 'pending' | 'failed';
  mutation: 'settled' | 'ambiguous';
};
```

Stepper prerequisites and exit protection are separate decisions: an unconfirmed boundary can keep
a later workflow step unavailable, but it cannot trigger a route/browser exit warning after recovery
is durable.

- [ ] **Step 5: Derive visible workflow status only from confirmed snapshots**

Keep the existing visible stages but map completion from `confirmedStep`; use earliest dirty recovery
to select current/resume. Delete all `currentStage` presentation maps. A confirmed Share session is
completed and resolves to its linked job, not Review. Define the frontend-only
`AssignmentWorkflowStep = 'student' | 'source' | 'context' | 'assignment' | 'review'` for visible
navigation; it is never serialized.

- [ ] **Step 6: Run pure tests and frontend typecheck**

Run:

```bash
pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.confirmation.test.ts src/ui/assignments/assignment-workflow.test.ts src/ui/minimal/MinimalAssignment.resume-presentation.test.ts src/ui/minimal/MinimalAssignment.entry-state.test.ts src/dev/frontend-sandbox-api.test.ts
pnpm --filter @esl-pipeline/batch-frontend typecheck
```

Expected: state derivation, API parity, and typecheck pass.

- [ ] **Step 7: Commit the frontend contract layer**

```bash
git add packages/batch-frontend/src/utils/api.ts packages/batch-frontend/src/ui/minimal/MinimalAssignment.confirmation.ts packages/batch-frontend/src/ui/minimal/MinimalAssignment.confirmation.test.ts packages/batch-frontend/src/ui/assignments/assignment-workflow.ts packages/batch-frontend/src/ui/assignments/assignment-workflow.test.ts packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-presentation.ts packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-presentation.test.ts packages/batch-frontend/src/ui/minimal/MinimalAssignment.entry-state.ts packages/batch-frontend/src/ui/minimal/MinimalAssignment.entry-state.test.ts packages/batch-frontend/src/dev/frontend-sandbox-api.ts packages/batch-frontend/src/dev/frontend-sandbox-api.test.ts
git commit -m "feat(frontend): derive confirmed assignment workflow"
```

## Task 8: Wire Student, Source, and Context automatic recovery and confirmation

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.source.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx`
- Modify: `packages/batch-frontend/src/utils/api.student-memory.test.ts`
- Modify: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.test-harness.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx`
- Modify: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.navigation.test.tsx`

- [ ] **Step 1: Write failing Step 1-3 journey tests**

Cover:

- Student Continue creates one idempotent session and enters Source;
- Source Continue first flushes transcript, then confirms its returned working version;
- Source confirmation automatically starts lesson memory; no separate memory-confirm action remains;
- Context Continue first flushes notes/profile recovery, then confirms;
- Back only navigates and preserves working state;
- clicking a later step cannot bypass a dirty unconfirmed boundary;
- transient writes retry automatically without a Save/Refresh control;
- exhausted retry shows a scoped Retry that reuses the same request/revision intent;
- 409 fetches latest state and preserves local dirty input.

```ts
await user.click(screen.getByRole('button', { name: 'Continue' }));
expect(api.confirmStudentAssignmentSession).toHaveBeenCalledTimes(1);
expect(screen.getByRole('heading', { name: 'Lesson source' })).toBeVisible();

expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();
expect(screen.queryByRole('button', { name: /^Refresh/ })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx src/ui/assignments/AssignmentWorkflow.navigation.test.tsx src/utils/api.student-memory.test.ts
```

Expected: old generic session mutation calls and navigation-only Source advancement violate the new assertions.

- [ ] **Step 3: Add one serialized session revision coordinator**

In `MinimalAssignment.tsx`, keep the latest returned session in a ref as well as state so queued automatic recovery always reads the newest revision. Serialize session mutations; coalesce superseded recovery patches but never coalesce semantic confirmations. On 409, fetch the latest session, run the pure reconciliation decision, and retain local buffers when they differ.

Retain the existing hydration suppression boundary: hydrated values are already durable and do not
schedule recovery until `markAssignmentUserEdit()` records a real tutor change. Keep the manual
transcript wrapper on that boundary so resumed pasted-transcript edits cannot bypass persistence or
exit-safety tracking.

- [ ] **Step 4: Implement Student and Source confirmation**

Student Continue creates one UUID per attempt and reuses it until success or explicit learner change.
Source automatic recovery persists lesson/source identities. Source Continue awaits any pending
transcript autosave, uses the returned working version, then calls
`confirmAssignmentSessionStep`. Only the successful response changes the visible confirmed boundary;
the backend captures the locked transcript's immutable URI/hash/version tuple at confirmation and
automatically starts/reconciles lesson memory for that hash. Remove the first-profile standalone
memory-confirm button/API call; memory readiness remains automatic asynchronous status.

- [ ] **Step 5: Implement Context recovery and confirmation**

Debounce notes/profile recovery at the existing autosave cadence. Context Continue flushes the
latest recovery patch and confirms the exact profile ID/revision/hash. Selecting a different profile
revision marks Context dirty but does not invalidate Create until confirmation.

- [ ] **Step 6: Remove manual persistence responsibility and present honest status**

Remove Source Save/Refresh affordances. `AssignmentWorkflow` renders `Saving…`, `All changes saved`, `Confirmation failed`, or conflict text from the coordinator. It must never infer `saved` merely because an active session exists.

- [ ] **Step 7: Run focused tests and frontend typecheck**

Run:

```bash
pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx src/ui/assignments/AssignmentWorkflow.navigation.test.tsx src/utils/api.student-memory.test.ts
pnpm --filter @esl-pipeline/batch-frontend typecheck
```

Expected: Step 1-3 journeys, retry/conflict cases, and typecheck pass.

- [ ] **Step 8: Commit Student, Source, and Context behavior**

```bash
git add packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.source.ts packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx packages/batch-frontend/src/utils/api.student-memory.test.ts packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.test-harness.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.navigation.test.tsx
git commit -m "feat(frontend): confirm assignment inputs automatically"
```

## Task 9: Wire Create, derived resume, safe navigation, and terminal Share

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.authoring.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.polling.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.polling.test.ts`
- Modify: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.test-harness.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx`

- [ ] **Step 1: Write failing Create/Share/resume tests**

Cover:

- generation uses the confirmed profile revision;
- draft autosave returns a working version and Create Continue captures its immutable URI/hash/version tuple;
- manual Save draft is absent;
- Share rejects dirty upstream recovery and uses one request ID across retries;
- response loss still shows completed Share, links the stable job, and never duplicates it;
- clean refresh derives destination from `confirmedStep`, never `currentStage`;
- refresh with dirty Source/Context/Create opens the earliest dirty step;
- confirmed Share opens the linked job and is absent from unfinished sessions;
- route exit with pending/failed recovery or ambiguous mutation invokes the guard;
- durable-but-unconfirmed recovery does not invoke the guard;
- stable data refreshes on load, focus return, and mutation completion but has no interval;
- only processing recordings/jobs continue polling and stop at terminal state;
- browser refresh does not require a manual refresh action after reload.

```ts
expect(api.createPromptPackage).toHaveBeenCalledWith(
  expect.objectContaining({ profileRevisionId: confirmedContext.profileRevisionId }),
);

await user.click(screen.getByRole('button', { name: 'Share assignment' }));
expect(api.shareAssignmentSession).toHaveBeenCalledTimes(1);
expect(await screen.findByText('Assignment shared')).toBeVisible();
expect(screen.queryByText('Unfinished assignment')).not.toBeInTheDocument();
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx src/ui/minimal/MinimalAssignment.polling.test.ts
```

Expected: draft save lacks working-version CAS, Share is frontend-composed with archival, and resume
depends on persisted stage instead of confirmed/dirty state.

- [ ] **Step 3: Confirm Create from the durable draft revision**

Generation consumes confirmed Student/Source/Context only. Draft autosave carries the latest expected
working version. Create Continue flushes autosave, then confirms the exact prompt package, draft, and
returned working version; the backend copies the locked draft's content-addressed URI, server hash,
and working version into the confirmed Create snapshot. Remove manual Save draft responsibility.

- [ ] **Step 4: Implement confirmed-input Preview and Share**

Preview reads `session.confirmed.create`, not newer recovery. Share creates one UUID per logical
attempt, calls the new Share route, and reuses it for retries. The returned linked job is the completed
destination. Delete every archive call, archive-pending state, and cleanup effect.

- [ ] **Step 5: Rehydrate the earliest dirty boundary**

After fetching a session, load working artifact versions/hashes and compare them with confirmed
snapshots. Select Source before Context before Create when multiple boundaries are dirty; otherwise
derive the destination from `confirmedStep`. A completed Share routes to `session.shareJobId`. Never
silently replace a local dirty buffer during conflict recovery.

- [ ] **Step 6: Add assignment-specific route protection**

For SPA navigation, flush a pending unambiguous save before leaving. Protect internal route changes
and `beforeunload` only while local content is not durably recovered, recovery retry is exhausted, or
a mutation response is ambiguous. Do not guard merely because recovered content differs from
confirmed truth.

- [ ] **Step 7: Restrict automatic refresh triggers**

Load stable assignment collections on entry, refresh once per window-focus return, and update/refresh
directly affected state after mutation completion. Keep SSE/fallback polling only for
queued/transcribing recordings and queued/running jobs; stop polling at terminal state. Do not add
stable-data intervals or reconnect refresh loops.

- [ ] **Step 8: Run focused journeys and frontend typecheck**

Run:

```bash
pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx src/ui/minimal/MinimalAssignment.polling.test.ts
pnpm --filter @esl-pipeline/batch-frontend typecheck
```

Expected: Create, Share interruption recovery, earliest-dirty resume, navigation guard, and typecheck pass.

- [ ] **Step 9: Commit Create, Share, and resume behavior**

```bash
git add packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.authoring.ts packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume.ts packages/batch-frontend/src/ui/minimal/MinimalAssignment.polling.ts packages/batch-frontend/src/ui/minimal/MinimalAssignment.polling.test.ts packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.test-harness.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx
git commit -m "feat(frontend): complete confirmed assignment journey"
```

## Task 10: Synchronize documentation, baseline, and full journey evidence

**Files:**

- Modify: `packages/batch-backend/README.md`
- Modify: `packages/batch-frontend/README.md`
- Modify: `docs/backend-frontend/backend-frontend-alignment.md`
- Modify: `packages/batch-backend/schema.sql`
- Modify: `docs/generated/plans-index.md` if generated by the repository command
- Modify: `docs/superpowers/plans/2026-07-18-assignment-step-confirmation-contract.md` - check completed steps during execution

- [ ] **Step 1: Add one focused five-step regression journey**

Place the journey in the existing frontend workflow test grouping and cover fresh Student → Source →
Context → Create → Share; derived resume at each boundary; durable dirty recovery; cross-tab
conflicts; safe exit with recovered-unconfirmed work; guarded exit with pending/ambiguous work; bounded
refresh triggers; and Share response loss. Use mocked network boundaries only where necessary to
simulate ambiguity; keep pure state rules in dedicated helper tests.

- [ ] **Step 2: Run all affected backend and frontend suites**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend test:unit
pnpm --filter @esl-pipeline/batch-frontend test:unit
pnpm --filter @esl-pipeline/batch-backend typecheck
pnpm --filter @esl-pipeline/batch-frontend typecheck
```

Expected: all package unit tests and typechecks pass.

- [ ] **Step 3: Update behavior documentation**

Document:

- recovery versus confirmation ownership;
- hard deletion order for pre-cutover sessions, drafts, and prompt packages, with no legacy
  resume/edit compatibility;
- preservation of completed jobs, handouts, published URLs, and their required read-only artifacts;
- preservation of completed-job `md_storage_uri` homework-memory reads and absence of a cutover
  storage purge;
- mandatory initial working version/hash for every new transcript and draft;
- working-version CAS, confirmed URI/hash/version capture, and 409 handling;
- absence of transcript/draft content-revision tables;
- removal of routine Save/Refresh responsibility;
- absence of persisted stage/archive state and derived resume/completion;
- earliest-dirty resume, forward-navigation blocking, and durability-based exit guards;
- load/focus/mutation refresh triggers plus async-only polling;
- immutable historical handouts and new-assignment replacement;
- confirmed-hash lesson-memory payloads, automatic replacement/refresh, and temporary unavailable
  behavior instead of stale-memory fallback;
- `confirmedStep = 'share'` as the only active/completed boundary across repository, dashboard,
  uniqueness, resume, and create-or-reuse consumers;
- one stable job-backed Share reservation, in-place terminal failed retry, intentional-rerun
  distinction, and terminal confirmed Share;
- API `4.0.0`, DB `0.23.0`, and release-major classification.

- [ ] **Step 4: Regenerate and verify the schema baseline**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend run db:generate-baseline
pnpm --filter @esl-pipeline/batch-backend run db:verify-baseline
pnpm release:verify:contracts
```

Expected: generated `schema.sql` matches migration head `0044_assignment_step_confirmation_contract`, the baseline verifier passes, and contract release verification accepts the API major/DB minor bump.

- [ ] **Step 5: Generate indexes, format, and validate docs**

Run:

```bash
pnpm docs:generate:indexes
pnpm format:write
pnpm format
pnpm run lint:repo-hygiene
pnpm docs:check
```

Expected: generated indexes are current, formatting and repository hygiene pass, and docs links/headings are valid. If `pnpm format` still reports the two pre-existing audio-ingest plan/spec files, verify this branch did not modify them and record that baseline issue separately rather than widening this PR.

- [ ] **Step 6: Run the broad behavioral gates**

Because this change crosses public contracts, migrations, storage, queue orchestration, backend, and frontend, run the broad lane rather than stopping at affected-package tests:

```bash
pnpm --silent run check:fast:agent
pnpm check:pre-pr
pnpm check
```

Expected: all gates pass. If an agent lane fails, inspect the reported `tmp/check-logs/...` artifact before rerunning a raw command. Treat an unrelated local PostgreSQL `ECONNREFUSED 127.0.0.1:5432` as an environment blocker only after confirming the edited unit/contract lanes are green.

- [ ] **Step 7: Review the final diff against the approved design**

Run:

```bash
git diff --check
git diff --stat origin/main...HEAD
git status --short
rg -n "T[B]D|T[O]DO|manual save|manual refresh|PATCH /assignment-sessions/:id" docs packages/batch-backend packages/batch-frontend
rg -n "currentStage|current_stage|archiveAssignmentSession|archivePending|assignment_session_share_attempts|SHARE_ATTEMPT_STATES" packages/contracts/src packages/batch-backend/src packages/batch-frontend/src
rg -n "transcript_content_revisions|draft_content_revisions|ArtifactContentRevision" packages/contracts/src packages/batch-backend docs/backend-frontend packages/batch-backend/README.md packages/batch-frontend/README.md
rg -n "archived_at IS NULL|generated_at >= t.updated_at|prompt-package-created|draft-generation-fallback|getTranscriptByRecordingId" packages/batch-backend/src/domain/assignment-session-repository.ts packages/batch-backend/src/domain/lesson-memory-repository.ts packages/batch-backend/src/application/request-lesson-memory-generation.ts packages/batch-backend/src/application/process-lesson-memory-job.ts packages/batch-backend/src/application/create-prompt-package.ts packages/batch-backend/src/application/generate-draft.ts packages/batch-backend/src/application/student-schedule-billing.ts packages/batch-backend/src/application/teacher-business-dashboard.ts
```

Expected: no whitespace errors or placeholders; no revisionless session PATCH; no persisted stage,
session archive, Share-attempt ledger, or transcript/draft content-revision tables on the assignment
surface; no old active-session/archive predicate; no mutable transcript lookup or opportunistic
lesson-memory trigger after confirmation; and no routine manual Save/Refresh requirement. Inspect
matches and retain only unrelated established repository notes.

- [ ] **Step 8: Commit documentation and validation artifacts**

```bash
git add packages/batch-backend/README.md packages/batch-frontend/README.md docs/backend-frontend/backend-frontend-alignment.md packages/batch-backend/schema.sql docs/generated/plans-index.md docs/superpowers/plans/2026-07-18-assignment-step-confirmation-contract.md
git commit -m "docs(assignment): document confirmed step workflow"
```

If `docs/generated/plans-index.md` is unchanged, omit it from `git add` rather than forcing an empty pathspec.

---

## Completion Checklist

- [ ] All five visible steps advance only after their approved durable confirmation event.
- [ ] Every pre-cutover assignment session, draft, and prompt package is removed in dependency order
      and no legacy resume/hydration branch exists.
- [ ] Completed jobs, handouts, and published URLs remain readable after cutover.
- [ ] Pre-cutover editor artifacts cannot enter a new assignment; every new transcript/draft starts at working version `1` with a server hash.
- [ ] Automatic recovery never changes confirmed truth.
- [ ] No `currentStage` or session archive state exists; resume and completion are derived.
- [ ] `confirmedStep` remains the uniform atomically maintained workflow/query scalar.
- [ ] Transcript/draft autosaves use content-addressed working CAS without content-revision tables.
- [ ] Source/Create confirmation stores the exact immutable URI/hash/version tuple consumed downstream.
- [ ] Prompt generation uses the exact confirmed transcript URI and profile revision.
- [ ] Lesson memory uses the exact confirmed transcript URI/hash, ignores unconfirmed autosaves,
      regenerates on every changed confirmed hash, hides A while B refreshes, and automatically
      refreshes future student-memory snapshots from B.
- [ ] Cross-tab conflicts preserve local input and cannot silently overwrite newer state.
- [ ] Back is non-destructive; forward navigation cannot bypass dirty unconfirmed work.
- [ ] Resume opens the earliest dirty boundary, then derives from `confirmedStep`; confirmed Share opens its linked job.
- [ ] Exit guards appear only for unrecovered or ambiguous work, not durable unconfirmed recovery.
- [ ] Stable refresh occurs only on load, focus return, or mutation completion; only async work polls.
- [ ] No routine Save action remains where the system can infer and persist the desired state.
- [ ] Historical shared handouts remain accessible after active-lineage invalidation.
- [ ] Share interruption resumes from one stable job and existing job state without a parallel attempt ledger.
- [ ] `confirmedStep = 'share'` is the only completed predicate; completed sessions are absent from
      resumable/in-progress results, do not block same-recording creation, and remain immutable.
- [ ] A terminal failed Share job resets/retries under the same database/BullMQ identity without a
      rerun child; intentional reruns still create child lineage.
- [ ] Confirmed Share is terminal and excluded from unfinished sessions without archive cleanup.
- [ ] API and DB contract versions, migration head, baseline schema, READMEs, and alignment docs agree.
- [ ] Focused suites, package tests/typechecks, contract verification, baseline verification, docs checks, and broad repository gates have fresh recorded evidence.

## Inline Execution Handoff

The approved execution mode is inline. Start the implementation in this branch with `superpowers:executing-plans`, complete tasks in order, mark each checkbox only after its stated evidence passes, and stop for user input only if a discovered contract conflict would materially change the approved design.
