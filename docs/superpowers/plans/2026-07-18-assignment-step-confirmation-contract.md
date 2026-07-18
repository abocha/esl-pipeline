# Assignment Step Confirmation Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every assignment step advance only after its semantic decision is durably confirmed, while automatically preserving recoverable edits, preventing stale-tab overwrites, and making Share retry-safe without asking tutors to manage Save or Refresh actions.

**Architecture:** Hard-cut every pre-existing assignment session, then replace the workflow with a revisioned aggregate containing separate working/recovery and confirmed snapshots. Every new transcript and draft begins with an immutable content revision and compare-and-swap head; historical editor artifacts remain read-only outputs only. Expose revision-aware recovery and confirmation commands, orchestrate Share through a durable attempt ledger, and derive frontend navigation from server-confirmed state.

**Tech Stack:** TypeScript 6, Node.js 24, pnpm workspaces, Fastify, PostgreSQL, BullMQ, React 19, Vite, Vitest, Testing Library, Zod, existing filesystem/S3 transcription storage adapters.

## Global Constraints

- Follow the approved design in `docs/superpowers/specs/2026-07-18-assignment-step-confirmation-contract-design.md`.
- Treat deployment as a hard closed-alpha cutover: delete every pre-cutover assignment session and
  provide no legacy resume, repair, hydration, or payload compatibility.
- Preserve completed jobs, handouts, published URLs, and their required artifacts as read-only
  history; pre-cutover editor artifacts cannot enter a new assignment lineage.
- Every newly created transcript and draft receives its first immutable content revision and
  non-null head immediately. Never initialize a historical artifact on first edit.
- Tutor actions own semantic confirmation; automatic persistence owns recovery, retry, and freshness.
- Do not add routine `Save`, `Refresh`, or `Reload` controls. Expose `Retry` only after bounded automatic retry fails.
- Navigation alone must not confirm, invalidate, or advance durable workflow state.
- Preserve local input across revision conflicts and show the newest server state before asking the tutor to reconcile.
- Treat `AssignmentSessionDto.confirmed` as a validated public contract, not an open JSON extension point.
- Every session recovery write, confirmation, Share link, and archive uses compare-and-swap revision semantics.
- Transcript and draft content revisions are immutable. Never overwrite a storage object reachable through a revision record.
- The server computes content hashes and validates artifact ownership and lineage; clients only echo server-issued revision IDs.
- Existing shared handouts remain immutable history. Invalidation only clears the active session lineage.
- Share success means one approved/enqueued job is durably linked to the session. Archival is idempotent cleanup after success.
- Remove the old assignment-session create/PATCH routes and revisionless transcript/draft update contracts in the same major release.
- Keep code, `packages/batch-backend/README.md`, `packages/batch-frontend/README.md`, and backend/frontend alignment docs synchronized.
- Use the existing `:agent` validation lanes where available and inspect their log artifacts before widening a failed run.

---

## Planned File Structure

### Public contracts and versioning

- Modify: `packages/contracts/src/index.ts` - confirmed snapshot, content-revision, recovery, confirmation, Share, and conflict DTOs.
- Modify: `packages/contracts/src/contract-versions.ts` - API major bump, DB minor bump, and migration head.
- Create: `packages/batch-backend/tests/contracts.assignment-confirmation-version.test.ts` - exact API version assertion.
- Modify: `packages/batch-backend/tests/contracts.db-contract-version.test.ts` - exact DB version and head assertions.

### Database and backend domain

- Create: `packages/batch-backend/migrations/0044_assignment_step_confirmation_contract.sql` - session revision/snapshot columns, immutable artifact revisions, CAS heads, and Share-attempt ledger.
- Modify: `packages/batch-backend/schema.sql` - regenerated schema baseline.
- Modify: `packages/batch-backend/src/domain/assignment-session-model.ts` - working/confirmed aggregate model.
- Modify: `packages/batch-backend/src/domain/assignment-session-repository.ts` - revision-aware transactional mutations and archive.
- Create: `packages/batch-backend/src/domain/artifact-content-revision-model.ts` - shared immutable revision record types.
- Create: `packages/batch-backend/src/domain/artifact-content-revision-repository.ts` - transcript/draft revision insert, lookup, and head CAS.
- Create: `packages/batch-backend/src/domain/assignment-share-attempt-model.ts` - Share state machine types.
- Create: `packages/batch-backend/src/domain/assignment-share-attempt-repository.ts` - reservation and monotonic state transitions.
- Modify: `packages/batch-backend/src/infrastructure/transcription-storage.ts` - revision-specific transcript/draft storage keys.

### Backend application and transport

- Modify: `packages/batch-backend/src/application/assignment-sessions.ts` - student confirmation and recovery commands.
- Create: `packages/batch-backend/src/application/confirm-assignment-session-step.ts` - Source, Context, and Create validation/invalidation.
- Create: `packages/batch-backend/src/application/share-assignment-session.ts` - resumable Share orchestration and cleanup.
- Modify: `packages/batch-backend/src/application/update-recording-transcript.ts` - immutable transcript revision CAS.
- Modify: `packages/batch-backend/src/application/update-draft.ts` - immutable draft revision CAS.
- Modify: `packages/batch-backend/src/application/process-transcribe-job.ts` - initial transcript revision.
- Modify: `packages/batch-backend/src/application/ingest-manual-transcript-source.ts` - initial manual transcript revision.
- Modify: `packages/batch-backend/src/application/create-draft.ts` - initial draft revision.
- Modify: `packages/batch-backend/src/application/create-prompt-package.ts` - exact profile revision input.
- Modify: `packages/batch-backend/src/application/approve-job.ts` - retry-aware enqueue of the stable reserved job.
- Modify: `packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts` - student, recovery, confirm, Share, and revision-aware archive routes.
- Modify: `packages/batch-backend/src/transport/extended-routes/recordings-routes.ts` - revision-aware transcript, draft, and prompt-package requests.

