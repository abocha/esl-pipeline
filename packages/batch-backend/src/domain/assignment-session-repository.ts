import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type {
  AssignmentConfirmedSnapshot,
  AssignmentConfirmedStep,
  AssignmentInvalidatedArtifact,
  ConfirmAssignmentSessionStepRequest,
  GenerationProvider,
  PublishTarget,
  TtsProviderId,
  TtsStrategy,
} from '@esl-pipeline/contracts';

import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import { ArtifactWorkingConflictError } from './artifact-working-conflict.js';
import {
  AssignmentConfirmedSnapshotSchema,
  type AssignmentSessionRecord,
} from './assignment-session-model.js';
import { getDraftByIdForUpdate } from './draft-repository.js';
import type { JobRecord } from './job-model.js';
import { getJobById, type InsertJobParams, insertApprovalJob } from './job-repository.js';
import { getTranscriptByIdForUpdate } from './transcript-repository.js';

export const ACTIVE_ASSIGNMENT_SESSION_SQL = `confirmed_step <> 'share'`;

interface AssignmentSessionRow {
  id: string;
  user_id: string;
  student_id: string;
  lesson_id: string | null;
  recording_id: string | null;
  transcript_id: string | null;
  prompt_package_id: string | null;
  draft_id: string | null;
  revision: number;
  confirmed_step: AssignmentConfirmedStep;
  confirmed_snapshot: unknown;
  creation_request_id: string | null;
  publish_target: PublishTarget | null;
  selected_tts_provider: TtsProviderId | null;
  selected_tts_strategy: TtsStrategy | null;
  selected_tts_model: string | null;
  selected_preset: string | null;
  selected_generation_provider: GenerationProvider | null;
  selected_generation_model: string | null;
  teacher_notes: string | null;
  selected_profile_id: string | null;
  selected_profile_revision_id: string | null;
  selected_profile_revision_hash: string | null;
  share_job_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ConfirmStudentAssignmentSessionParams {
  userId: string;
  requestId: string;
  studentId: string;
  lessonId: string | null;
}

export interface AssignmentSessionRecoveryPatch {
  lessonId?: string | null;
  recordingId?: string | null;
  transcriptId?: string | null;
  promptPackageId?: string | null;
  draftId?: string | null;
  publishTarget?: PublishTarget | null;
  selectedTtsProvider?: TtsProviderId | null;
  selectedTtsStrategy?: TtsStrategy | null;
  selectedTtsModel?: string | null;
  selectedPreset?: string | null;
  selectedGenerationProvider?: GenerationProvider | null;
  selectedGenerationModel?: string | null;
  teacherNotes?: string | null;
  selectedProfileId?: string | null;
  selectedProfileRevisionId?: string | null;
  selectedProfileRevisionHash?: string | null;
}

export interface UpdateAssignmentSessionRecoveryParams {
  id: string;
  userId: string;
  expectedRevision: number;
  patch: AssignmentSessionRecoveryPatch;
}

export interface ConfirmAssignmentSessionStepPersistenceParams {
  id: string;
  userId: string;
  request: ConfirmAssignmentSessionStepRequest;
  lessonMemory?: { schemaVersion: string; provider: string; model: string; requestedAt: Date };
}

export interface ConfirmedLessonMemoryIntent {
  outcome: 'created' | 'pending_exists';
  entryId: string;
  studentId: string;
  transcriptId: string;
  recordingId: string;
  lessonId: string | null;
  sourceStorageUri: string;
  sourceContentHash: string;
  provider: string;
  model: string;
}

export interface ConfirmAssignmentSessionStepPersistenceResult {
  session: AssignmentSessionRecord;
  invalidated: AssignmentInvalidatedArtifact[];
  lessonMemoryIntent: ConfirmedLessonMemoryIntent | null;
}

export type AssignmentShareJobConfig = Omit<
  InsertJobParams,
  | 'id'
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

export interface ReserveAssignmentShareParams {
  sessionId: string;
  userId: string;
  expectedRevision: number;
  requestId: string;
  jobConfig: AssignmentShareJobConfig;
}

const RETURNING_COLUMNS = `
  id, user_id, student_id, lesson_id, recording_id, transcript_id,
  prompt_package_id, draft_id, revision, confirmed_step, confirmed_snapshot,
  creation_request_id, publish_target, selected_tts_provider, selected_tts_strategy,
  selected_tts_model, selected_preset, selected_generation_provider,
  selected_generation_model, teacher_notes, selected_profile_id,
  selected_profile_revision_id, selected_profile_revision_hash, share_job_id,
  created_at, updated_at
`;

const RECOVERY_COLUMNS = {
  lessonId: 'lesson_id',
  recordingId: 'recording_id',
  transcriptId: 'transcript_id',
  promptPackageId: 'prompt_package_id',
  draftId: 'draft_id',
  publishTarget: 'publish_target',
  selectedTtsProvider: 'selected_tts_provider',
  selectedTtsStrategy: 'selected_tts_strategy',
  selectedTtsModel: 'selected_tts_model',
  selectedPreset: 'selected_preset',
  selectedGenerationProvider: 'selected_generation_provider',
  selectedGenerationModel: 'selected_generation_model',
  teacherNotes: 'teacher_notes',
  selectedProfileId: 'selected_profile_id',
  selectedProfileRevisionId: 'selected_profile_revision_id',
  selectedProfileRevisionHash: 'selected_profile_revision_hash',
} as const satisfies Record<keyof AssignmentSessionRecoveryPatch, string>;

export class AssignmentSessionRepositoryError extends Error {
  constructor(
    readonly code:
      | 'ASSIGNMENT_SESSION_NOT_FOUND'
      | 'ASSIGNMENT_SESSION_COMPLETED'
      | 'ASSIGNMENT_SESSION_SHARE_IN_PROGRESS',
  ) {
    super(code);
    this.name = 'AssignmentSessionRepositoryError';
  }
}

export class AssignmentSessionRevisionConflictError extends Error {
  readonly code = 'ASSIGNMENT_SESSION_REVISION_CONFLICT';

