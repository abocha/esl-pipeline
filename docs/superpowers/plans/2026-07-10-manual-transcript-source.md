# Manual Transcript Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable, provenance-correct way to begin an assignment from pasted transcript text without fabricating an audio upload.

**Architecture:** Introduce `manual_transcript` as a recording source and `manual` as transcript provenance, store transcript text before atomically inserting its recording and transcript rows, and expose the capability through one authenticated endpoint plus the frontend API client. This plan is a prerequisite for enabling the pasted-transcript control in the Calm Studio assignment builder.

**Tech Stack:** TypeScript 6, Fastify, Zod, PostgreSQL migrations, Vitest, React frontend API client, pnpm workspace tooling.

## Global Constraints

- The endpoint accepts transcript text, not audio bytes, and never enqueues transcription.
- Recording source is exactly `manual_transcript`; transcript provider/provenance is exactly `manual`.
- `manual` is not added to selectable STT provider configuration.
- Input text is trimmed, must contain at least one non-whitespace character, and is capped at 500,000 characters.
- A student UUID is required so ownership remains explicit.
- Storage is written before the database transaction; a database failure must delete the stored transcript.
- Recording and transcript rows are committed in one PostgreSQL transaction.
- API and DB contract versions receive backward-compatible minor bumps.
- No non-OPUS audio support is introduced.

---

## File Structure

### Create

- `packages/batch-backend/migrations/0043_manual_transcript_source.sql` - expands recording-source and transcript-provider constraints.
- `packages/batch-backend/src/application/ingest-manual-transcript-source.ts` - validates, stores, and persists a manual transcript source.
- `packages/batch-backend/tests/application.ingest-manual-transcript-source.test.ts` - application success and cleanup behavior.
- `packages/batch-backend/tests/domain.recording-repository.test.ts` - transaction-bound recording insert.
- `packages/batch-backend/tests/domain.transcript-repository.test.ts` - transaction-bound transcript insert.
- `packages/batch-backend/tests/transport.http-server.integration.manual-transcript-source.test.ts` - authenticated route contract.
- `packages/batch-frontend/src/utils/api.manual-transcript-source.test.ts` - frontend client request/response contract.
- `packages/batch-backend/tests/contracts.manual-transcript-versions.test.ts` - explicit API/DB version expectations.

### Modify

- `packages/contracts/src/index.ts` - adds `TranscriptProviderId` without widening selectable `SttProviderId`.
- `packages/contracts/src/contract-versions.ts` - API/DB versions and migration head.
- `packages/batch-backend/src/domain/recording-model.ts` - adds `manual_transcript` source.
- `packages/batch-backend/src/domain/recording-repository.ts` - permits transaction-bound inserts.
- `packages/batch-backend/src/domain/transcript-model.ts` - uses transcript provenance type.
- `packages/batch-backend/src/domain/transcript-repository.ts` - permits `manual` and transaction-bound inserts.
- `packages/batch-backend/src/infrastructure/db.ts` - bootstrap constraints match the migration.
- `packages/batch-backend/schema.sql` - regenerated baseline.
- `packages/batch-backend/src/application/get-recording-transcript.ts` - response exposes transcript provenance.
- `packages/batch-backend/src/application/recording-dto.ts` - response permits both recording sources.
- `packages/batch-backend/src/transport/extended-routes/recordings-routes.ts` - registers the endpoint.
- `packages/batch-frontend/src/utils/api.ts` - response unions and `createManualTranscriptSource()`.
- `packages/batch-frontend/src/dev/frontend-sandbox-api.ts` - sandbox response for the new endpoint.
- `packages/batch-backend/README.md` and `packages/batch-frontend/README.md` - document the capability and alpha constraint.
- `docs/backend-frontend/backend-frontend-alignment.md` - records route ownership and frontend use.

---

### Task 1: Expand the API and database contracts

**Files:**