### Frontend API and workflow

- Modify: `packages/batch-frontend/src/utils/api.ts` - new session commands and content revision request/response shapes.
- Create: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.confirmation.ts` - pure confirmation, dirty-state, resume, and conflict decisions.
- Create: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.confirmation.test.ts` - exhaustive pure contract tests.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx` - session revision coordinator, confirmation actions, route guard, and global save state.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.source.ts` - automatic Source recovery and confirmation flush.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.authoring.ts` - Context/Create recovery and confirmation flush, Share orchestration.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume.ts` - earliest-dirty hydration and Share cleanup recovery.
- Modify: `packages/batch-frontend/src/ui/assignments/assignment-workflow.ts` - confirmed-step status derivation.
- Modify: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.tsx` - saving/confirmed/conflict presentation without manual Save/Refresh.
- Modify: `packages/batch-frontend/src/dev/frontend-sandbox-api.ts` - sandbox parity for revisioned APIs.

### Tests and documentation

- Modify: `packages/batch-backend/tests/domain.assignment-session-repository.test.ts`.
- Create: `packages/batch-backend/tests/domain.artifact-content-revision-repository.test.ts`.
- Create: `packages/batch-backend/tests/domain.assignment-share-attempt-repository.test.ts`.
- Modify: `packages/batch-backend/tests/application.recording-transcript.test.ts`.
- Modify: `packages/batch-backend/tests/application.draft.test.ts`.
- Modify: `packages/batch-backend/tests/application.process-transcribe-job.test.ts`.
- Modify: `packages/batch-backend/tests/application.ingest-manual-transcript-source.test.ts`.
- Modify: `packages/batch-backend/tests/transport.http-server.integration.recordings-prompt-packages.test.ts`.
- Create: `packages/batch-backend/tests/application.assignment-step-confirmation.test.ts`.
- Create: `packages/batch-backend/tests/application.assignment-share.test.ts`.
- Modify: `packages/batch-backend/tests/application.student-schedule-billing.test.ts`.
- Create: `packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts`.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.test-harness.tsx`.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx`.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx`.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx`.
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx`.
- Modify: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.navigation.test.tsx`.
- Modify: `packages/batch-frontend/src/ui/assignments/assignment-workflow.test.ts`.
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

- [ ] **Step 1: Write failing contract-version and migration tests**

Add exact assertions for API `4.0.0`, DB `0.23.0`, and migration head `0044_assignment_step_confirmation_contract`. Seed active and archived pre-cutover sessions plus a completed job with a published handout and referenced transcript/draft rows. Assert the migration removes every assignment session, retains the completed job/output references, and does not fabricate content revisions for historical artifacts.

```ts
expect(API_CONTRACT_VERSION).toBe('4.0.0');
expect(DB_CONTRACT_VERSION).toBe('0.23.0');
expect(DB_MIGRATION_HEAD).toBe('0044_assignment_step_confirmation_contract');

expect(await countRows('assignment_sessions')).toBe(0);
expect(await findJob(completedJobId)).toMatchObject({ html_url: publishedUrl });
expect((await findTranscript(historicalTranscriptId)).head_revision_id).toBeNull();
expect((await findDraft(historicalDraftId)).head_revision_id).toBeNull();
expect(await countRows('transcript_content_revisions')).toBe(0);
expect(await countRows('draft_content_revisions')).toBe(0);
```

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/contracts.assignment-confirmation-version.test.ts tests/contracts.db-contract-version.test.ts tests/integration.migrations.test.ts tests/domain.assignment-session-repository.test.ts
```

Expected: version assertions report the current `3.1.0`/`0.22.0`/`0043` values and migration fixtures fail because the new columns do not exist.

- [ ] **Step 3: Add the exact contract types**

Add the approved discriminated contracts to `packages/contracts/src/index.ts`:

```ts
export type AssignmentConfirmedStep = 'student' | 'source' | 'context' | 'create' | 'share';

export type AssignmentInvalidatedArtifact =
  | 'transcript'
  | 'prompt'
  | 'draft'
  | 'preview'
  | 'publishedJob';

export interface ArtifactContentRevisionDto {
  id: string;
  artifactId: string;
  storageUri: string;
  contentHash: string;
  createdAt: string;
}

export interface AssignmentConfirmedSnapshot {
  student: { studentId: string } | null;
  source: {
    lessonId: string | null;
    recordingId: string;
    transcriptId: string;
    transcriptRevisionId: string;
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
    draftRevisionId: string;
    draftHash: string;
  } | null;
  share: { jobId: string; approvedAt: string; requestId: string } | null;
}

export interface UpdateAssignmentSessionRecoveryRequest {
  expectedRevision: number;
  patch: Partial<{
    lessonId: string | null;
    recordingId: string | null;
    transcriptId: string | null;
    transcriptContentRevisionId: string | null;
    promptPackageId: string | null;
    draftId: string | null;
    draftContentRevisionId: string | null;
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
      transcriptRevisionId: string;
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
      draftRevisionId: string;
    };
```

Extend `AssignmentSessionDto` with the approved revision and confirmed fields. Define `ConfirmStudentAssignmentSessionRequest`, `ConfirmAssignmentSessionStepResponse`, `ConfirmAssignmentSessionShareRequest`, and a `RevisionConflictResponse` containing the latest session.

- [ ] **Step 4: Add the migration and version bump**

Create the migration with:

- delete all rows from `assignment_sessions` before enabling the replacement contract;
- session `revision`, `confirmed_step`, validated `confirmed_snapshot`, `creation_request_id`, artifact head references, and selected profile revision fields;
- `transcript_content_revisions` and `draft_content_revisions` with immutable UUID primary keys, artifact foreign keys, unique revision-specific storage URIs, SHA-256 hashes, and timestamps;
- nullable `head_revision_id` foreign keys on `transcripts` and `drafts`;
- `assignment_session_share_attempts` with unique `(session_id, request_id)`, one stable `job_id`, and a checked state enum;
- a partial unique index on `(user_id, creation_request_id)` where the request ID is non-null;
- nullable artifact head columns solely for historical rows referenced by completed jobs; the
  application contract requires non-null heads for every new editable artifact.