  constructor(readonly session: AssignmentSessionRecord) {
    super('Assignment session changed before this recovery update.');
    this.name = 'AssignmentSessionRevisionConflictError';
  }
}

export class AssignmentSourceOwnershipConflictError extends Error {
  readonly code = 'ASSIGNMENT_SOURCE_ALREADY_OWNED';

  constructor(readonly session: AssignmentSessionRecord) {
    super('This lesson source already belongs to another assignment.');
    this.name = 'AssignmentSourceOwnershipConflictError';
  }
}

export class AssignmentSessionRequestConflictError extends Error {
  readonly code = 'ASSIGNMENT_SESSION_REQUEST_CONFLICT';

  constructor(readonly session: AssignmentSessionRecord) {
    super('Student confirmation request ID was already used with different input.');
    this.name = 'AssignmentSessionRequestConflictError';
  }
}

export class AssignmentSessionConfirmationError extends Error {
  constructor(
    readonly code:
      | 'ASSIGNMENT_STEP_PREREQUISITE_MISSING'
      | 'ASSIGNMENT_STEP_LINEAGE_INVALID'
      | 'ASSIGNMENT_STEP_ARTIFACT_NOT_FOUND',
  ) {
    super(code);
    this.name = 'AssignmentSessionConfirmationError';
  }
}

export class AssignmentSessionShareError extends Error {
  constructor(
    readonly code:
      | 'ASSIGNMENT_SHARE_PREREQUISITE_MISSING'
      | 'ASSIGNMENT_SHARE_DIRTY_RECOVERY'
      | 'ASSIGNMENT_SHARE_REQUEST_CONFLICT'
      | 'ASSIGNMENT_SHARE_JOB_INTEGRITY_INVALID',
  ) {
    super(code);
    this.name = 'AssignmentSessionShareError';
  }
}

export async function confirmAssignmentSessionStepPersistence(
  params: ConfirmAssignmentSessionStepPersistenceParams,
): Promise<ConfirmAssignmentSessionStepPersistenceResult> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      const locked = await client.query<AssignmentSessionRow>(
        `SELECT ${RETURNING_COLUMNS} FROM assignment_sessions
         WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [params.id, params.userId],
      );
      const row = locked.rows[0];
      if (!row) throw new AssignmentSessionRepositoryError('ASSIGNMENT_SESSION_NOT_FOUND');
      const current = mapRow(row);
      if (current.confirmedStep === 'share') {
        throw new AssignmentSessionRepositoryError('ASSIGNMENT_SESSION_COMPLETED');
      }
      if (current.shareJobId) {
        throw new AssignmentSessionRepositoryError('ASSIGNMENT_SESSION_SHARE_IN_PROGRESS');
      }

      const result = await confirmLockedStep(client, current, params);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function confirmLockedStep(
  client: PoolClient,
  current: AssignmentSessionRecord,
  params: ConfirmAssignmentSessionStepPersistenceParams,
): Promise<ConfirmAssignmentSessionStepPersistenceResult> {
  switch (params.request.step) {
    case 'source':
      return confirmLockedSource(client, current, params);
    case 'context':
      return confirmLockedContext(client, current, params);
    case 'create':
      return confirmLockedCreate(client, current, params);
    default:
      return assertNever(params.request);
  }
}

async function confirmLockedSource(
  client: PoolClient,
  current: AssignmentSessionRecord,
  params: ConfirmAssignmentSessionStepPersistenceParams,
): Promise<ConfirmAssignmentSessionStepPersistenceResult> {
  const request = params.request as Extract<
    ConfirmAssignmentSessionStepRequest,
    { step: 'source' }
  >;
  const transcript = await getTranscriptByIdForUpdate(client, request.transcriptId);
  if (!transcript)
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_ARTIFACT_NOT_FOUND');
  if (
    transcript.recordingId !== request.recordingId ||
    transcript.workingVersion === null ||
    transcript.contentHash === null
  ) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_LINEAGE_INVALID');
  }
  if (transcript.workingVersion !== request.transcriptWorkingVersion) {
    throw new ArtifactWorkingConflictError(transcript);
  }
  const recording = await client.query<{ student_id: string | null }>(
    'SELECT student_id FROM recordings WHERE id = $1',
    [request.recordingId],
  );
  if (!recording.rows[0] || recording.rows[0].student_id !== current.studentId) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_LINEAGE_INVALID');
  }
  if (request.lessonId) {
    const lesson = await client.query(
      'SELECT 1 FROM student_lessons WHERE id = $1 AND student_id = $2',
      [request.lessonId, current.studentId],
    );
    if (!lesson.rows[0]) {
      throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_LINEAGE_INVALID');
    }
  }

  const source = {
    lessonId: request.lessonId,
    recordingId: request.recordingId,
    transcriptId: transcript.id,
    transcriptWorkingVersion: transcript.workingVersion,
    transcriptStorageUri: transcript.storageUri,
    transcriptHash: transcript.contentHash,
  };
  const previousSource = current.confirmed.source;
  const identical = JSON.stringify(current.confirmed.source) === JSON.stringify(source);
  if (identical) {
    const intent = await reconcileConfirmedLessonMemoryIntent(
      client,
      current,
      source,
      source,
      params,
    );
    return { session: current, invalidated: [], lessonMemoryIntent: intent };
  }
  assertExpectedRevision(current, request.expectedRevision);

  const confirmed: AssignmentConfirmedSnapshot = {
    student: current.confirmed.student,
    source,
    context: null,
    create: null,
  };
  const updated = await updateConfirmedSession(client, current, {
    confirmedStep: 'source',
    confirmed,
    columns: {
      lesson_id: request.lessonId,
      recording_id: request.recordingId,
      transcript_id: request.transcriptId,
      prompt_package_id: null,
      draft_id: null,
    },
  });
  const intent = await reconcileConfirmedLessonMemoryIntent(
    client,
    updated,
    previousSource,
    source,
    params,
  );
  return {
    session: updated,
    invalidated: ['prompt', 'draft', 'preview'],
    lessonMemoryIntent: intent,
  };
}

async function confirmLockedContext(
  client: PoolClient,
  current: AssignmentSessionRecord,
  params: ConfirmAssignmentSessionStepPersistenceParams,
): Promise<ConfirmAssignmentSessionStepPersistenceResult> {
  const request = params.request as Extract<
    ConfirmAssignmentSessionStepRequest,
    { step: 'context' }
  >;
  if (!current.confirmed.source) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_PREREQUISITE_MISSING');
  }
  await assertConfirmedSourceIsCurrent(client, current);
  const profileValues = [request.profileId, request.profileRevisionId, request.profileRevisionHash];
  if (
    profileValues.some((value) => value !== null) &&
    profileValues.some((value) => value === null)
  ) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_LINEAGE_INVALID');
  }
  if (request.profileId && request.profileRevisionId && request.profileRevisionHash) {
    const profile = await client.query(
      `SELECT 1 FROM profile_revisions
       WHERE profile_id = $1 AND id = $2 AND content_hash = $3`,
      [request.profileId, request.profileRevisionId, request.profileRevisionHash],
    );
    if (!profile.rows[0]) {
      throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_LINEAGE_INVALID');
    }
    const binding = await client.query(
      `SELECT 1 FROM student_profile_bindings
       WHERE student_id = $1 AND profile_id = $2 AND effective_to IS NULL`,
      [current.studentId, request.profileId],
    );
    if (!binding.rows[0]) {
      throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_LINEAGE_INVALID');
    }
  }
  const context = {
    teacherNotes: request.teacherNotes,
    profileId: request.profileId,
    profileRevisionId: request.profileRevisionId,
    profileRevisionHash: request.profileRevisionHash,
  };
  if (JSON.stringify(current.confirmed.context) === JSON.stringify(context)) {
    return { session: current, invalidated: [], lessonMemoryIntent: null };
  }
  assertExpectedRevision(current, request.expectedRevision);
  const confirmed = { ...current.confirmed, context, create: null };
  const updated = await updateConfirmedSession(client, current, {
    confirmedStep: 'context',
    confirmed,
    columns: {
      teacher_notes: request.teacherNotes,
      selected_profile_id: request.profileId,
      selected_profile_revision_id: request.profileRevisionId,
      selected_profile_revision_hash: request.profileRevisionHash,
      prompt_package_id: null,
      draft_id: null,
    },
  });
  return {
    session: updated,
    invalidated: ['prompt', 'draft', 'preview'],
    lessonMemoryIntent: null,
  };
}

async function confirmLockedCreate(
  client: PoolClient,
  current: AssignmentSessionRecord,
  params: ConfirmAssignmentSessionStepPersistenceParams,
): Promise<ConfirmAssignmentSessionStepPersistenceResult> {
  const request = params.request as Extract<
    ConfirmAssignmentSessionStepRequest,
    { step: 'create' }
  >;
  const source = current.confirmed.source;
  if (!source || !current.confirmed.context) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_PREREQUISITE_MISSING');
  }
  await assertConfirmedSourceIsCurrent(client, current);
  const context = current.confirmed.context;
  if (
    current.teacherNotes !== context.teacherNotes ||
    current.selectedProfileId !== context.profileId ||
    current.selectedProfileRevisionId !== context.profileRevisionId ||
    current.selectedProfileRevisionHash !== context.profileRevisionHash
  ) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_PREREQUISITE_MISSING');
  }
  const draft = await getDraftByIdForUpdate(client, request.draftId);
  if (!draft) throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_ARTIFACT_NOT_FOUND');
  if (draft.workingVersion === null || draft.contentHash === null) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_LINEAGE_INVALID');
  }
  if (draft.workingVersion !== request.draftWorkingVersion) {
    throw new ArtifactWorkingConflictError(draft);
  }
  const prompt = await client.query<{
    id: string;
    recording_id: string;
    transcript_id: string;
    student_id: string | null;
    lesson_id: string | null;
    notes: string | null;
    resolved_profile_id: string | null;
    resolved_profile_revision_id: string | null;
    resolved_profile_hash: string | null;
    resolved_profile_revision_content_hash: string | null;
  }>(
    `SELECT pp.id, pp.recording_id, pp.transcript_id, pp.student_id, pp.lesson_id, pp.notes,
            pp.resolved_profile_id, pp.resolved_profile_revision_id, pp.resolved_profile_hash,
            pr.content_hash AS resolved_profile_revision_content_hash
     FROM prompt_packages pp
     LEFT JOIN profile_revisions pr
       ON pr.id = pp.resolved_profile_revision_id AND pr.profile_id = pp.resolved_profile_id
     WHERE pp.id = $1`,
    [request.promptPackageId],
  );
  const packageRow = prompt.rows[0];
  if (
    !packageRow ||
    draft.promptPackageId !== packageRow.id ||
    draft.studentId !== current.studentId ||
    packageRow.student_id !== current.studentId ||
    packageRow.recording_id !== source.recordingId ||
    packageRow.transcript_id !== source.transcriptId ||
    packageRow.lesson_id !== source.lessonId ||
    packageRow.notes !== context.teacherNotes ||
    packageRow.resolved_profile_id !== context.profileId ||
    packageRow.resolved_profile_revision_id !== context.profileRevisionId ||
    (context.profileId === null
      ? packageRow.resolved_profile_hash !== null
      : packageRow.resolved_profile_revision_content_hash !== context.profileRevisionHash)
  ) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_LINEAGE_INVALID');
  }
  const create = {
    promptPackageId: request.promptPackageId,
    draftId: request.draftId,
    draftWorkingVersion: draft.workingVersion,
    draftStorageUri: draft.storageUri,
    draftHash: draft.contentHash,
  };
  if (JSON.stringify(current.confirmed.create) === JSON.stringify(create)) {
    return { session: current, invalidated: [], lessonMemoryIntent: null };
  }
  assertExpectedRevision(current, request.expectedRevision);
  const updated = await updateConfirmedSession(client, current, {
    confirmedStep: 'create',
    confirmed: { ...current.confirmed, create },
    columns: { prompt_package_id: request.promptPackageId, draft_id: request.draftId },
  });
  return { session: updated, invalidated: ['preview'], lessonMemoryIntent: null };
}

async function updateConfirmedSession(
  client: PoolClient,
  current: AssignmentSessionRecord,
  values: {
    confirmedStep: AssignmentConfirmedStep;
    confirmed: AssignmentConfirmedSnapshot;
    columns: Record<string, unknown>;
  },
): Promise<AssignmentSessionRecord> {
  const assignments = ['confirmed_step = $3', 'confirmed_snapshot = $4::jsonb'];
  const params: unknown[] = [
    current.id,
    current.revision,
    values.confirmedStep,
    JSON.stringify(values.confirmed),
  ];
  for (const [column, value] of Object.entries(values.columns)) {
    params.push(value);
    assignments.push(`${column} = $${params.length}`);
  }
  const updated = await client.query<AssignmentSessionRow>(
    `UPDATE assignment_sessions SET ${assignments.join(', ')}, revision = revision + 1, updated_at = NOW()
     WHERE id = $1 AND revision = $2 AND ${ACTIVE_ASSIGNMENT_SESSION_SQL}
     RETURNING ${RETURNING_COLUMNS}`,
    params,
  );
  if (!updated.rows[0]) throw new AssignmentSessionRevisionConflictError(current);
  return mapRow(updated.rows[0]);
}

async function reconcileConfirmedLessonMemoryIntent(
  client: PoolClient,
  session: AssignmentSessionRecord,
  previousSource: AssignmentConfirmedSnapshot['source'],
  source: NonNullable<AssignmentConfirmedSnapshot['source']>,
  params: ConfirmAssignmentSessionStepPersistenceParams,
): Promise<ConfirmedLessonMemoryIntent | null> {
  const lessonMemory = params.lessonMemory;
  if (!lessonMemory) {
    throw new Error('Source confirmation requires lesson-memory generation configuration');
  }
  const authorityChanged =
    !previousSource ||
    previousSource.transcriptId !== source.transcriptId ||
    previousSource.transcriptHash !== source.transcriptHash;
  const exact = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM lesson_memory_entries
     WHERE transcript_id = $1 AND source_content_hash = $2 FOR UPDATE`,
    [source.transcriptId, source.transcriptHash],
  );
  const entryId = exact.rows[0]?.id ?? randomUUID();
  let outcome: ConfirmedLessonMemoryIntent['outcome'] = 'pending_exists';
  if (!exact.rows[0]) {
    outcome = 'created';
    await client.query(
      `INSERT INTO lesson_memory_entries (
         id, student_id, transcript_id, recording_id, schema_version, generated_at,
         provider, model, status, source_kind, source_storage_uri, source_content_hash,
         generation_notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'lesson_transcript', $9, $10, $11::jsonb)`,
      [
        entryId,
        session.studentId,
        source.transcriptId,
        source.recordingId,
        lessonMemory.schemaVersion,
        lessonMemory.requestedAt,
        lessonMemory.provider,
        lessonMemory.model,
        source.transcriptStorageUri,
        source.transcriptHash,
        JSON.stringify({ trigger: 'teacher-confirmed-transcript', lessonId: source.lessonId }),
      ],
    );
  } else if (exact.rows[0].status === 'failed') {
    outcome = 'created';
    await client.query(
      `UPDATE lesson_memory_entries SET status = 'pending', superseded_by_id = NULL,
       superseded_at = NULL, generated_at = $2, updated_at = NOW() WHERE id = $1`,
      [entryId, lessonMemory.requestedAt],
    );
  } else if (exact.rows[0].status === 'superseded') {
    outcome = 'created';
    await client.query(
      `UPDATE lesson_memory_entries SET status = 'pending', superseded_by_id = NULL,
       superseded_at = NULL, generated_at = $2, updated_at = NOW() WHERE id = $1`,
      [entryId, lessonMemory.requestedAt],
    );
  }