- Create: `packages/batch-backend/migrations/0043_manual_transcript_source.sql`
- Modify: `packages/contracts/src/index.ts:14`
- Modify: `packages/contracts/src/contract-versions.ts:1-20`
- Modify: `packages/batch-backend/src/domain/recording-model.ts:1-25`
- Modify: `packages/batch-backend/src/domain/transcript-model.ts:1-28`
- Modify: `packages/batch-backend/src/domain/transcript-repository.ts:1-45`
- Modify: `packages/batch-backend/src/infrastructure/db.ts:186-242,798-808`
- Test: `packages/batch-backend/tests/integration.migrations.test.ts`
- Test: `packages/batch-backend/tests/contracts.db-contract-version.test.ts`
- Create: `packages/batch-backend/tests/contracts.manual-transcript-versions.test.ts`

**Interfaces:**

- Produces: `RecordingSource = 'upload' | 'manual_transcript'`.
- Produces: `TranscriptProviderId = SttProviderId | 'manual'`.
- Produces: DB head `0043_manual_transcript_source` with API `3.1.0` and DB `0.22.0`.

- [ ] **Step 1: Write failing contract and migration assertions**

Inside `assertSchemaHealthy()` in `packages/batch-backend/tests/integration.migrations.test.ts`, query and assert both constraints:

```ts
const sourceConstraints = await pool.query<{ conname: string; definition: string }>(
  `
  SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
  WHERE conname = ANY($1::text[])
  `,
  [['recordings_source_check', 'transcripts_stt_provider_check']],
);
const constraintDefinitions = new Map(
  sourceConstraints.rows.map((row) => [row.conname, row.definition]),
);
expect(constraintDefinitions.get('recordings_source_check')).toContain('manual_transcript');
expect(constraintDefinitions.get('transcripts_stt_provider_check')).toContain('manual');
```

Create `packages/batch-backend/tests/contracts.manual-transcript-versions.test.ts` with explicit version assertions:

```ts
expect(API_CONTRACT_VERSION).toBe('3.1.0');
expect(DB_CONTRACT_VERSION).toBe('0.22.0');
expect(DB_MIGRATION_HEAD).toBe('0043_manual_transcript_source');
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```powershell
corepack pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/integration.migrations.test.ts
corepack pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/contracts.db-contract-version.test.ts
corepack pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/contracts.manual-transcript-versions.test.ts
```

Expected: migration assertions fail because both constraints allow only their current values; contract-version assertions report the old versions/head.

- [ ] **Step 3: Add the migration and type changes**

Create `packages/batch-backend/migrations/0043_manual_transcript_source.sql`:

```sql
ALTER TABLE recordings DROP CONSTRAINT IF EXISTS recordings_source_check;
ALTER TABLE recordings
  ADD CONSTRAINT recordings_source_check
  CHECK (source IN ('upload', 'manual_transcript'));

ALTER TABLE transcripts DROP CONSTRAINT IF EXISTS transcripts_stt_provider_check;
ALTER TABLE transcripts
  ADD CONSTRAINT transcripts_stt_provider_check
  CHECK (stt_provider IN ('deepgram', 'elevenlabs', 'google', 'manual'));