Use this canonical empty snapshot for every newly created session:

```sql
'{"student":null,"source":null,"context":null,"create":null,"share":null}'::jsonb
```

Add check constraints for `revision > 0`, confirmed-step values, 64-character lowercase SHA-256 hashes, and monotonic Share states represented by the exact strings `reserved`, `materialized`, `approved`, `enqueued`, and `linked`.

- [ ] **Step 5: Run migration and contract tests**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/contracts.assignment-confirmation-version.test.ts tests/contracts.db-contract-version.test.ts tests/integration.migrations.test.ts tests/domain.assignment-session-repository.test.ts
```

Expected: all focused tests pass, including total session cutover, preserved completed outputs, and zero promoted historical artifact revisions.

- [ ] **Step 6: Commit the contract boundary**

```bash
git add packages/contracts/src/index.ts packages/contracts/src/contract-versions.ts packages/batch-backend/tests/contracts.assignment-confirmation-version.test.ts packages/batch-backend/tests/contracts.db-contract-version.test.ts packages/batch-backend/migrations/0044_assignment_step_confirmation_contract.sql packages/batch-backend/tests/integration.migrations.test.ts packages/batch-backend/tests/domain.assignment-session-repository.test.ts
git commit -m "feat(contracts): add assignment confirmation revisions"
```

## Task 2: Make transcript and draft content immutable and compare-and-swap safe

**Files:**

- Create: `packages/batch-backend/src/domain/artifact-content-revision-model.ts`
- Create: `packages/batch-backend/src/domain/artifact-content-revision-repository.ts`
- Modify: `packages/batch-backend/src/domain/transcript-model.ts`
- Modify: `packages/batch-backend/src/domain/draft-model.ts`
- Modify: `packages/batch-backend/src/infrastructure/transcription-storage.ts`
- Modify: `packages/batch-backend/src/application/process-transcribe-job.ts`
- Modify: `packages/batch-backend/src/application/ingest-manual-transcript-source.ts`
- Modify: `packages/batch-backend/src/application/create-draft.ts`
- Modify: `packages/batch-backend/src/application/update-recording-transcript.ts`
- Modify: `packages/batch-backend/src/application/update-draft.ts`
- Modify: `packages/batch-backend/src/transport/extended-routes/recordings-routes.ts`
- Create: `packages/batch-backend/tests/domain.artifact-content-revision-repository.test.ts`
- Modify: `packages/batch-backend/tests/infrastructure.transcription-storage.test.ts`
- Modify: `packages/batch-backend/tests/application.recording-transcript.test.ts`
- Modify: `packages/batch-backend/tests/application.draft.test.ts`
- Modify: `packages/batch-backend/tests/application.process-transcribe-job.test.ts`
- Modify: `packages/batch-backend/tests/application.ingest-manual-transcript-source.test.ts`
- Modify: `packages/batch-backend/tests/transport.http-server.integration.recordings-prompt-packages.test.ts`

- [ ] **Step 1: Write failing immutable-storage and CAS tests**

Cover these cases for both transcript and draft content:

1. generated and manually ingested transcripts create an initial revision and head atomically;
2. draft creation creates an initial revision and head atomically;
3. next write uses a different storage URI and advances the head;
4. stale expected head returns a typed conflict and preserves the winning head;
5. both old and new revision text remain readable;
6. the response contains the server-computed SHA-256 hash;
7. updating a historical artifact with a null head is rejected instead of initializing it.
8. cached-recording reuse bypasses an unrevisioned historical transcript and never clones its null
   head into a new artifact.

```ts
const draft = await createDraft({ promptPackageId, text: 'first', userId });
const first = draft.contentRevision;
const second = await updateDraft({
  id: draft.id,
  text: 'second',
  expectedRevisionId: first.id,
});

await expect(
  updateDraft({ id: draft.id, text: 'stale', expectedRevisionId: first.id }),
).rejects.toMatchObject({ code: 'ARTIFACT_REVISION_CONFLICT' });
await expect(
  updateDraft({ id: historicalDraft.id, text: 'legacy edit', expectedRevisionId: null }),
).rejects.toMatchObject({ code: 'HISTORICAL_ARTIFACT_NOT_EDITABLE' });
expect(await storage.getText(first.storageUri)).toBe('first');
expect(await storage.getText(second.contentRevision.storageUri)).toBe('second');
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/domain.artifact-content-revision-repository.test.ts tests/infrastructure.transcription-storage.test.ts tests/application.recording-transcript.test.ts tests/application.draft.test.ts tests/application.process-transcribe-job.test.ts tests/application.ingest-manual-transcript-source.test.ts tests/transport.http-server.integration.recordings-prompt-packages.test.ts
```

Expected: tests fail because creation paths return unrevisioned artifacts, storage uses stable artifact IDs, and historical null-head artifacts are still editable.

- [ ] **Step 3: Add revision-specific storage methods**

Change transcript and draft write options to identify both artifact and revision:

```ts
export interface PutTranscriptOptions {
  transcriptId: string;
  revisionId: string;
  text: string;
}

export interface PutDraftOptions {
  draftId: string;
  revisionId: string;
  text: string;
}
```

Filesystem and S3 keys must be `transcripts/<transcriptId>/<revisionId>.txt` and `drafts/<draftId>/<revisionId>.md`. Compute and return SHA-256 for text writes in both adapters.

- [ ] **Step 4: Implement one transactional content-revision repository boundary**

Expose focused functions rather than allowing callers to update head columns directly:

```ts
export interface CreateArtifactContentRevisionParams {
  artifactId: string;
  revisionId: string;
  expectedRevisionId: string | null;
  storageUri: string;
  contentHash: string;
}