  if (authorityChanged) {
    const old = await client.query<{ id: string }>(
      `UPDATE lesson_memory_entries SET status = 'superseded', superseded_by_id = $1,
       superseded_at = $2, updated_at = NOW()
       WHERE id <> $1 AND student_id = $3 AND status IN ('pending', 'ready')
         AND (
           ($4::uuid IS NOT NULL AND transcript_id = $4 AND source_content_hash = $5)
           OR ($4::uuid IS NULL AND transcript_id = $6)
         )
       RETURNING id`,
      [
        entryId,
        lessonMemory.requestedAt,
        session.studentId,
        previousSource?.transcriptId ?? null,
        previousSource?.transcriptHash ?? null,
        source.transcriptId,
      ],
    );
    const oldIds = old.rows.map((row) => row.id);
    if (oldIds.length > 0) {
      await client.query(
        `UPDATE student_memory_snapshots SET status = 'superseded', superseded_by_id = NULL,
         superseded_at = $2, updated_at = NOW()
         WHERE student_id = $1 AND status = 'ready'
           AND lesson_memory_entry_ids && $3::uuid[]`,
        [session.studentId, lessonMemory.requestedAt, oldIds],
      );
    }
    await client.query(
      `UPDATE student_memory_snapshots SET status = 'superseded', superseded_by_id = NULL,
       superseded_at = $2, updated_at = NOW()
       WHERE student_id = $1 AND status = 'pending'`,
      [session.studentId, lessonMemory.requestedAt],
    );
  }
  if (exact.rows[0]?.status === 'ready') return null;
  return {
    outcome,
    entryId,
    studentId: session.studentId,
    transcriptId: source.transcriptId,
    recordingId: source.recordingId,
    lessonId: source.lessonId,
    sourceStorageUri: source.transcriptStorageUri,
    sourceContentHash: source.transcriptHash,
    provider: lessonMemory.provider,
    model: lessonMemory.model,
  };
}