```

In `packages/contracts/src/index.ts`, keep runtime-selectable providers narrow and add transcript provenance separately:

```ts
export type SttProviderId = 'deepgram' | 'elevenlabs' | 'google';
export type TranscriptProviderId = SttProviderId | 'manual';
```

In `recording-model.ts`:

```ts
export type RecordingSource = 'upload' | 'manual_transcript';
export const RecordingSourceSchema = z.enum(['upload', 'manual_transcript']);
```

In `transcript-model.ts` and `transcript-repository.ts`, replace transcript-record `SttProviderId` usage with `TranscriptProviderId`; do not change queue/config types.

Update `contract-versions.ts`:

```ts
export const API_CONTRACT_VERSION = '3.1.0';
export const DB_CONTRACT_VERSION = '0.22.0';
export const DB_MIGRATION_HEAD = '0043_manual_transcript_source';
```

Update the two bootstrap constraint definitions in `db.ts` to use the same value lists as the migration.

- [ ] **Step 4: Regenerate and verify the database baseline**

Run:

```powershell
corepack pnpm --filter @esl-pipeline/batch-backend run db:generate-baseline
corepack pnpm release:verify:contracts
corepack pnpm --filter @esl-pipeline/batch-backend run db:verify-baseline
```

Expected: `schema.sql` contains both expanded constraints; contract and baseline verification pass.

- [ ] **Step 5: Run focused tests and commit**

Run the Step 2 commands again. Expected: PASS.

```powershell
git add packages/contracts/src/index.ts packages/contracts/src/contract-versions.ts packages/batch-backend/migrations/0043_manual_transcript_source.sql packages/batch-backend/src/domain/recording-model.ts packages/batch-backend/src/domain/transcript-model.ts packages/batch-backend/src/domain/transcript-repository.ts packages/batch-backend/src/infrastructure/db.ts packages/batch-backend/schema.sql packages/batch-backend/tests/integration.migrations.test.ts packages/batch-backend/tests/contracts.db-contract-version.test.ts packages/batch-backend/tests/contracts.manual-transcript-versions.test.ts
git commit -m "feat(contracts): add manual transcript provenance"
```

---

### Task 2: Support transaction-bound recording and transcript inserts

**Files:**

- Modify: `packages/batch-backend/src/domain/recording-repository.ts:25-105`
- Modify: `packages/batch-backend/src/domain/transcript-repository.ts:27-105`
- Create: `packages/batch-backend/tests/domain.recording-repository.test.ts`
- Create: `packages/batch-backend/tests/domain.transcript-repository.test.ts`

**Interfaces:**

- Produces: `insertRecording(params, options?: { client?: PoolClient })`.
- Produces: `insertTranscript(params, options?: { client?: PoolClient })`.
- Consumes: expanded source and transcript-provider unions from Task 1.

- [ ] **Step 1: Add failing client-reuse tests**

Add repository tests that pass a fake `PoolClient` and assert the insert query is issued directly on it rather than acquiring another client:

```ts
const client = {
  query: vi.fn().mockResolvedValue({ rows: [recordingRow] }),
} as unknown as PoolClient;

await insertRecording(recordingInput, { client });

expect(client.query).toHaveBeenCalledTimes(1);
expect(withPgClientSpy).not.toHaveBeenCalled();
```

Repeat for `insertTranscript()` with a manual transcript row.

- [ ] **Step 2: Run repository tests and verify failure**

Run:

```powershell
corepack pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/domain.recording-repository.test.ts tests/domain.transcript-repository.test.ts
```

Expected: TypeScript/test failure because neither insert accepts an options argument.

- [ ] **Step 3: Add the optional client boundary**

Use this pattern in both repositories:

```ts
export async function insertRecording(
  params: InsertRecordingParams,
  options?: { client?: PoolClient },
): Promise<RecordingRecord> {
  const write = async (client: PoolClient): Promise<RecordingRecord> => {
    const result = await client.query(recordingInsertSql, recordingInsertValues(params));
    return mapRowToRecording(result.rows[0]);
  };

  return options?.client ? write(options.client) : withPgClient(write);
}
```

Implement the same structure for `insertTranscript()`. Keep the current SQL, value order, logging, generated IDs, and row mappers unchanged; extract the current SQL/value construction into file-local constants/functions rather than duplicating it.

- [ ] **Step 4: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```powershell
git add packages/batch-backend/src/domain/recording-repository.ts packages/batch-backend/src/domain/transcript-repository.ts packages/batch-backend/tests/domain.recording-repository.test.ts packages/batch-backend/tests/domain.transcript-repository.test.ts
git commit -m "refactor(backend): allow transaction-bound source inserts"
```

---

### Task 3: Implement durable manual transcript ingestion

**Files:**

- Create: `packages/batch-backend/src/application/ingest-manual-transcript-source.ts`
- Create: `packages/batch-backend/tests/application.ingest-manual-transcript-source.test.ts`

**Interfaces:**

- Consumes: transaction-bound inserts from Task 2.
- Produces:

```ts
export interface ManualTranscriptSourceInput {
  studentId: string;
  text: string;
  displayName?: string | null;
}