export async function commitTranscriptContentRevision(
  params: CreateArtifactContentRevisionParams,
): Promise<ArtifactContentRevisionRecord>;

export async function commitDraftContentRevision(
  params: CreateArtifactContentRevisionParams,
): Promise<ArtifactContentRevisionRecord>;
```

Within one database transaction, lock the parent artifact, compare its current head with `expectedRevisionId`, insert the immutable revision, and conditionally swap the head. Throw `ArtifactRevisionConflictError` with the current head when comparison fails. Do not delete an already-written storage object on conflict; it is unreachable and safe for later garbage collection.

- [ ] **Step 5: Update application and transport contracts**

Generated transcription, manual transcript ingestion, and draft creation must write revision-specific storage, insert the parent plus initial immutable revision, and set the head as one application operation. If database persistence fails after storage succeeds, the object is unreachable and eligible for cleanup.

Cached-recording reuse may clone only a transcript with a non-null immutable head. The clone gets a
new transcript ID, revision ID, and revision-specific storage object; it must not share the source
transcript's mutable identity. A cache hit containing an unrevisioned historical transcript is
ignored and follows the ordinary transcription path.

`PUT /recordings/:recordingId/transcript` and `PUT /drafts/:id` require a non-null `expectedRevisionId`. Each update service creates a revision UUID, writes the immutable object, commits the CAS, and returns `contentRevision`. A null current head produces `HISTORICAL_ARTIFACT_NOT_EDITABLE`; it never creates a first revision. Remove revisionless update acceptance and return HTTP 409 with the current head revision on conflict.

- [ ] **Step 6: Run the focused tests and typecheck**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/domain.artifact-content-revision-repository.test.ts tests/infrastructure.transcription-storage.test.ts tests/application.recording-transcript.test.ts tests/application.draft.test.ts tests/application.process-transcribe-job.test.ts tests/application.ingest-manual-transcript-source.test.ts tests/transport.http-server.integration.recordings-prompt-packages.test.ts
pnpm --filter @esl-pipeline/batch-backend typecheck
```

Expected: all focused tests and backend typecheck pass.

- [ ] **Step 7: Commit immutable artifact revisions**

```bash
git add packages/batch-backend/src/domain/artifact-content-revision-model.ts packages/batch-backend/src/domain/artifact-content-revision-repository.ts packages/batch-backend/src/domain/transcript-model.ts packages/batch-backend/src/domain/draft-model.ts packages/batch-backend/src/infrastructure/transcription-storage.ts packages/batch-backend/src/application/process-transcribe-job.ts packages/batch-backend/src/application/ingest-manual-transcript-source.ts packages/batch-backend/src/application/create-draft.ts packages/batch-backend/src/application/update-recording-transcript.ts packages/batch-backend/src/application/update-draft.ts packages/batch-backend/src/transport/extended-routes/recordings-routes.ts packages/batch-backend/tests/domain.artifact-content-revision-repository.test.ts packages/batch-backend/tests/infrastructure.transcription-storage.test.ts packages/batch-backend/tests/application.recording-transcript.test.ts packages/batch-backend/tests/application.draft.test.ts packages/batch-backend/tests/application.process-transcribe-job.test.ts packages/batch-backend/tests/application.ingest-manual-transcript-source.test.ts packages/batch-backend/tests/transport.http-server.integration.recordings-prompt-packages.test.ts
git commit -m "feat(backend): persist immutable artifact revisions"
```

## Task 3: Implement the revisioned assignment-session aggregate

**Files:**

- Modify: `packages/batch-backend/src/domain/assignment-session-model.ts`
- Modify: `packages/batch-backend/src/domain/assignment-session-repository.ts`
- Modify: `packages/batch-backend/src/application/assignment-sessions.ts`
- Modify: `packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts`
- Modify: `packages/batch-backend/tests/domain.assignment-session-repository.test.ts`
- Modify: `packages/batch-backend/tests/application.student-schedule-billing.test.ts`
- Create: `packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts`

- [ ] **Step 1: Write failing student-idempotency, recovery-CAS, and archive-CAS tests**

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

Also assert recovery cannot accept canonical fields such as `currentStage`, `confirmedStep`, or `confirmed`, and archive increments the expected revision exactly once.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/domain.assignment-session-repository.test.ts tests/application.student-schedule-billing.test.ts tests/transport.http-server.integration.assignment-sessions.test.ts
```

Expected: tests fail because the repository accepts revisionless patches and the routes do not exist.

- [ ] **Step 3: Extend the session model and mapper**

Add `revision`, content revision heads, selected profile identity, `confirmedStep`, `confirmed`, and `creationRequestId` to the domain record. Parse `confirmed_snapshot` through a Zod schema at the repository boundary so malformed database JSON fails closed.

- [ ] **Step 4: Replace generic patching with explicit CAS repository commands**

Expose:

```ts
export async function updateAssignmentSessionRecovery(
  params: UpdateAssignmentSessionRecoveryParams,
): Promise<AssignmentSessionRecord>;

export async function archiveAssignmentSession(params: {
  id: string;
  userId: string;
  expectedRevision: number;
}): Promise<AssignmentSessionRecord>;
```

Both updates must include:

```sql
WHERE id = $1
  AND user_id = $2
  AND archived_at IS NULL
  AND revision = $3
```

and atomically set `revision = revision + 1`. When no row is returned, load by ownership including archived rows and distinguish not found, archived, and revision conflict.

- [ ] **Step 5: Add idempotent Student confirmation and new routes**

Implement `POST /assignment-sessions/confirm-student`, `PATCH /assignment-sessions/:id/recovery`, and revision-aware archive. Remove both `POST /assignment-sessions` and `PATCH /assignment-sessions/:id`; integration tests assert the old routes are unavailable. Repeated `(userId, requestId)` with identical Student and lesson recovery data returns the existing session; different data returns 409.

- [ ] **Step 6: Run tests and backend typecheck**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/domain.assignment-session-repository.test.ts tests/application.student-schedule-billing.test.ts tests/transport.http-server.integration.assignment-sessions.test.ts
pnpm --filter @esl-pipeline/batch-backend typecheck
```