async function assertConfirmedSourceIsCurrent(
  client: PoolClient,
  session: AssignmentSessionRecord,
): Promise<void> {
  const source = session.confirmed.source;
  if (!source) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_PREREQUISITE_MISSING');
  }
  if (
    session.lessonId !== source.lessonId ||
    session.recordingId !== source.recordingId ||
    session.transcriptId !== source.transcriptId
  ) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_PREREQUISITE_MISSING');
  }
  const transcript = await getTranscriptByIdForUpdate(client, source.transcriptId);
  if (!transcript) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_ARTIFACT_NOT_FOUND');
  }
  if (
    transcript.workingVersion !== source.transcriptWorkingVersion ||
    transcript.storageUri !== source.transcriptStorageUri ||
    transcript.contentHash !== source.transcriptHash
  ) {
    throw new ArtifactWorkingConflictError(transcript);
  }
}

function assertExpectedRevision(current: AssignmentSessionRecord, expectedRevision: number): void {
  if (current.revision !== expectedRevision)
    throw new AssignmentSessionRevisionConflictError(current);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported assignment confirmation step: ${JSON.stringify(value)}`);
}

export async function confirmStudentAssignmentSession(
  params: ConfirmStudentAssignmentSessionParams,
): Promise<AssignmentSessionRecord> {
  return withPgClient(async (client) => {
    const existing = await findByCreationRequest(client, params.userId, params.requestId);
    if (existing) return assertStudentReplay(existing, params);

    const id = randomUUID();
    const confirmed: AssignmentConfirmedSnapshot = {
      student: { studentId: params.studentId },
      source: null,
      context: null,
      create: null,
    };

    try {
      const result = await client.query(
        `
        INSERT INTO assignment_sessions (
          id, user_id, student_id, lesson_id, revision, confirmed_step,
          confirmed_snapshot, creation_request_id, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, 1, 'student', $5::jsonb, $6, NOW(), NOW())
        RETURNING ${RETURNING_COLUMNS}
        `,
        [
          id,
          params.userId,
          params.studentId,
          params.lessonId,
          JSON.stringify(confirmed),
          params.requestId,
        ],
      );
      logger.info('Student assignment session confirmed', { assignmentSessionId: id });
      return mapRow(result.rows[0]);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await findByCreationRequest(client, params.userId, params.requestId);
      if (!raced) throw error;
      return assertStudentReplay(raced, params);
    }
  });
}

export async function updateAssignmentSessionRecovery(
  params: UpdateAssignmentSessionRecoveryParams,
): Promise<AssignmentSessionRecord> {
  const entries = Object.entries(params.patch) as [keyof AssignmentSessionRecoveryPatch, unknown][];
  if (entries.length === 0) throw new Error('Assignment recovery patch must not be empty');
  for (const [field] of entries) {
    if (!(field in RECOVERY_COLUMNS)) {
      throw new Error(`Assignment recovery field is not allowed: ${field}`);
    }
  }

  return withPgClient(async (client) => {
    const assignments: string[] = [];
    const values: unknown[] = [params.id, params.userId, params.expectedRevision];
    for (const [field, value] of entries) {
      values.push(value);
      assignments.push(`${RECOVERY_COLUMNS[field]} = $${values.length}`);
    }
    assignments.push('revision = revision + 1', 'updated_at = NOW()');

    let result;
    try {
      result = await client.query(
        `
        UPDATE assignment_sessions
        SET ${assignments.join(', ')}
        WHERE id = $1
          AND user_id = $2
          AND revision = $3
          AND ${ACTIVE_ASSIGNMENT_SESSION_SQL}
          AND share_job_id IS NULL
        RETURNING ${RETURNING_COLUMNS}
        `,
        values,
      );
    } catch (error) {
      if (
        isNamedUniqueViolation(error, 'idx_assignment_sessions_user_active_recording') &&
        params.patch.recordingId
      ) {
        const owner = await findActiveByRecording(
          client,
          params.userId,
          params.patch.recordingId,
        );
        if (owner && owner.id !== params.id) {
          throw new AssignmentSourceOwnershipConflictError(mapRow(owner));
        }
      }
      throw error;
    }
    if (result.rows[0]) return mapRow(result.rows[0]);

    const current = await findOwnedById(client, params.id, params.userId);
    if (!current) throw new AssignmentSessionRepositoryError('ASSIGNMENT_SESSION_NOT_FOUND');
    const session = mapRow(current);
    if (session.confirmedStep === 'share') {
      throw new AssignmentSessionRepositoryError('ASSIGNMENT_SESSION_COMPLETED');
    }
    if (session.shareJobId) {
      throw new AssignmentSessionRepositoryError('ASSIGNMENT_SESSION_SHARE_IN_PROGRESS');
    }
    throw new AssignmentSessionRevisionConflictError(session);
  });
}

export async function reserveAssignmentShare(
  params: ReserveAssignmentShareParams,
): Promise<{ session: AssignmentSessionRecord; job: JobRecord; created: boolean }> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      const locked = await client.query<AssignmentSessionRow>(
        `SELECT ${RETURNING_COLUMNS} FROM assignment_sessions
         WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [params.sessionId, params.userId],
      );
      if (!locked.rows[0]) {
        throw new AssignmentSessionRepositoryError('ASSIGNMENT_SESSION_NOT_FOUND');
      }
      const current = mapRow(locked.rows[0]);
      if (current.shareJobId) {
        if (current.shareJobId !== params.requestId) {
          throw new AssignmentSessionShareError('ASSIGNMENT_SHARE_REQUEST_CONFLICT');
        }
        const replayJob = await getJobById(current.shareJobId, { client, forUpdate: true });
        if (!replayJob || !shareJobMatchesSession(replayJob, current)) {
          throw new AssignmentSessionShareError('ASSIGNMENT_SHARE_JOB_INTEGRITY_INVALID');
        }
        await client.query('COMMIT');
        return { session: current, job: replayJob, created: false };
      }
      if (current.revision !== params.expectedRevision) {
        throw new AssignmentSessionRevisionConflictError(current);
      }
      const source = current.confirmed.source;
      const context = current.confirmed.context;
      const create = current.confirmed.create;
      if (!source || !context || !create || current.confirmedStep !== 'create') {
        throw new AssignmentSessionShareError('ASSIGNMENT_SHARE_PREREQUISITE_MISSING');
      }
      if (
        current.lessonId !== source.lessonId ||
        current.recordingId !== source.recordingId ||
        current.transcriptId !== source.transcriptId ||
        current.teacherNotes !== context.teacherNotes ||
        current.selectedProfileId !== context.profileId ||
        current.selectedProfileRevisionId !== context.profileRevisionId ||
        current.selectedProfileRevisionHash !== context.profileRevisionHash ||
        current.promptPackageId !== create.promptPackageId ||
        current.draftId !== create.draftId
      ) {
        throw new AssignmentSessionShareError('ASSIGNMENT_SHARE_DIRTY_RECOVERY');
      }
      const transcript = await getTranscriptByIdForUpdate(client, source.transcriptId);
      const draft = await getDraftByIdForUpdate(client, create.draftId);
      if (
        !transcript ||
        transcript.recordingId !== source.recordingId ||
        transcript.workingVersion !== source.transcriptWorkingVersion ||
        transcript.storageUri !== source.transcriptStorageUri ||
        transcript.contentHash !== source.transcriptHash ||
        !draft ||
        draft.promptPackageId !== create.promptPackageId ||
        draft.studentId !== current.studentId ||
        draft.workingVersion !== create.draftWorkingVersion ||
        draft.storageUri !== create.draftStorageUri ||
        draft.contentHash !== create.draftHash
      ) {
        throw new AssignmentSessionShareError('ASSIGNMENT_SHARE_DIRTY_RECOVERY');
      }

      const job = await insertApprovalJob(
        {
          ...params.jobConfig,
          id: params.requestId,
          recordingId: source.recordingId,
          transcriptId: source.transcriptId,
          promptPackageId: create.promptPackageId,
          draftId: create.draftId,
          studentId: current.studentId,
          lessonId: source.lessonId,
          userId: current.userId,
          md: null,
          mdStorageUri: create.draftStorageUri,
        },
        { client },
      );
      const updated = await client.query<AssignmentSessionRow>(
        `UPDATE assignment_sessions
         SET share_job_id = $3, revision = revision + 1, updated_at = NOW()
         WHERE id = $1 AND revision = $2 AND share_job_id IS NULL
         RETURNING ${RETURNING_COLUMNS}`,
        [current.id, current.revision, job.id],
      );
      if (!updated.rows[0]) throw new AssignmentSessionRevisionConflictError(current);
      await client.query('COMMIT');
      return { session: mapRow(updated.rows[0]), job, created: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function completeAssignmentShare(params: {
  sessionId: string;
  userId: string;
  jobId: string;
  enqueueSatisfied: boolean;
}): Promise<AssignmentSessionRecord> {
  return withPgClient(async (client) => {
    const updated = await client.query<AssignmentSessionRow>(
      `UPDATE assignment_sessions s
       SET confirmed_step = 'share', revision = revision + 1, updated_at = NOW()
       WHERE s.id = $1 AND s.user_id = $2 AND s.share_job_id = $3
         AND s.confirmed_step <> 'share'
         AND EXISTS (
           SELECT 1 FROM jobs j
           WHERE j.id = $3
             AND (j.state IN ('queued', 'running', 'succeeded') OR ($4 AND j.state = 'failed'))
             AND j.user_id = s.user_id
             AND j.student_id = s.student_id
             AND to_jsonb(j.recording_id) = s.confirmed_snapshot #> '{source,recordingId}'
             AND to_jsonb(j.transcript_id) = s.confirmed_snapshot #> '{source,transcriptId}'
             AND to_jsonb(j.prompt_package_id) = s.confirmed_snapshot #> '{create,promptPackageId}'
             AND to_jsonb(j.draft_id) = s.confirmed_snapshot #> '{create,draftId}'
             AND COALESCE(to_jsonb(j.lesson_id), 'null'::jsonb) = s.confirmed_snapshot #> '{source,lessonId}'
             AND j.md_storage_uri = s.confirmed_snapshot #>> '{create,draftStorageUri}'
             AND j.source_job_id IS NULL
         )
       RETURNING ${RETURNING_COLUMNS}`,
      [params.sessionId, params.userId, params.jobId, params.enqueueSatisfied],
    );
    if (updated.rows[0]) return mapRow(updated.rows[0]);
    const currentRow = await findOwnedById(client, params.sessionId, params.userId);
    if (!currentRow) throw new AssignmentSessionRepositoryError('ASSIGNMENT_SESSION_NOT_FOUND');
    const current = mapRow(currentRow);
    if (current.confirmedStep === 'share' && current.shareJobId === params.jobId) {
      const job = await getJobById(params.jobId, { client });
      if (job && shareJobMatchesSession(job, current)) return current;
    }
    throw new AssignmentSessionShareError('ASSIGNMENT_SHARE_JOB_INTEGRITY_INVALID');
  });
}

export async function getAssignmentShareJob(params: {
  sessionId: string;
  userId: string;
  jobId: string;
}): Promise<JobRecord> {
  return withPgClient(async (client) => {
    const currentRow = await findOwnedById(client, params.sessionId, params.userId);
    if (!currentRow) throw new AssignmentSessionRepositoryError('ASSIGNMENT_SESSION_NOT_FOUND');
    const session = mapRow(currentRow);
    if (session.shareJobId !== params.jobId) {
      throw new AssignmentSessionShareError('ASSIGNMENT_SHARE_JOB_INTEGRITY_INVALID');
    }
    const job = await getJobById(params.jobId, { client });
    if (!job || !shareJobMatchesSession(job, session)) {
      throw new AssignmentSessionShareError('ASSIGNMENT_SHARE_JOB_INTEGRITY_INVALID');
    }
    return job;
  });
}

function shareJobMatchesSession(job: JobRecord, session: AssignmentSessionRecord): boolean {
  const source = session.confirmed.source;
  const create = session.confirmed.create;
  return Boolean(
    source &&
      create &&
      job.id === session.shareJobId &&
      job.userId === session.userId &&
      job.studentId === session.studentId &&
      job.recordingId === source.recordingId &&
      job.transcriptId === source.transcriptId &&
      job.promptPackageId === create.promptPackageId &&
      job.draftId === create.draftId &&
      job.lessonId === source.lessonId &&
      job.mdStorageUri === create.draftStorageUri &&
      job.sourceJobId === null,
  );
}

export async function getAssignmentSessionByIdForUser(
  id: string,
  userId: string,
): Promise<AssignmentSessionRecord | null> {
  const row = await withPgClient((client) => findOwnedById(client, id, userId));
  return row ? mapRow(row) : null;
}

export async function getActiveAssignmentSessionByRecording(
  userId: string,
  recordingId: string,
): Promise<AssignmentSessionRecord | null> {
  const row = await withPgClient((client) => findActiveByRecording(client, userId, recordingId));
  return row ? mapRow(row) : null;
}

async function findActiveByRecording(
  client: PoolClient,
  userId: string,
  recordingId: string,
): Promise<AssignmentSessionRow | null> {
  const result = await client.query(
    `
    SELECT ${RETURNING_COLUMNS}
    FROM assignment_sessions
    WHERE user_id = $1 AND recording_id = $2 AND ${ACTIVE_ASSIGNMENT_SESSION_SQL}
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [userId, recordingId],
  );
  return result.rows[0] ?? null;
}

export async function listAssignmentSessionsForUser(
  userId: string,
  limit: number,
): Promise<AssignmentSessionRecord[]> {
  const rows = await withPgClient(async (client) => {
    const result = await client.query(
      `
      SELECT ${RETURNING_COLUMNS}
      FROM assignment_sessions
      WHERE user_id = $1 AND ${ACTIVE_ASSIGNMENT_SESSION_SQL}
      ORDER BY updated_at DESC, id DESC
      LIMIT $2
      `,
      [userId, limit],
    );
    return result.rows;
  });
  return rows.map(mapRow);
}

export async function countAssignmentSessionsForUser(userId: string): Promise<number> {
  const count = await withPgClient(async (client) => {
    const result = await client.query(
      `SELECT COUNT(*) AS count FROM assignment_sessions
       WHERE user_id = $1 AND ${ACTIVE_ASSIGNMENT_SESSION_SQL}`,
      [userId],
    );
    return result.rows[0]?.count ?? '0';
  });
  return Number.parseInt(count, 10);
}

async function findByCreationRequest(
  client: PoolClient,
  userId: string,
  requestId: string,
): Promise<AssignmentSessionRow | null> {
  const result = await client.query(
    `SELECT ${RETURNING_COLUMNS} FROM assignment_sessions
     WHERE user_id = $1 AND creation_request_id = $2`,
    [userId, requestId],
  );
  return result.rows[0] ?? null;
}

async function findOwnedById(
  client: PoolClient,
  id: string,
  userId: string,
): Promise<AssignmentSessionRow | null> {
  const result = await client.query(
    `SELECT ${RETURNING_COLUMNS} FROM assignment_sessions WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return result.rows[0] ?? null;
}

function assertStudentReplay(
  row: AssignmentSessionRow,
  params: ConfirmStudentAssignmentSessionParams,
): AssignmentSessionRecord {
  const session = mapRow(row);
  if (session.studentId !== params.studentId || session.lessonId !== params.lessonId) {
    throw new AssignmentSessionRequestConflictError(session);
  }
  return session;
}

function mapRow(row: AssignmentSessionRow): AssignmentSessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    studentId: row.student_id,
    lessonId: row.lesson_id ?? null,
    recordingId: row.recording_id ?? null,
    transcriptId: row.transcript_id ?? null,
    promptPackageId: row.prompt_package_id ?? null,
    draftId: row.draft_id ?? null,
    revision: row.revision,
    confirmedStep: row.confirmed_step,
    confirmed: AssignmentConfirmedSnapshotSchema.parse(row.confirmed_snapshot),
    creationRequestId: row.creation_request_id ?? null,
    publishTarget: row.publish_target ?? null,
    selectedTtsProvider: row.selected_tts_provider ?? null,
    selectedTtsStrategy: row.selected_tts_strategy ?? null,
    selectedTtsModel: row.selected_tts_model ?? null,
    selectedPreset: row.selected_preset ?? null,
    selectedGenerationProvider: row.selected_generation_provider ?? null,
    selectedGenerationModel: row.selected_generation_model ?? null,
    teacherNotes: row.teacher_notes ?? null,
    selectedProfileId: row.selected_profile_id ?? null,
    selectedProfileRevisionId: row.selected_profile_revision_id ?? null,
    selectedProfileRevisionHash: row.selected_profile_revision_hash ?? null,
    shareJobId: row.share_job_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isUniqueViolation(
  error: unknown,
): error is { code: '23505'; constraint?: unknown } {
  return !!error && typeof error === 'object' && 'code' in error && error.code === '23505';
}

function isNamedUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    isUniqueViolation(error) &&
    'constraint' in error &&
    typeof error.constraint === 'string' &&
    error.constraint === constraint
  );
}