export interface ManualTranscriptSourceResult {
  recording: RecordingRecord;
  transcript: TranscriptRecord;
}

export interface PersistManualTranscriptSourceParams {
  recordingId: string;
  transcriptId: string;
  studentId: string;
  displayName: string;
  storageUri: string;
  bytes: number;
}

export interface ManualTranscriptSourceDependencies {
  storage: TranscriptionStorage;
  persist: (params: PersistManualTranscriptSourceParams) => Promise<ManualTranscriptSourceResult>;
}

export class ManualTranscriptSourceValidationError extends Error {
  constructor(
    message: string,
    readonly code: 'text_required' | 'text_too_large',
  ) {
    super(message);
    this.name = 'ManualTranscriptSourceValidationError';
  }
}
```

- [ ] **Step 1: Write failing application tests**

Cover success, trimming, empty input rejection, transaction rollback, and storage cleanup. The success assertion is:

```ts
expect(result.recording).toMatchObject({
  source: 'manual_transcript',
  studentId: '11111111-1111-4111-8111-111111111111',
  status: 'transcribed',
  bytes: Buffer.byteLength('Tutor supplied transcript', 'utf8'),
});
expect(result.transcript).toMatchObject({
  recordingId: result.recording.id,
  sttProvider: 'manual',
  model: 'manual-entry',
  language: 'und',
  fallbackUsed: false,
  summaryJson: { provider: 'manual', origin: 'tutor_paste' },
});
```

The rollback assertion is:

```ts
await expect(ingestManualTranscriptSource(input, failingDependencies)).rejects.toThrow(
  'database write failed',
);
expect(storage.delete).toHaveBeenCalledWith('local://transcripts/transcript-id.txt');
```

- [ ] **Step 2: Run the application test and verify failure**

Run:

```powershell
corepack pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/application.ingest-manual-transcript-source.test.ts
```

Expected: FAIL because the application module does not exist.

- [ ] **Step 3: Implement ingestion and default dependencies**

Create the application module with these constants and public function:

```ts
const MANUAL_TRANSCRIPT_MODEL = 'manual-entry';
const MANUAL_TRANSCRIPT_LANGUAGE = 'und';
const DEFAULT_DISPLAY_NAME = 'Pasted lesson transcript';