Expected: focused tests pass and no caller references the removed generic patch function.

- [ ] **Step 7: Commit the revisioned session aggregate**

```bash
git add packages/batch-backend/src/domain/assignment-session-model.ts packages/batch-backend/src/domain/assignment-session-repository.ts packages/batch-backend/src/application/assignment-sessions.ts packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts packages/batch-backend/tests/domain.assignment-session-repository.test.ts packages/batch-backend/tests/application.student-schedule-billing.test.ts packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts
git commit -m "feat(backend): revision assignment session recovery"
```

## Task 4: Confirm Source, Context, and Create transactionally

**Files:**

- Create: `packages/batch-backend/src/application/confirm-assignment-session-step.ts`
- Modify: `packages/batch-backend/src/domain/assignment-session-repository.ts`
- Modify: `packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts`
- Create: `packages/batch-backend/tests/application.assignment-step-confirmation.test.ts`
- Modify: `packages/batch-backend/tests/domain.assignment-session-repository.test.ts`
- Modify: `packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts`

- [ ] **Step 1: Write the failing confirmation matrix**

For each step, cover success, missing prerequisite, wrong owner, broken lineage, stale session revision, stale artifact head, idempotent lost-response replay, and exact downstream invalidation. Include the invariant that confirmation and recovery cannot race to a last-writer-wins result.

```ts
expect(sourceResult.session.currentStage).toBe('context');
expect(sourceResult.session.confirmed.source?.transcriptHash).toBe(transcriptRevision.contentHash);
expect(sourceResult.invalidated).toEqual(['prompt', 'draft', 'preview', 'publishedJob']);

await expect(confirmAssignmentSessionStep(staleRequest)).rejects.toMatchObject({
  code: 'ASSIGNMENT_SESSION_REVISION_CONFLICT',
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/application.assignment-step-confirmation.test.ts tests/domain.assignment-session-repository.test.ts tests/transport.http-server.integration.assignment-sessions.test.ts
```

Expected: new test file fails to import the missing application service.

- [ ] **Step 3: Implement explicit validation by discriminator**

`confirmAssignmentSessionStep` must:

1. load the owned active session at `expectedRevision`;
2. validate the immediately preceding confirmed boundary;
3. validate artifact ownership and complete lineage;
4. require the supplied transcript/draft revision to equal the artifact's current head;
5. load the server-computed content hash;
6. calculate the confirmed snapshot and exact invalidation list;
7. commit confirmed snapshot, working references, `confirmedStep`, `currentStage`, and `revision + 1` in one transaction.

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

| Changed confirmed input     | Clear confirmed snapshots | Resulting stage |
| --------------------------- | ------------------------- | --------------- |
| lesson/recording/transcript | context, create, share    | context         |
| notes/profile revision      | create, share             | assignment      |
| prompt/draft revision       | share                     | review          |

Clear active working references only when they derive from an invalidated lineage. Never archive/delete historical jobs or immutable artifact revisions.

- [ ] **Step 5: Add `POST /assignment-sessions/:id/confirm`**

Validate the discriminated body, map typed domain failures to 400/403/404/409, and return `ConfirmAssignmentSessionStepResponse`. Do not accept hashes from the request.

- [ ] **Step 6: Run focused backend verification**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/application.assignment-step-confirmation.test.ts tests/domain.assignment-session-repository.test.ts tests/transport.http-server.integration.assignment-sessions.test.ts
pnpm --filter @esl-pipeline/batch-backend typecheck
```

Expected: confirmation matrix, repository atomicity tests, transport tests, and typecheck pass.

- [ ] **Step 7: Commit semantic confirmation**

```bash
git add packages/batch-backend/src/application/confirm-assignment-session-step.ts packages/batch-backend/src/domain/assignment-session-repository.ts packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts packages/batch-backend/tests/application.assignment-step-confirmation.test.ts packages/batch-backend/tests/domain.assignment-session-repository.test.ts packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts
git commit -m "feat(backend): confirm assignment steps atomically"
```

## Task 5: Pin prompt generation to the confirmed profile revision

**Files:**

- Modify: `packages/batch-backend/src/application/create-prompt-package.ts`
- Modify: `packages/batch-backend/src/transport/extended-routes/recordings-routes.ts`
- Modify: `packages/batch-backend/tests/application.prompt-package.resolution.test.ts`
- Modify: `packages/batch-backend/tests/application.prompt-package.lineage-drift.test.ts`
- Modify: `packages/batch-backend/tests/transport.http-server.integration.recordings-prompt-packages.test.ts`
- Modify: `packages/batch-frontend/src/utils/api.ts`

- [ ] **Step 1: Write failing exact-profile-revision tests**

Create two profile revisions for the same learner, confirm the first, activate the second, then generate. Assert the prompt package records and renders the first revision. Add rejection tests for a revision owned by another profile/student and for a request that supplies only `profileId`.

```ts
const result = await createPromptPackage({
  recordingId,
  transcriptId,
  studentId,
  profileId,
  profileRevisionId: confirmedRevision.id,
  userId,
});

expect(result.resolvedProfileRevisionId).toBe(confirmedRevision.id);
expect(result.text).toContain(confirmedRevision.marker);
expect(result.text).not.toContain(newActiveRevision.marker);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/application.prompt-package.resolution.test.ts tests/application.prompt-package.lineage-drift.test.ts tests/transport.http-server.integration.recordings-prompt-packages.test.ts
```

Expected: generation resolves the newly active revision instead of the supplied confirmed revision.

- [ ] **Step 3: Require and validate the exact revision**

Change authenticated assignment generation to accept `profileRevisionId: string | null` alongside `profileId`. When a profile is selected, both IDs are required and must belong to the confirmed learner. When no profile is selected, both are null. Load that revision directly and retain `resolvedProfileRevisionId` in the prompt-package record.

- [ ] **Step 4: Update the frontend API request type**

Make `createPromptPackage` require the exact nullable pair and remove code that assumes the backend will resolve the current active profile implicitly.

- [ ] **Step 5: Run focused tests and typechecks**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/application.prompt-package.resolution.test.ts tests/application.prompt-package.lineage-drift.test.ts tests/transport.http-server.integration.recordings-prompt-packages.test.ts
pnpm --filter @esl-pipeline/batch-backend typecheck
pnpm --filter @esl-pipeline/batch-frontend typecheck
```

Expected: the exact-revision tests and both package typechecks pass.

- [ ] **Step 6: Commit profile revision pinning**

```bash
git add packages/batch-backend/src/application/create-prompt-package.ts packages/batch-backend/src/transport/extended-routes/recordings-routes.ts packages/batch-backend/tests/application.prompt-package.resolution.test.ts packages/batch-backend/tests/application.prompt-package.lineage-drift.test.ts packages/batch-backend/tests/transport.http-server.integration.recordings-prompt-packages.test.ts packages/batch-frontend/src/utils/api.ts
git commit -m "fix(generation): pin confirmed profile revision"
```

## Task 6: Make Share a durable resumable state machine

**Files:**

- Create: `packages/batch-backend/src/domain/assignment-share-attempt-model.ts`
- Create: `packages/batch-backend/src/domain/assignment-share-attempt-repository.ts`
- Create: `packages/batch-backend/src/application/share-assignment-session.ts`
- Modify: `packages/batch-backend/src/application/materialize-draft.ts`
- Modify: `packages/batch-backend/src/application/approve-job.ts`
- Modify: `packages/batch-backend/src/domain/assignment-session-repository.ts`
- Modify: `packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts`
- Create: `packages/batch-backend/tests/domain.assignment-share-attempt-repository.test.ts`
- Create: `packages/batch-backend/tests/application.assignment-share.test.ts`
- Modify: `packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts`

- [ ] **Step 1: Write failing interruption and idempotency tests**

Use injectable orchestration boundaries to stop after each durable phase: reservation, materialization, approval, enqueue, session link, response loss, and archive failure. Resume with the same request ID and assert exactly one job, one materialization, one approval transition, one stable BullMQ job ID, and one session link.

```ts
for (const stopAfter of ['reserved', 'materialized', 'approved', 'enqueued', 'linked'] as const) {
  const harness = createShareHarness({ stopAfter });
  await expect(harness.firstAttempt()).rejects.toThrow('simulated interruption');
  const recovered = await harness.retrySameRequest();
  expect(recovered.session.confirmed.share?.jobId).toBe(harness.reservedJobId);
  expect(harness.createdJobIds).toEqual([harness.reservedJobId]);
  expect(harness.enqueuedJobIds).toEqual([harness.reservedJobId]);
}
```

Also assert Share rejects if any Source, Context, or Create recovery field differs from its confirmed snapshot.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/domain.assignment-share-attempt-repository.test.ts tests/application.assignment-share.test.ts tests/transport.http-server.integration.assignment-sessions.test.ts
```

Expected: missing modules fail to import and current materialization/approval creates side effects without an attempt ledger.

- [ ] **Step 3: Implement monotonic attempt persistence**

Use the explicit rank ordering below and reject regressions:

```ts
export const SHARE_ATTEMPT_STATES = [
  'reserved',
  'materialized',
  'approved',
  'enqueued',
  'linked',
] as const;

export type AssignmentShareAttemptState = (typeof SHARE_ATTEMPT_STATES)[number];

export function canAdvanceShareAttempt(
  current: AssignmentShareAttemptState,
  next: AssignmentShareAttemptState,
): boolean {
  return SHARE_ATTEMPT_STATES.indexOf(next) >= SHARE_ATTEMPT_STATES.indexOf(current);
}
```

Reservation commits `(sessionId, requestId, stableJobId)` before any job or queue side effect. Lookup must include archived sessions and enforce user ownership.

- [ ] **Step 4: Implement resumable Share orchestration**

`shareAssignmentSession` loads or creates the attempt and resumes from its persisted state:

1. `reserved`: materialize the confirmed draft into the reserved job ID;
2. `materialized`: approve that job;
3. `approved`: enqueue with BullMQ `jobId` equal to the reserved job ID;
4. `enqueued`: transactionally link the job in `confirmed.share`, increment session revision, and mark linked;
5. `linked`: return the linked result without repeating side effects;
6. after success, call revision-aware idempotent archive as cleanup.

Make `approveJob` retry-aware: a job already in the queued database state may be enqueued again with the same BullMQ job ID, but must not be cloned or re-approved.

- [ ] **Step 5: Add the Share route and typed responses**

Add `POST /assignment-sessions/:id/share`. A completed attempt returns the linked job even if the session has since been archived. A cleanup failure returns Share success plus `archivePending: true`, not an error that invites a duplicate Share.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/domain.assignment-share-attempt-repository.test.ts tests/application.assignment-share.test.ts tests/transport.http-server.integration.assignment-sessions.test.ts
pnpm --filter @esl-pipeline/batch-backend typecheck
```

Expected: every interruption point resumes to one linked job and all dirty-upstream Share requests fail closed.

- [ ] **Step 7: Commit crash-safe Share**