export async function ingestManualTranscriptSource(
  input: ManualTranscriptSourceInput,
  overrides?: Partial<ManualTranscriptSourceDependencies>,
): Promise<ManualTranscriptSourceResult> {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new ManualTranscriptSourceValidationError(
      'Transcript text is required.',
      'text_required',
    );
  }
  if (text.length > 500_000) {
    throw new ManualTranscriptSourceValidationError(
      'Transcript text exceeds 500000 characters.',
      'text_too_large',
    );
  }

  const recordingId = randomUUID();
  const transcriptId = randomUUID();
  const storage = overrides?.storage ?? createTranscriptionStorage();
  const stored = await storage.putTranscript({ transcriptId, text });

  try {
    return await (overrides?.persist ?? persistManualTranscriptSourceWithDefaults)({
      recordingId,
      transcriptId,
      studentId: input.studentId,
      displayName: input.displayName?.trim() || DEFAULT_DISPLAY_NAME,
      storageUri: stored.uri,
      bytes: Buffer.byteLength(text, 'utf8'),
    });
  } catch (error) {
    await storage.delete(stored.uri).catch(() => undefined);
    throw error;
  }
}
```

`persistManualTranscriptSourceWithDefaults()` must acquire one client, issue `BEGIN`, call both transaction-bound inserts, issue `COMMIT`, and issue `ROLLBACK` before rethrowing on error. Recording fields are `source: 'manual_transcript'`, `sourcePath: displayName`, `storageUri`, `bytes`, and `status: 'transcribed'`. Transcript fields are the values asserted in Step 1.

- [ ] **Step 4: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```powershell
git add packages/batch-backend/src/application/ingest-manual-transcript-source.ts packages/batch-backend/tests/application.ingest-manual-transcript-source.test.ts
git commit -m "feat(backend): ingest pasted transcript sources"
```

---

### Task 4: Expose the authenticated HTTP route

**Files:**

- Modify: `packages/batch-backend/src/transport/extended-routes/recordings-routes.ts:84-340`
- Modify: `packages/batch-backend/src/application/recording-dto.ts:5-36`
- Modify: `packages/batch-backend/src/application/get-recording-transcript.ts:1-61`
- Create: `packages/batch-backend/tests/transport.http-server.integration.manual-transcript-source.test.ts`

**Interfaces:**

- Produces: `POST /recordings/transcript-source`.
- Request: `{ studentId: string; text: string; displayName?: string }`.
- Success: HTTP 201 with `RecordingDto`, `source: 'manual_transcript'`, `status: 'transcribed'`, and non-null `transcriptId`.

- [ ] **Step 1: Write failing route tests**

Add tests for 401, 400 empty text, 400 oversized text, and 201 success. The success request is:

```ts
const response = await app.inject({
  method: 'POST',
  url: '/recordings/transcript-source',
  headers: authenticatedHeaders,
  payload: {
    studentId: '11111111-1111-4111-8111-111111111111',
    text: 'Tutor supplied transcript',
    displayName: 'Lesson on travel',
  },
});

expect(response.statusCode).toBe(201);
expect(response.json()).toMatchObject({
  source: 'manual_transcript',
  status: 'transcribed',
  studentId: '11111111-1111-4111-8111-111111111111',
});
expect(response.json().transcriptId).toEqual(expect.any(String));
```

- [ ] **Step 2: Run the route test and verify failure**

Run:

```powershell
corepack pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/transport.http-server.integration.manual-transcript-source.test.ts
```

Expected: FAIL with route not found.

- [ ] **Step 3: Register the route**

Add this body schema near the route:

```ts
const manualTranscriptSourceSchema = z.object({
  studentId: z.string().uuid(),
  text: z.string().trim().min(1).max(500_000),
  displayName: z.string().trim().min(1).max(200).optional(),
});
```

The handler authenticates using the existing `authenticate` pre-handler, calls `ingestManualTranscriptSource()`, logs `manual_transcript_source_created` with user, student, recording, and transcript IDs, and returns:

```ts
return reply.code(201).send(
  recordingToDto({
    ...result.recording,
    transcriptId: result.transcript.id,
  }),
);
```

Catch `ManualTranscriptSourceValidationError` and return the repository-standard `validation_failed` envelope with its `code`; return `internal_error` for unexpected failures. Update transcript-response types to use `TranscriptProviderId`.

- [ ] **Step 4: Run tests and commit**

Run the Step 2 command plus existing recording route integration tests. Expected: PASS.

```powershell
git add packages/batch-backend/src/transport/extended-routes/recordings-routes.ts packages/batch-backend/src/application/recording-dto.ts packages/batch-backend/src/application/get-recording-transcript.ts packages/batch-backend/tests/transport.http-server.integration.manual-transcript-source.test.ts
git commit -m "feat(api): create manual transcript sources"
```

---

### Task 5: Add frontend client and sandbox support

**Files:**

- Modify: `packages/batch-frontend/src/utils/api.ts:129-160,1840-1945`
- Modify: `packages/batch-frontend/src/dev/frontend-sandbox-api.ts:1200-1320`
- Create: `packages/batch-frontend/src/utils/api.manual-transcript-source.test.ts`
- Modify: `packages/batch-frontend/src/dev/frontend-sandbox-api.test.ts`

**Interfaces:**

- Consumes: route from Task 4.
- Produces:

```ts
export interface CreateManualTranscriptSourceInput {
  studentId: string;
  text: string;
  displayName?: string;
}