```bash
git add packages/batch-backend/src/domain/assignment-share-attempt-model.ts packages/batch-backend/src/domain/assignment-share-attempt-repository.ts packages/batch-backend/src/application/share-assignment-session.ts packages/batch-backend/src/application/materialize-draft.ts packages/batch-backend/src/application/approve-job.ts packages/batch-backend/src/domain/assignment-session-repository.ts packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts packages/batch-backend/tests/domain.assignment-share-attempt-repository.test.ts packages/batch-backend/tests/application.assignment-share.test.ts packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts
git commit -m "feat(backend): make assignment share retry safe"
```

## Task 7: Build the frontend confirmation state machine and API client

**Files:**

- Modify: `packages/batch-frontend/src/utils/api.ts`
- Create: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.confirmation.ts`
- Create: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.confirmation.test.ts`
- Modify: `packages/batch-frontend/src/ui/assignments/assignment-workflow.ts`
- Modify: `packages/batch-frontend/src/ui/assignments/assignment-workflow.test.ts`
- Modify: `packages/batch-frontend/src/dev/frontend-sandbox-api.ts`
- Modify: `packages/batch-frontend/src/dev/frontend-sandbox-api.test.ts`

- [ ] **Step 1: Write failing pure workflow tests**

Cover confirmed completion, dirty recovery, earliest dirty step, permissible forward navigation, Share blocking, invalidation, and conflict reconciliation. Readiness booleans must not mark a step complete.

```ts
expect(deriveAssignmentWorkflow(sessionWithReadyUnconfirmedDraft).create.status).toBe('current');
expect(findResumeStep(sessionWithDirtySourceAndConfirmedCreate)).toBe('source');
expect(canNavigateToStep(sessionWithDirtyContext, 'review')).toBe(false);
expect(canShareAssignment(sessionWithDirtyContext)).toEqual({
  allowed: false,
  reason: 'Confirm Teaching context before sharing.',
});
```

- [ ] **Step 2: Run pure tests and verify failure**

Run:

```bash
pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.confirmation.test.ts src/ui/assignments/assignment-workflow.test.ts src/dev/frontend-sandbox-api.test.ts
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

Update transcript/draft functions to require `expectedRevisionId`. Delete the obsolete `createAssignmentSession` and `updateAssignmentSession` client exports, then match sandbox behavior to production semantics.

- [ ] **Step 4: Implement pure state derivation**

`MinimalAssignment.confirmation.ts` owns:

- content-normalized equality for notes and nullable IDs;
- per-step dirty comparison between working fields and `confirmed` snapshots;
- earliest dirty resume selection in Student → Source → Context → Create order;
- forward-navigation and Share guards;
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
```

- [ ] **Step 5: Derive visible workflow status only from confirmed snapshots**

Keep the existing visible stages but map completion from `confirmedStep`; use dirty state to select the current step. A later confirmed snapshot never allows forward navigation past an earlier dirty recovery step.

- [ ] **Step 6: Run pure tests and frontend typecheck**

Run:

```bash
pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.confirmation.test.ts src/ui/assignments/assignment-workflow.test.ts src/dev/frontend-sandbox-api.test.ts
pnpm --filter @esl-pipeline/batch-frontend typecheck
```

Expected: state derivation, API parity, and typecheck pass.

- [ ] **Step 7: Commit the frontend contract layer**

```bash
git add packages/batch-frontend/src/utils/api.ts packages/batch-frontend/src/ui/minimal/MinimalAssignment.confirmation.ts packages/batch-frontend/src/ui/minimal/MinimalAssignment.confirmation.test.ts packages/batch-frontend/src/ui/assignments/assignment-workflow.ts packages/batch-frontend/src/ui/assignments/assignment-workflow.test.ts packages/batch-frontend/src/dev/frontend-sandbox-api.ts packages/batch-frontend/src/dev/frontend-sandbox-api.test.ts
git commit -m "feat(frontend): derive confirmed assignment workflow"
```

## Task 8: Wire Student, Source, and Context automatic recovery and confirmation

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.source.ts`
- Modify: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.test-harness.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx`
- Modify: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.navigation.test.tsx`

- [ ] **Step 1: Write failing Step 1-3 journey tests**

Cover:

- Student Continue creates one idempotent session and enters Source;
- Source Continue first flushes transcript, then confirms its returned revision;
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
pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx src/ui/assignments/AssignmentWorkflow.navigation.test.tsx
```

Expected: old generic session mutation calls and navigation-only Source advancement violate the new assertions.

- [ ] **Step 3: Add one serialized session revision coordinator**

In `MinimalAssignment.tsx`, keep the latest returned session in a ref as well as state so queued automatic recovery always reads the newest revision. Serialize session mutations; coalesce superseded recovery patches but never coalesce semantic confirmations. On 409, fetch the latest session, run the pure reconciliation decision, and retain local buffers when they differ.

- [ ] **Step 4: Implement Student and Source confirmation**

Student Continue creates one UUID per attempt and reuses it until success or explicit learner change. Source automatic recovery persists lesson/source identities. Source Continue awaits any pending transcript autosave, uses the returned transcript revision ID, then calls `confirmAssignmentSessionStep`. Only the successful response changes the visible confirmed boundary.

- [ ] **Step 5: Implement Context recovery and confirmation**

Debounce notes/profile recovery at the existing autosave cadence. Context Continue flushes the latest recovery patch and confirms the exact profile ID/revision/hash. Selecting a different profile revision marks Context dirty but does not immediately invalidate Create or Share.

- [ ] **Step 6: Remove manual persistence responsibility and present honest status**

Remove Source Save/Refresh affordances. `AssignmentWorkflow` renders `Saving…`, `All changes saved`, `Confirmation failed`, or conflict text from the coordinator. It must never infer `saved` merely because an active session exists.

- [ ] **Step 7: Run focused tests and frontend typecheck**

Run:

```bash
pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx src/ui/assignments/AssignmentWorkflow.navigation.test.tsx
pnpm --filter @esl-pipeline/batch-frontend typecheck
```

Expected: Step 1-3 journeys, retry/conflict cases, and typecheck pass.

- [ ] **Step 8: Commit Student, Source, and Context behavior**

```bash
git add packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.source.ts packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.test-harness.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.navigation.test.tsx
git commit -m "feat(frontend): confirm assignment inputs automatically"
```

## Task 9: Wire Create, resume, navigation protection, and Share recovery

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.authoring.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume.ts`
- Modify: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.test-harness.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx`

- [ ] **Step 1: Write failing Create/Share/resume tests**

Cover:

- generation uses the confirmed profile revision;
- draft autosave returns an immutable revision and Create Continue confirms it;
- manual Save draft is absent;
- Share rejects dirty upstream recovery and uses one request ID across retries;
- response loss and archive failure still show completed Share and never duplicate a job;
- refresh at every boundary hydrates the confirmed destination;
- refresh with dirty Source/Context/Create opens the earliest dirty step;
- route exit with dirty recovery invokes the assignment-specific navigation guard;
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
pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx
```

Expected: draft save ignores artifact revision identity, Share bypasses the session ledger, and resume chooses the later stage instead of earliest dirty state.

- [ ] **Step 3: Confirm Create from the durable draft revision**

Generation consumes confirmed Student/Source/Context only. Draft autosave always carries the latest expected head revision. Create Continue flushes autosave, then confirms the exact prompt package, draft, and returned draft revision. Remove manual Save draft responsibility.

- [ ] **Step 4: Implement confirmed-input Preview and Share**

Preview reads `session.confirmed.create`, not a newer recovery draft. Share creates one UUID per logical attempt, calls the new Share route, and reuses the ID for automatic/manual retries. Treat `archivePending` as success and schedule background archive cleanup. A confirmed Share session is completed even before cleanup.

- [ ] **Step 5: Rehydrate the earliest dirty boundary**

After fetching a session, load working artifact revisions and compare them with confirmed hashes/revision IDs. Select Source before Context before Create when multiple boundaries are dirty. Never silently replace a local dirty buffer during conflict recovery.

- [ ] **Step 6: Add assignment-specific route protection**

Protect internal route changes and `beforeunload` only while unsent or unconfirmed local changes exist. The message explains that changes are being preserved automatically and asks whether to leave before confirmation; it does not ask the user to save.

- [ ] **Step 7: Run focused journeys and frontend typecheck**

Run:

```bash
pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx
pnpm --filter @esl-pipeline/batch-frontend typecheck
```

Expected: Create, Share interruption recovery, earliest-dirty resume, navigation guard, and typecheck pass.

- [ ] **Step 8: Commit Create, Share, and resume behavior**

```bash
git add packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.authoring.ts packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume.ts packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.test-harness.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.publish-actions.test-groups.tsx packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx
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

Place the journey in the existing frontend workflow test grouping and cover fresh Student → Source → Context → Create → Share, refresh at each boundary, dirty recovery at each editable boundary, cross-tab conflicts, lost responses, and Share interruption recovery. Use mocked network boundaries only where necessary to simulate response loss; keep pure state rules in the dedicated helper tests.

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
- hard deletion of pre-cutover sessions and absence of legacy resume/edit compatibility;
- preservation of completed jobs, handouts, published URLs, and their required read-only artifacts;
- mandatory initial revisions for every new transcript and draft;
- exact session/artifact revision contracts and 409 handling;
- removal of routine Save/Refresh responsibility;
- earliest-dirty resume and forward-navigation blocking;
- immutable historical handouts and explicit republish;
- Share attempt states and archive cleanup semantics;
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
```

Expected: no whitespace errors, no accidental placeholders, no remaining revisionless session PATCH usage, and no routine manual Save/Refresh requirement. Inspect every placeholder-marker result and retain only unrelated established repository notes.

- [ ] **Step 8: Commit documentation and validation artifacts**

```bash
git add packages/batch-backend/README.md packages/batch-frontend/README.md docs/backend-frontend/backend-frontend-alignment.md packages/batch-backend/schema.sql docs/generated/plans-index.md docs/superpowers/plans/2026-07-18-assignment-step-confirmation-contract.md
git commit -m "docs(assignment): document confirmed step workflow"
```

If `docs/generated/plans-index.md` is unchanged, omit it from `git add` rather than forcing an empty pathspec.

---

## Completion Checklist

- [ ] All five visible steps advance only after their approved durable confirmation event.
- [ ] Every pre-cutover assignment session is removed and no legacy resume/hydration branch exists.
- [ ] Completed jobs, handouts, and published URLs remain readable after cutover.
- [ ] Pre-cutover editor artifacts cannot enter a new assignment; every new transcript/draft starts with a non-null immutable revision head.
- [ ] Automatic recovery never changes confirmed truth or canonical stage.
- [ ] Transcript and draft updates use immutable revision-specific objects and CAS heads.
- [ ] Prompt generation uses the exact confirmed profile revision.
- [ ] Cross-tab conflicts preserve local input and cannot silently overwrite newer state.
- [ ] Back is non-destructive; forward navigation cannot bypass dirty unconfirmed work.
- [ ] Refresh/resume opens the earliest dirty boundary and requires no manual Refresh action.
- [ ] No routine Save action remains where the system can infer and persist the desired state.
- [ ] Historical shared handouts remain accessible after active-lineage invalidation.
- [ ] Share interruption at every durable phase resumes to exactly one linked job.
- [ ] Archive failure never converts a completed Share into a duplicate unfinished session.
- [ ] API and DB contract versions, migration head, baseline schema, READMEs, and alignment docs agree.
- [ ] Focused suites, package tests/typechecks, contract verification, baseline verification, docs checks, and broad repository gates have fresh recorded evidence.

## Inline Execution Handoff

The approved execution mode is inline. Start the implementation in this branch with `superpowers:executing-plans`, complete tasks in order, mark each checkbox only after its stated evidence passes, and stop for user input only if a discovered contract conflict would materially change the approved design.