export async function createManualTranscriptSource(
  input: CreateManualTranscriptSourceInput,
): Promise<RecordingListItem>;
```

- [ ] **Step 1: Write failing API client tests**

```ts
await createManualTranscriptSource({
  studentId: '11111111-1111-4111-8111-111111111111',
  text: 'Tutor supplied transcript',
  displayName: 'Lesson on travel',
});

expect(mockedAxios.post).toHaveBeenCalledWith(
  expect.stringContaining('/recordings/transcript-source'),
  {
    studentId: '11111111-1111-4111-8111-111111111111',
    text: 'Tutor supplied transcript',
    displayName: 'Lesson on travel',
  },
);
```

Add a sandbox test asserting the response has `source: 'manual_transcript'`, `status: 'transcribed'`, and a transcript ID.

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/utils/api.manual-transcript-source.test.ts src/dev/frontend-sandbox-api.test.ts
```

Expected: API import fails and the sandbox route is unhandled.

- [ ] **Step 3: Implement the client and sandbox route**

Widen `RecordingListItem['source']` to `'upload' | 'manual_transcript'` and `RecordingTranscriptResponse['sttProvider']` to `TranscriptProviderId`.

Add the client:

```ts
export async function createManualTranscriptSource(
  input: CreateManualTranscriptSourceInput,
): Promise<RecordingListItem> {
  try {
    const response = await apiClient.post<RecordingListItem>(
      buildApiProxyPath('/recordings/transcript-source'),
      input,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to save a pasted transcript.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}
```

The sandbox handler returns a stable recording/transcript pair bound to the requested student and stores the submitted text in its in-memory transcript map so subsequent GET/PUT transcript calls work.

- [ ] **Step 4: Run tests and commit**

Run the Step 2 command. Expected: PASS.

```powershell
git add packages/batch-frontend/src/utils/api.ts packages/batch-frontend/src/utils/api.manual-transcript-source.test.ts packages/batch-frontend/src/dev/frontend-sandbox-api.ts packages/batch-frontend/src/dev/frontend-sandbox-api.test.ts
git commit -m "feat(frontend): support manual transcript source API"
```

---

### Task 6: Document and validate the prerequisite

**Files:**

- Modify: `packages/batch-backend/README.md`
- Modify: `packages/batch-frontend/README.md`
- Modify: `docs/backend-frontend/backend-frontend-alignment.md`
- Modify: `docs/generated/backend-route-index.md`

**Interfaces:**

- Documents: route ownership, manual provenance, OPUS-only upload posture, and Calm Studio dependency.

- [ ] **Step 1: Update docs with exact behavior**

Document:

```markdown
- `POST /recordings/transcript-source` creates a transcribed lesson source from tutor-supplied text.
- The durable recording source is `manual_transcript`; transcript provenance is `manual`.
- The route requires `studentId`, never enqueues STT, and participates in normal prompt-package,
  learner-context, history, and resume flows.
- Audio upload remains OPUS-only during alpha.
```

- [ ] **Step 2: Regenerate indexes and run focused validation**

Run:

```powershell
corepack pnpm format
corepack pnpm docs:generate:indexes
corepack pnpm docs:check
corepack pnpm release:verify:contracts
corepack pnpm --filter @esl-pipeline/batch-backend run db:verify-baseline
corepack pnpm --filter @esl-pipeline/batch-backend run typecheck
corepack pnpm --filter @esl-pipeline/batch-frontend run typecheck
corepack pnpm --silent run check:fast:agent
corepack pnpm check:pre-pr
git diff --check
```

Expected: all commands exit 0; generated indexes and schema baseline are clean after regeneration.

- [ ] **Step 3: Commit documentation and generated references**

```powershell
git add packages/batch-backend/README.md packages/batch-frontend/README.md docs/backend-frontend/backend-frontend-alignment.md docs/generated/backend-route-index.md
git commit -m "docs(frontend): document manual transcript sources"
```
