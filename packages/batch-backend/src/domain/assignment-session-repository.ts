import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type {
  AssignmentConfirmedSnapshot,
  AssignmentConfirmedStep,
  AssignmentInvalidatedArtifact,
  ConfirmAssignmentSessionStepRequest,
  GenerationProvider,
  PublishAssignmentCorrectionRequest,
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
import type { DraftRecord } from './draft-model.js';
import { getDraftByIdForUpdate } from './draft-repository.js';
import { insertJobActionHistory } from './job-action-history-repository.js';
import { JobActionType } from './job-actions.js';
import type { JobRecord } from './job-model.js';
import {
  getJobById,
  type InsertJobParams,
  insertApprovalJob,
  insertJob,
  resetFailedAssignmentCorrectionJob,
} from './job-repository.js';
import { reconcileInitialEnrichmentIntent } from './profile-initial-enrichment-repository.js';
import { getTranscriptByIdForUpdateForUser } from './transcript-repository.js';

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

export interface AttachAssignmentSourceParams {
  id: string;
  userId: string;
  expectedRevision: number;
  recordingId: string;
  transcriptId: string;
}

export type AttachAssignmentSourceResult =
  | { outcome: 'source_attached'; session: AssignmentSessionRecord }
  | { outcome: 'existing_assignment_resumed'; session: AssignmentSessionRecord };

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

export interface PublishAssignmentCorrectionJobParams {
  userId: string;
  publishedJobId: string;
  request: PublishAssignmentCorrectionRequest;
}

export interface PublishAssignmentCorrectionJobResult {
  job: JobRecord;
  created: boolean;
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

export class AssignmentRecoveryLineageError extends Error {
  readonly code = 'ASSIGNMENT_RECOVERY_LINEAGE_INVALID';

  constructor() {
    super('Assignment recovery cannot combine a prompt with a draft from another prompt.');
    this.name = 'AssignmentRecoveryLineageError';
  }
}

export class AssignmentSourceIdentityRequiredError extends Error {
  readonly code = 'SOURCE_IDENTITY_REQUIRED';

  constructor() {
    super('This historical source must be reacquired before it can become canonical.');
    this.name = 'AssignmentSourceIdentityRequiredError';
  }
}

export class AssignmentSessionRequestConflictError extends Error {
  readonly code = 'ASSIGNMENT_SESSION_REQUEST_CONFLICT';

  constructor(readonly session: AssignmentSessionRecord) {
    super('Student confirmation request ID was already used with different input.');
    this.name = 'AssignmentSessionRequestConflictError';
  }
}

export class AssignmentCorrectionError extends Error {
  constructor(
    readonly code:
      | 'ASSIGNMENT_CORRECTION_NOT_FOUND'
      | 'ASSIGNMENT_CORRECTION_PARENT_INVALID'
      | 'ASSIGNMENT_CORRECTION_SESSION_LINEAGE_INVALID'
      | 'ASSIGNMENT_CORRECTION_DRAFT_CONFLICT'
      | 'ASSIGNMENT_CORRECTION_REQUEST_CONFLICT',
  ) {
    super(code);
    this.name = 'AssignmentCorrectionError';
  }
}

export class AssignmentSessionConfirmationError extends Error {
  constructor(
    readonly code:
      | 'ASSIGNMENT_STEP_PREREQUISITE_MISSING'
      | 'ASSIGNMENT_STEP_LINEAGE_INVALID'
      | 'ASSIGNMENT_STEP_SPEAKER_ROLE_MAPPING_REQUIRED'
      | 'ASSIGNMENT_STEP_ARTIFACT_NOT_FOUND'
      | 'ASSIGNMENT_STEP_SOURCE_NOT_ATTACHED'
      | 'ASSIGNMENT_STEP_PROFILE_STALE',
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
  const transcript = await getTranscriptByIdForUpdateForUser(
    client,
    request.transcriptId,
    params.userId,
  );
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
  const recording = await client.query<{
    student_id: string | null;
    audio_topology: string | null;
    source_identity_kind: 'audio' | 'manual_transcript' | null;
    source_fingerprint_scheme: string | null;
    source_fingerprint: string | null;
  }>(
    `SELECT r.student_id, r.audio_topology, r.source_identity_kind,
            r.source_fingerprint_scheme, r.source_fingerprint
     FROM recordings r
     JOIN students s ON s.id = r.student_id AND s.workspace_id = r.workspace_id
     JOIN workspace_memberships wm ON wm.workspace_id = r.workspace_id AND wm.user_id = $2
     WHERE r.id = $1`,
    [request.recordingId, params.userId],
  );
  if (!recording.rows[0] || recording.rows[0].student_id !== current.studentId) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_LINEAGE_INVALID');
  }
  const sourceIdentity = recording.rows[0];
  if (
    !sourceIdentity.source_identity_kind ||
    !sourceIdentity.source_fingerprint_scheme ||
    !sourceIdentity.source_fingerprint
  ) {
    throw new AssignmentSourceIdentityRequiredError();
  }
  const binding = await client.query<{
    assignment_session_id: string;
    binding_role: 'confirmed' | 'working';
  }>(
    `SELECT assignment_session_id, binding_role
     FROM assignment_source_bindings
     WHERE user_id = $1 AND student_id = $2 AND source_identity_kind = $3
       AND source_fingerprint_scheme = $4 AND source_fingerprint = $5
     FOR UPDATE`,
    [
      params.userId,
      current.studentId,
      sourceIdentity.source_identity_kind,
      sourceIdentity.source_fingerprint_scheme,
      sourceIdentity.source_fingerprint,
    ],
  );
  if (binding.rows[0]?.assignment_session_id !== current.id) {
    if (binding.rows[0]) {
      const owner = await findOwnedById(
        client,
        binding.rows[0].assignment_session_id,
        params.userId,
      );
      if (owner) throw new AssignmentSourceOwnershipConflictError(mapRow(owner));
    }
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_SOURCE_NOT_ATTACHED');
  }
  if (
    recording.rows[0].audio_topology === 'mixed_recording' &&
    !hasTutorConfirmedSpeakerRoleMapping(transcript.summaryJson ?? null, transcript)
  ) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_SPEAKER_ROLE_MAPPING_REQUIRED');
  }
  if (request.lessonId) {
    const lesson = await client.query(
      `SELECT 1 FROM student_lessons sl
       JOIN students s ON s.id = sl.student_id
       JOIN workspace_memberships wm ON wm.workspace_id = s.workspace_id
       WHERE sl.id = $1 AND sl.student_id = $2 AND wm.user_id = $3`,
      [request.lessonId, current.studentId, params.userId],
    );
    if (!lesson.rows[0]) {
      throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_LINEAGE_INVALID');
    }
  }

  // Source confirmation and the retained-audio deletion request are one
  // authoritative transaction. Replays repair a missing request timestamp but
  // never reset attempts or move an in-progress/final lifecycle backwards.
  await client.query(
    `UPDATE recordings
     SET audio_lifecycle = CASE WHEN audio_lifecycle = 'retained' THEN 'pending' ELSE audio_lifecycle END,
         audio_deletion_requested_at = CASE
           WHEN audio_lifecycle = 'not_retained' THEN audio_deletion_requested_at
           ELSE COALESCE(audio_deletion_requested_at, now())
         END,
         updated_at = CASE WHEN audio_lifecycle = 'retained' THEN now() ELSE updated_at END
     WHERE id = $1`,
    [request.recordingId],
  );

  const source = {
    lessonId: request.lessonId,
    recordingId: request.recordingId,
    transcriptId: transcript.id,
    transcriptWorkingVersion: transcript.workingVersion,
    transcriptStorageUri: transcript.storageUri,
    transcriptHash: transcript.contentHash,
    sourceIdentityKind: sourceIdentity.source_identity_kind,
    sourceFingerprintScheme: sourceIdentity.source_fingerprint_scheme,
    sourceFingerprint: sourceIdentity.source_fingerprint,
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
    await reconcileInitialEnrichmentIntent(client, current);
    return { session: current, invalidated: [], lessonMemoryIntent: intent };
  }
  assertExpectedRevision(current, request.expectedRevision);

  const confirmed: AssignmentConfirmedSnapshot = {
    student: current.confirmed.student,
    source,
    context: null,
    create: null,
  };
  if (binding.rows[0].binding_role === 'working') {
    await client.query(
      `DELETE FROM assignment_source_bindings
       WHERE assignment_session_id = $1 AND binding_role = 'confirmed'`,
      [current.id],
    );
    await client.query(
      `UPDATE assignment_source_bindings
       SET binding_role = 'confirmed', recording_id = $2, transcript_id = $3, updated_at = NOW()
       WHERE assignment_session_id = $1 AND binding_role = 'working'`,
      [current.id, request.recordingId, request.transcriptId],
    );
  } else {
    await client.query(
      `UPDATE assignment_source_bindings
       SET recording_id = $2, transcript_id = $3, updated_at = NOW()
       WHERE assignment_session_id = $1 AND binding_role = 'confirmed'`,
      [current.id, request.recordingId, request.transcriptId],
    );
  }
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
  await reconcileInitialEnrichmentIntent(client, updated);
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
  await assertConfirmedSourceIsCurrent(client, current, params.userId);
  const profileValues = [request.profileId, request.profileRevisionId, request.profileRevisionHash];
  if (
    profileValues.some((value) => value !== null) &&
    profileValues.some((value) => value === null)
  ) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_LINEAGE_INVALID');
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
  const active = await client.query<{
    profile_id: string;
    active_revision_id: string | null;
    content_hash: string | null;
  }>(
    `SELECT p.id AS profile_id, p.active_revision_id, pr.content_hash
     FROM student_profile_bindings b JOIN profiles p ON p.id = b.profile_id
     LEFT JOIN profile_revisions pr ON pr.id = p.active_revision_id
     WHERE b.student_id = $1 AND b.effective_to IS NULL
     FOR UPDATE OF p`,
    [current.studentId],
  );
  const authoritative = active.rows[0];
  if (
    (authoritative?.active_revision_id ?? null) !== request.profileRevisionId ||
    (authoritative?.active_revision_id ? authoritative.profile_id : null) !== request.profileId ||
    (authoritative?.content_hash ?? null) !== request.profileRevisionHash
  ) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_PROFILE_STALE');
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
  await assertConfirmedSourceIsCurrent(client, current, params.userId);
  const context = current.confirmed.context;
  if (
    current.teacherNotes !== context.teacherNotes ||
    current.selectedProfileId !== context.profileId ||
    current.selectedProfileRevisionId !== context.profileRevisionId ||
    current.selectedProfileRevisionHash !== context.profileRevisionHash
  ) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_PREREQUISITE_MISSING');
  }
  const authorized = await getAuthorizedCreateLineageForUpdate(client, {
    draftId: request.draftId,
    promptPackageId: request.promptPackageId,
    userId: params.userId,
    studentId: current.studentId,
    recordingId: source.recordingId,
    transcriptId: source.transcriptId,
    lessonId: source.lessonId,
  });
  if (!authorized) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_ARTIFACT_NOT_FOUND');
  }
  const { draft, packageRow } = authorized;
  if (draft.workingVersion === null || draft.contentHash === null) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_LINEAGE_INVALID');
  }
  if (draft.workingVersion !== request.draftWorkingVersion) {
    throw new ArtifactWorkingConflictError(draft);
  }
  if (
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

interface AuthorizedCreatePackageRow {
  id: string;
  notes: string | null;
  resolved_profile_id: string | null;
  resolved_profile_revision_id: string | null;
  resolved_profile_hash: string | null;
  resolved_profile_revision_content_hash: string | null;
}

async function getAuthorizedCreateLineageForUpdate(
  client: PoolClient,
  params: {
    draftId: string;
    promptPackageId: string;
    userId: string;
    studentId: string;
    recordingId: string;
    transcriptId: string;
    lessonId: string | null;
  },
): Promise<{ draft: DraftRecord; packageRow: AuthorizedCreatePackageRow } | null> {
  const result = await client.query<
    AuthorizedCreatePackageRow & {
      draft_id: string;
      draft_prompt_package_id: string;
      draft_student_id: string | null;
      draft_lesson_id: string | null;
      draft_storage_uri: string;
      draft_working_version: number | null;
      draft_content_hash: string | null;
      draft_created_by: string | null;
      draft_created_at: Date;
      draft_updated_at: Date;
    }
  >(
    `SELECT
       pp.id,
       pp.notes,
       pp.resolved_profile_id,
       pp.resolved_profile_revision_id,
       pp.resolved_profile_hash,
       pr.content_hash AS resolved_profile_revision_content_hash,
       d.id AS draft_id,
       d.prompt_package_id AS draft_prompt_package_id,
       d.student_id AS draft_student_id,
       d.lesson_id AS draft_lesson_id,
       d.storage_uri AS draft_storage_uri,
       d.working_version AS draft_working_version,
       d.content_hash AS draft_content_hash,
       d.created_by AS draft_created_by,
       d.created_at AS draft_created_at,
       d.updated_at AS draft_updated_at
     FROM drafts d
     JOIN prompt_packages pp ON pp.id = d.prompt_package_id
     JOIN recordings r ON r.id = pp.recording_id
     JOIN transcripts t ON t.id = pp.transcript_id AND t.recording_id = r.id
     JOIN workspace_memberships wm ON wm.workspace_id = r.workspace_id
     LEFT JOIN profile_revisions pr
       ON pr.id = pp.resolved_profile_revision_id AND pr.profile_id = pp.resolved_profile_id
     WHERE d.id = $1
       AND pp.id = $2
       AND wm.user_id = $3
       AND r.student_id = $4
       AND pp.student_id = $4
       AND d.student_id = $4
       AND r.id = $5
       AND t.id = $6
       AND pp.lesson_id IS NOT DISTINCT FROM $7::uuid
       AND d.lesson_id IS NOT DISTINCT FROM $7::uuid
     FOR UPDATE OF d`,
    [
      params.draftId,
      params.promptPackageId,
      params.userId,
      params.studentId,
      params.recordingId,
      params.transcriptId,
      params.lessonId,
    ],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    packageRow: row,
    draft: {
      id: row.draft_id,
      promptPackageId: row.draft_prompt_package_id,
      studentId: row.draft_student_id,
      lessonId: row.draft_lesson_id,
      storageUri: row.draft_storage_uri,
      workingVersion: row.draft_working_version,
      contentHash: row.draft_content_hash,
      createdBy: row.draft_created_by,
      createdAt: row.draft_created_at,
      updatedAt: row.draft_updated_at,
    },
  };
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
  const exact = await client.query<{
    id: string;
    status: string;
    assignment_session_id: string | null;
  }>(
    `SELECT id, status, assignment_session_id FROM lesson_memory_entries
     WHERE transcript_id = $1 AND source_content_hash = $2 FOR UPDATE`,
    [source.transcriptId, source.transcriptHash],
  );
  const entryId = exact.rows[0]?.id ?? randomUUID();
  if (exact.rows[0] && exact.rows[0].assignment_session_id !== session.id) {
    await client.query(
      `UPDATE lesson_memory_entries
       SET assignment_session_id = $2, updated_at = NOW()
       WHERE id = $1`,
      [entryId, session.id],
    );
  }
  let outcome: ConfirmedLessonMemoryIntent['outcome'] = 'pending_exists';
  if (!exact.rows[0]) {
    outcome = 'created';
    await client.query(
      `INSERT INTO lesson_memory_entries (
         id, student_id, transcript_id, recording_id, assignment_session_id, schema_version, generated_at,
         provider, model, status, source_kind, source_storage_uri, source_content_hash,
         generation_notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', 'lesson_transcript', $10, $11, $12::jsonb)`,
      [
        entryId,
        session.studentId,
        source.transcriptId,
        source.recordingId,
        session.id,
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
      `UPDATE lesson_memory_entries SET status = 'pending', assignment_session_id = $3, superseded_by_id = NULL,
       superseded_at = NULL, generated_at = $2, updated_at = NOW() WHERE id = $1`,
      [entryId, lessonMemory.requestedAt, session.id],
    );
  } else if (exact.rows[0].status === 'superseded') {
    outcome = 'created';
    await client.query(
      `UPDATE lesson_memory_entries SET status = 'pending', assignment_session_id = $3, superseded_by_id = NULL,
       superseded_at = NULL, generated_at = $2, updated_at = NOW() WHERE id = $1`,
      [entryId, lessonMemory.requestedAt, session.id],
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
  userId: string,
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
  const transcript = await getTranscriptByIdForUpdateForUser(client, source.transcriptId, userId);
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
  if (!source.sourceIdentityKind || !source.sourceFingerprintScheme || !source.sourceFingerprint) {
    throw new AssignmentSourceIdentityRequiredError();
  }
  const authority = await client.query(
    `SELECT 1 FROM assignment_source_bindings
     WHERE assignment_session_id = $1 AND binding_role = 'confirmed'
       AND user_id = $2 AND student_id = $3
       AND source_identity_kind = $4 AND source_fingerprint_scheme = $5
       AND source_fingerprint = $6 AND recording_id = $7 AND transcript_id = $8`,
    [
      session.id,
      userId,
      session.studentId,
      source.sourceIdentityKind,
      source.sourceFingerprintScheme,
      source.sourceFingerprint,
      source.recordingId,
      source.transcriptId,
    ],
  );
  if (!authority.rows[0]) {
    throw new AssignmentSessionConfirmationError('ASSIGNMENT_STEP_SOURCE_NOT_ATTACHED');
  }
}

function assertExpectedRevision(current: AssignmentSessionRecord, expectedRevision: number): void {
  if (current.revision !== expectedRevision)
    throw new AssignmentSessionRevisionConflictError(current);
}

function hasTutorConfirmedSpeakerRoleMapping(
  summaryJson: Record<string, unknown> | null,
  transcript: { workingVersion: number | null; contentHash: string | null },
): boolean {
  const mapping = summaryJson?.speakerRoleMapping;
  if (!mapping || typeof mapping !== 'object') return false;
  const typed = mapping as {
    version?: unknown;
    provenance?: unknown;
    roles?: unknown;
    confirmedWorkingVersion?: unknown;
    confirmedContentHash?: unknown;
  };
  return (
    typed.version === 'speaker-role-mapping-v1' &&
    typed.provenance === 'tutor_confirmed' &&
    Array.isArray(typed.roles) &&
    typed.roles.length > 0 &&
    typed.confirmedWorkingVersion === transcript.workingVersion &&
    typed.confirmedContentHash === transcript.contentHash
  );
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

export async function attachAssignmentSourceCandidate(
  params: AttachAssignmentSourceParams,
): Promise<AttachAssignmentSourceResult> {
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
      const candidateResult = await client.query<{
        workspace_id: string;
        source_identity_kind: 'audio' | 'manual_transcript' | null;
        source_fingerprint_scheme: string | null;
        source_fingerprint: string | null;
      }>(
        `SELECT r.workspace_id, r.source_identity_kind, r.source_fingerprint_scheme,
                r.source_fingerprint
         FROM recordings r
         JOIN transcripts t ON t.recording_id = r.id
         JOIN students s ON s.id = r.student_id AND s.workspace_id = r.workspace_id
         JOIN workspace_memberships wm ON wm.workspace_id = r.workspace_id AND wm.user_id = $3
         WHERE r.id = $1 AND t.id = $2 AND r.student_id = $4
         FOR UPDATE OF r, t`,
        [params.recordingId, params.transcriptId, params.userId, current.studentId],
      );
      const candidate = candidateResult.rows[0];
      if (!candidate) throw new AssignmentRecoveryLineageError();
      if (
        !candidate.source_identity_kind ||
        !candidate.source_fingerprint_scheme ||
        !candidate.source_fingerprint
      ) {
        throw new AssignmentSourceIdentityRequiredError();
      }

      const identityValues = [
        params.userId,
        current.studentId,
        candidate.source_identity_kind,
        candidate.source_fingerprint_scheme,
        candidate.source_fingerprint,
      ];
      const historicalLineage = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1
           FROM assignment_sessions
           WHERE id <> $1
             AND confirmed_snapshot #>> '{source,recordingId}' = $2
             AND confirmed_snapshot #>> '{source,transcriptId}' = $3
           UNION ALL
           SELECT 1
           FROM lesson_memory_entries
           WHERE assignment_session_id IS NOT NULL
             AND assignment_session_id <> $1
             AND recording_id = $2::uuid
             AND transcript_id = $3::uuid
         ) AS exists`,
        [current.id, params.recordingId, params.transcriptId],
      );
      const wasConfirmedByAnotherAssignment = historicalLineage.rows[0]?.exists === true;
      const ownerResult = await client.query<{
        assignment_session_id: string;
        recording_id: string;
        transcript_id: string;
      }>(
        `SELECT assignment_session_id, recording_id, transcript_id
         FROM assignment_source_bindings
         WHERE user_id = $1 AND student_id = $2 AND source_identity_kind = $3
           AND source_fingerprint_scheme = $4 AND source_fingerprint = $5
         FOR UPDATE`,
        identityValues,
      );
      const ownerId = ownerResult.rows[0]?.assignment_session_id;
      if (ownerId && ownerId !== current.id) {
        const ownerRow = await findOwnedById(client, ownerId, params.userId);
        if (!ownerRow) throw new AssignmentRecoveryLineageError();
        await retireUnownedLosingCandidateAudio(client, params.recordingId);
        await client.query('COMMIT');
        return { outcome: 'existing_assignment_resumed', session: mapRow(ownerRow) };
      }
      if (
        ownerId === current.id &&
        current.recordingId === params.recordingId &&
        current.transcriptId === params.transcriptId
      ) {
        await client.query('COMMIT');
        return { outcome: 'source_attached', session: current };
      }
      assertExpectedRevision(current, params.expectedRevision);

      let attachedRecordingId = params.recordingId;
      let attachedTranscriptId = params.transcriptId;
      if (!ownerId && wasConfirmedByAnotherAssignment) {
        attachedRecordingId = randomUUID();
        attachedTranscriptId = randomUUID();
        await client.query(
          `INSERT INTO recordings (
             id, source, student_id, source_path, storage_uri, sha256, bytes,
             duration_sec, channels, status, error, audio_topology, workspace_id,
             audio_lifecycle, media_preparation_version, source_identity_kind,
             source_fingerprint_scheme, source_fingerprint, created_at, updated_at
           )
           SELECT $2, source, student_id, source_path, NULL, sha256, bytes,
                  duration_sec, channels, 'transcribed', NULL, audio_topology, workspace_id,
                  'not_retained', media_preparation_version, source_identity_kind,
                  source_fingerprint_scheme, source_fingerprint, NOW(), NOW()
           FROM recordings WHERE id = $1`,
          [params.recordingId, attachedRecordingId],
        );
        await client.query(
          `INSERT INTO transcripts (
             id, recording_id, storage_uri, raw_response_uri, mode, model, language,
             fallback_used, summary_json, stt_provider, working_version, content_hash,
             created_at, updated_at
           )
           SELECT $4, $3, storage_uri, NULL, mode, model, language,
                  fallback_used, summary_json, stt_provider, working_version, content_hash,
                  NOW(), NOW()
           FROM transcripts WHERE id = $2 AND recording_id = $1`,
          [params.recordingId, params.transcriptId, attachedRecordingId, attachedTranscriptId],
        );
      }

      const confirmedIdentity = current.confirmed.source
        ? await client.query<{ matches: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM assignment_source_bindings
               WHERE assignment_session_id = $1 AND binding_role = 'confirmed'
                 AND source_identity_kind = $2 AND source_fingerprint_scheme = $3
                 AND source_fingerprint = $4
             ) AS matches`,
            [
              current.id,
              candidate.source_identity_kind,
              candidate.source_fingerprint_scheme,
              candidate.source_fingerprint,
            ],
          )
        : null;
      const sameAsConfirmed = confirmedIdentity?.rows[0]?.matches === true;

      if (!sameAsConfirmed) {
        await client.query(
          `DELETE FROM assignment_source_bindings
           WHERE assignment_session_id = $1 AND binding_role = 'working'`,
          [current.id],
        );
        await client.query(
          `INSERT INTO assignment_source_bindings (
             id, workspace_id, user_id, student_id, assignment_session_id,
             source_identity_kind, source_fingerprint_scheme, source_fingerprint,
             binding_role, recording_id, transcript_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'working', $9, $10)`,
          [
            randomUUID(),
            candidate.workspace_id,
            params.userId,
            current.studentId,
            current.id,
            candidate.source_identity_kind,
            candidate.source_fingerprint_scheme,
            candidate.source_fingerprint,
            attachedRecordingId,
            attachedTranscriptId,
          ],
        );
      }

      const updated = await client.query<AssignmentSessionRow>(
        `UPDATE assignment_sessions
         SET recording_id = $3, transcript_id = $4, revision = revision + 1, updated_at = NOW()
         WHERE id = $1 AND revision = $2
         RETURNING ${RETURNING_COLUMNS}`,
        [current.id, current.revision, attachedRecordingId, attachedTranscriptId],
      );
      if (!updated.rows[0]) throw new AssignmentSessionRevisionConflictError(current);
      await client.query('COMMIT');
      return { outcome: 'source_attached', session: mapRow(updated.rows[0]) };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isNamedUniqueViolation(error, 'idx_assignment_source_bindings_scoped_source')) {
        const ownerBinding = await client.query<{ assignment_session_id: string }>(
          `SELECT b.assignment_session_id
           FROM assignment_source_bindings b
           JOIN recordings r ON r.id = $2
           WHERE b.user_id = $1 AND b.student_id = r.student_id
             AND b.source_identity_kind = r.source_identity_kind
             AND b.source_fingerprint_scheme = r.source_fingerprint_scheme
             AND b.source_fingerprint = r.source_fingerprint
           LIMIT 1`,
          [params.userId, params.recordingId],
        );
        const ownerId = ownerBinding.rows[0]?.assignment_session_id;
        const owner = ownerId ? await findOwnedById(client, ownerId, params.userId) : null;
        if (owner) {
          await retireUnownedLosingCandidateAudio(client, params.recordingId);
          return { outcome: 'existing_assignment_resumed', session: mapRow(owner) };
        }
      }
      throw error;
    }
  });
}

async function retireUnownedLosingCandidateAudio(
  client: PoolClient,
  recordingId: string,
): Promise<void> {
  await client.query(
    `UPDATE recordings r
     SET audio_lifecycle = 'pending',
         audio_deletion_requested_at = COALESCE(audio_deletion_requested_at, now()),
         updated_at = now()
     WHERE r.id = $1
       AND r.audio_lifecycle = 'retained'
       AND NOT EXISTS (
         SELECT 1 FROM assignment_source_bindings b WHERE b.recording_id = r.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM assignment_sessions s
         WHERE s.confirmed_snapshot #>> '{source,recordingId}' = r.id::text
       )`,
    [recordingId],
  );
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
  const touchesSource = entries.some(
    ([field]) => field === 'recordingId' || field === 'transcriptId',
  );
  if (touchesSource) {
    if (entries.some(([field]) => field !== 'recordingId' && field !== 'transcriptId')) {
      throw new AssignmentRecoveryLineageError();
    }
    if (
      typeof params.patch.recordingId === 'string' &&
      typeof params.patch.transcriptId === 'string'
    ) {
      const result = await attachAssignmentSourceCandidate({
        id: params.id,
        userId: params.userId,
        expectedRevision: params.expectedRevision,
        recordingId: params.patch.recordingId,
        transcriptId: params.patch.transcriptId,
      });
      if (result.outcome === 'existing_assignment_resumed') {
        throw new AssignmentSourceOwnershipConflictError(result.session);
      }
      return result.session;
    }
    if (params.patch.recordingId !== null || params.patch.transcriptId !== null) {
      throw new AssignmentRecoveryLineageError();
    }
    return cancelWorkingAssignmentSource(params, entries);
  }

  return withPgClient(async (client) => {
    if (
      params.patch.recordingId !== undefined ||
      params.patch.transcriptId !== undefined ||
      params.patch.promptPackageId !== undefined ||
      params.patch.draftId !== undefined
    ) {
      const currentRow = await findOwnedById(client, params.id, params.userId);
      if (currentRow) {
        const current = mapRow(currentRow);
        if (current.revision === params.expectedRevision) {
          await assertRecoverySourceLineage(client, current, params.patch, params.userId);
          await assertRecoveryPromptDraftLineage(client, current, params.patch, params.userId);
        }
      }
    }
    const assignments: string[] = [];
    const values: unknown[] = [params.id, params.userId, params.expectedRevision];
    for (const [field, value] of entries) {
      values.push(value);
      assignments.push(`${RECOVERY_COLUMNS[field]} = $${values.length}`);
    }
    assignments.push('revision = revision + 1', 'updated_at = NOW()');

    const result = await client.query(
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

async function cancelWorkingAssignmentSource(
  params: UpdateAssignmentSessionRecoveryParams,
  entries: [keyof AssignmentSessionRecoveryPatch, unknown][],
): Promise<AssignmentSessionRecord> {
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
      assertExpectedRevision(current, params.expectedRevision);
      await client.query(
        `DELETE FROM assignment_source_bindings
         WHERE assignment_session_id = $1 AND binding_role = 'working'`,
        [current.id],
      );
      const assignments: string[] = [];
      const values: unknown[] = [current.id, current.revision];
      for (const [field, value] of entries) {
        if (field === 'recordingId' || field === 'transcriptId') continue;
        values.push(value);
        assignments.push(`${RECOVERY_COLUMNS[field]} = $${values.length}`);
      }
      values.push(current.confirmed.source?.recordingId ?? null);
      assignments.push(`recording_id = $${values.length}`);
      values.push(current.confirmed.source?.transcriptId ?? null);
      assignments.push(`transcript_id = $${values.length}`);
      assignments.push('revision = revision + 1', 'updated_at = NOW()');
      const updated = await client.query<AssignmentSessionRow>(
        `UPDATE assignment_sessions SET ${assignments.join(', ')}
         WHERE id = $1 AND revision = $2
         RETURNING ${RETURNING_COLUMNS}`,
        values,
      );
      if (!updated.rows[0]) throw new AssignmentSessionRevisionConflictError(current);
      await client.query('COMMIT');
      return mapRow(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function assertRecoverySourceLineage(
  client: PoolClient,
  current: AssignmentSessionRecord,
  patch: AssignmentSessionRecoveryPatch,
  userId: string,
): Promise<void> {
  const recordingId = patch.recordingId === undefined ? current.recordingId : patch.recordingId;
  const transcriptId = patch.transcriptId === undefined ? current.transcriptId : patch.transcriptId;
  if (!recordingId && !transcriptId) return;
  if (recordingId && !transcriptId) {
    const recording = await client.query(
      `SELECT 1 FROM recordings r
       JOIN workspace_memberships wm ON wm.workspace_id = r.workspace_id
       WHERE r.id = $1 AND r.student_id = $2 AND wm.user_id = $3`,
      [recordingId, current.studentId, userId],
    );
    if (!recording.rows[0]) throw new AssignmentRecoveryLineageError();
    return;
  }
  if (!recordingId && transcriptId) {
    const transcript = await client.query(
      `SELECT 1 FROM transcripts t
       JOIN recordings r ON r.id = t.recording_id
       JOIN workspace_memberships wm ON wm.workspace_id = r.workspace_id
       WHERE t.id = $1 AND r.student_id = $2 AND wm.user_id = $3`,
      [transcriptId, current.studentId, userId],
    );
    if (!transcript.rows[0]) throw new AssignmentRecoveryLineageError();
    return;
  }
  const result = await client.query(
    `SELECT 1 FROM recordings r
     JOIN transcripts t ON t.recording_id = r.id
     JOIN workspace_memberships wm ON wm.workspace_id = r.workspace_id
     WHERE r.id = $1 AND t.id = $2 AND r.student_id = $3 AND wm.user_id = $4`,
    [recordingId, transcriptId, current.studentId, userId],
  );
  if (!result.rows[0]) throw new AssignmentRecoveryLineageError();
}

async function assertRecoveryPromptDraftLineage(
  client: PoolClient,
  current: AssignmentSessionRecord,
  patch: AssignmentSessionRecoveryPatch,
  userId: string,
): Promise<void> {
  const promptPackageId =
    patch.promptPackageId === undefined ? current.promptPackageId : patch.promptPackageId;
  const draftId = patch.draftId === undefined ? current.draftId : patch.draftId;
  if (!promptPackageId && !draftId) return;
  if (!promptPackageId) throw new AssignmentRecoveryLineageError();

  const recordingId = patch.recordingId === undefined ? current.recordingId : patch.recordingId;
  const transcriptId = patch.transcriptId === undefined ? current.transcriptId : patch.transcriptId;
  if (!recordingId || !transcriptId) throw new AssignmentRecoveryLineageError();

  const params = [
    promptPackageId,
    userId,
    current.studentId,
    recordingId,
    transcriptId,
    current.lessonId,
  ];
  const commonSql = `
    JOIN recordings r ON r.id = pp.recording_id
    JOIN transcripts t ON t.id = pp.transcript_id AND t.recording_id = r.id
    JOIN workspace_memberships wm ON wm.workspace_id = r.workspace_id
    WHERE pp.id = $1
      AND wm.user_id = $2
      AND r.student_id = $3
      AND pp.student_id = $3
      AND r.id = $4
      AND t.id = $5
      AND pp.lesson_id IS NOT DISTINCT FROM $6::uuid`;

  const result = draftId
    ? await client.query(
        `SELECT 1
         FROM drafts d
         JOIN prompt_packages pp ON pp.id = d.prompt_package_id
         ${commonSql}
           AND d.id = $7
           AND d.student_id = $3
           AND d.lesson_id IS NOT DISTINCT FROM $6::uuid
         FOR UPDATE OF d`,
        [...params, draftId],
      )
    : await client.query(`SELECT 1 FROM prompt_packages pp ${commonSql}`, params);

  if (!result.rows[0]) throw new AssignmentRecoveryLineageError();
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
      const sourceAuthority = await client.query(
        `SELECT 1
         FROM assignment_source_bindings b
         WHERE b.assignment_session_id = $1 AND b.user_id = $2 AND b.student_id = $3
           AND b.binding_role = 'confirmed'
           AND b.source_identity_kind = $4 AND b.source_fingerprint_scheme = $5
           AND b.source_fingerprint = $6 AND b.recording_id = $7 AND b.transcript_id = $8`,
        [
          current.id,
          params.userId,
          current.studentId,
          source.sourceIdentityKind,
          source.sourceFingerprintScheme,
          source.sourceFingerprint,
          source.recordingId,
          source.transcriptId,
        ],
      );
      if (!sourceAuthority.rows[0]) {
        throw new AssignmentSessionShareError('ASSIGNMENT_SHARE_PREREQUISITE_MISSING');
      }
      const transcript = await getTranscriptByIdForUpdateForUser(
        client,
        source.transcriptId,
        params.userId,
      );
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

export async function publishAssignmentCorrectionJob(
  params: PublishAssignmentCorrectionJobParams,
): Promise<PublishAssignmentCorrectionJobResult> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        params.request.requestId,
      ]);
      const sessionResult = await client.query<AssignmentSessionRow>(
        `WITH RECURSIVE job_lineage AS (
           SELECT id, source_job_id FROM jobs WHERE id = $1
           UNION
           SELECT parent.id, parent.source_job_id
           FROM jobs parent
           JOIN job_lineage child ON parent.id = child.source_job_id
         )
         SELECT ${RETURNING_COLUMNS}
         FROM assignment_sessions
         WHERE user_id = $2
           AND confirmed_step = 'share'
           AND share_job_id IN (SELECT id FROM job_lineage)
         ORDER BY updated_at DESC, id DESC
         LIMIT 1
         FOR UPDATE`,
        [params.publishedJobId, params.userId],
      );
      const sessionRow = sessionResult.rows[0];
      if (!sessionRow) {
        throw new AssignmentCorrectionError('ASSIGNMENT_CORRECTION_SESSION_LINEAGE_INVALID');
      }
      const session = mapRow(sessionRow);
      const source = session.confirmed.source;
      const create = session.confirmed.create;
      const parent = await getJobById(params.publishedJobId, { client, forUpdate: true });
      if (!parent || parent.userId !== params.userId) {
        throw new AssignmentCorrectionError('ASSIGNMENT_CORRECTION_NOT_FOUND');
      }
      if (parent.state !== 'succeeded' || parent.publishTarget !== 'html' || !parent.htmlUrl) {
        throw new AssignmentCorrectionError('ASSIGNMENT_CORRECTION_PARENT_INVALID');
      }
      if (
        !source ||
        !create ||
        session.shareJobId === null ||
        parent.studentId !== session.studentId ||
        parent.recordingId !== source.recordingId ||
        parent.transcriptId !== source.transcriptId ||
        parent.promptPackageId !== create.promptPackageId ||
        parent.draftId !== create.draftId ||
        parent.lessonId !== source.lessonId
      ) {
        throw new AssignmentCorrectionError('ASSIGNMENT_CORRECTION_SESSION_LINEAGE_INVALID');
      }

      const existing = await getJobById(params.request.requestId, { client, forUpdate: true });
      if (existing) {
        const replay = await getCorrectionReplayPayload(client, parent.id, existing.id);
        if (
          existing.userId !== params.userId ||
          existing.sourceJobId !== parent.id ||
          existing.draftId !== params.request.draftId ||
          !storageUriMatchesHash(existing.mdStorageUri, params.request.draftHash) ||
          !correctionReplayMatches(replay, params)
        ) {
          throw new AssignmentCorrectionError('ASSIGNMENT_CORRECTION_REQUEST_CONFLICT');
        }
        const job =
          existing.state === 'failed'
            ? await resetFailedAssignmentCorrectionJob(
                {
                  jobId: existing.id,
                  sourceJobId: parent.id,
                  expectedMarkdownHash: params.request.draftHash,
                },
                { client },
              )
            : existing;
        if (!job) {
          throw new AssignmentCorrectionError('ASSIGNMENT_CORRECTION_REQUEST_CONFLICT');
        }
        await client.query('COMMIT');
        return { job, created: false };
      }

      if (create.draftId !== params.request.draftId) {
        throw new AssignmentCorrectionError('ASSIGNMENT_CORRECTION_DRAFT_CONFLICT');
      }
      const draft = await getDraftByIdForUpdate(client, params.request.draftId);
      if (
        !draft ||
        draft.promptPackageId !== create.promptPackageId ||
        draft.studentId !== session.studentId ||
        draft.workingVersion !== params.request.draftWorkingVersion ||
        draft.contentHash !== params.request.draftHash
      ) {
        throw new AssignmentCorrectionError('ASSIGNMENT_CORRECTION_DRAFT_CONFLICT');
      }

      const job = await insertJob(
        {
          id: params.request.requestId,
          md: null,
          mdStorageUri: draft.storageUri,
          recordingId: parent.recordingId,
          transcriptId: parent.transcriptId,
          promptPackageId: parent.promptPackageId,
          draftId: draft.id,
          studentId: parent.studentId,
          lessonId: parent.lessonId,
          preset: parent.preset ?? undefined,
          learningPresetId: parent.learningPresetId,
          learningPresetVersion: parent.learningPresetVersion,
          promptSnapshotVersion: parent.promptSnapshotVersion,
          promptAlias: parent.promptAlias,
          withTts: parent.withTts ?? undefined,
          upload: parent.upload,
          voiceId: parent.voiceId ?? undefined,
          voiceAccent: parent.voiceAccent ?? undefined,
          forceTts: parent.forceTts ?? undefined,
          publishTarget: parent.publishTarget ?? undefined,
          ttsStrategy: parent.ttsStrategy ?? undefined,
          ttsProvider: parent.ttsProvider ?? undefined,
          ttsModel: parent.ttsModel ?? undefined,
          userId: parent.userId ?? undefined,
          autoPublish: parent.autoPublish ?? undefined,
          sourceJobId: parent.id,
        },
        { client },
      );
      await insertJobActionHistory(
        {
          jobId: parent.id,
          actionType: JobActionType.RERUN,
          payload: correctionReplayPayload(params),
          requestedAt: new Date(),
          requestedBy: params.userId,
          outcome: 'succeeded',
          message: 'Correction child reserved',
          createdJobId: job.id,
        },
        { client },
      );
      await client.query('COMMIT');
      return { job, created: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

function storageUriMatchesHash(
  storageUri: string | null | undefined,
  contentHash: string,
): boolean {
  return storageUri?.endsWith(`/content/${contentHash}.md`) ?? false;
}

function correctionReplayPayload(
  params: PublishAssignmentCorrectionJobParams,
): Record<string, string | number> {
  return {
    operation: 'publish_correction',
    publishedJobId: params.publishedJobId,
    draftId: params.request.draftId,
    draftWorkingVersion: params.request.draftWorkingVersion,
    draftHash: params.request.draftHash,
  };
}

async function getCorrectionReplayPayload(
  client: PoolClient,
  parentJobId: string,
  childJobId: string,
): Promise<Record<string, unknown> | null> {
  const result = await client.query<{ payload_json: Record<string, unknown> | null }>(
    `SELECT payload_json
     FROM job_action_history
     WHERE job_id = $1
       AND created_job_id = $2
       AND action_type = $3
       AND payload_json #>> '{operation}' = 'publish_correction'
     ORDER BY created_at DESC, id DESC
     LIMIT 1
     FOR UPDATE`,
    [parentJobId, childJobId, JobActionType.RERUN],
  );
  return result.rows[0]?.payload_json ?? null;
}

function correctionReplayMatches(
  payload: Record<string, unknown> | null,
  params: PublishAssignmentCorrectionJobParams,
): boolean {
  return (
    payload?.operation === 'publish_correction' &&
    payload.publishedJobId === params.publishedJobId &&
    payload.draftId === params.request.draftId &&
    payload.draftWorkingVersion === params.request.draftWorkingVersion &&
    payload.draftHash === params.request.draftHash
  );
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

/** Recover a Source confirmation that waited for an older provider submission to settle. */
export async function reconcileDeferredInitialEnrichmentIntents(): Promise<void> {
  const candidates = await withPgClient(async (client) => {
    const result = await client.query<AssignmentSessionRow>(
      `SELECT a.*
       FROM assignment_sessions a
       JOIN students s ON s.id = a.student_id
       JOIN profiles p ON p.id = s.profile_id
       JOIN assignment_source_bindings b ON b.assignment_session_id = a.id
         AND b.binding_role = 'confirmed'
       WHERE p.provenance = 'tutor_only'
         AND a.confirmed_snapshot->'source' <> 'null'::jsonb
         AND a.confirmed_step <> 'share'
         AND a.id = (
           SELECT a2.id FROM assignment_sessions a2
           JOIN assignment_source_bindings b2 ON b2.assignment_session_id = a2.id
             AND b2.binding_role = 'confirmed'
           WHERE a2.student_id = a.student_id AND a2.confirmed_step <> 'share'
           ORDER BY a2.updated_at DESC, a2.id DESC LIMIT 1
         )
         AND NOT EXISTS (
           SELECT 1 FROM profile_initial_enrichment_operations op
           WHERE op.profile_id = p.id AND op.state IN
             ('waiting_evidence', 'queued', 'submitting', 'result_ready', 'uncertain', 'succeeded')
         )
         AND NOT EXISTS (
           SELECT 1 FROM profile_initial_enrichment_operations op
           WHERE op.profile_id = p.id AND op.assignment_session_id = a.id
             AND op.transcript_id = (a.confirmed_snapshot->'source'->>'transcriptId')::uuid
             AND op.transcript_hash = a.confirmed_snapshot->'source'->>'transcriptHash'
         )
       ORDER BY a.updated_at DESC LIMIT 50`,
    );
    return result.rows.map(mapRow);
  });
  const seenProfiles = new Set<string>();
  for (const candidate of candidates) {
    const profileId = await withPgClient(async (client) => {
      const result = await client.query<{ profile_id: string | null }>(
        'SELECT profile_id FROM students WHERE id = $1',
        [candidate.studentId],
      );
      return result.rows[0]?.profile_id ?? null;
    });
    if (!profileId || seenProfiles.has(profileId)) continue;
    seenProfiles.add(profileId);
    await withPgClient(async (client) => {
      await client.query('BEGIN');
      try {
        const lockedResult = await client.query<AssignmentSessionRow>(
          `SELECT ${RETURNING_COLUMNS} FROM assignment_sessions
           WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [candidate.id, candidate.userId],
        );
        const locked = lockedResult.rows[0];
        if (locked) await reconcileInitialEnrichmentIntent(client, mapRow(locked));
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }
}

export async function getCanonicalAssignmentSessionBySourceIdentity(params: {
  userId: string;
  studentId: string;
  sourceIdentityKind: 'audio' | 'manual_transcript';
  sourceFingerprintScheme: string;
  sourceFingerprint: string;
}): Promise<AssignmentSessionRecord | null> {
  return withPgClient(async (client) => {
    const result = await client.query<AssignmentSessionRow>(
      `SELECT ${RETURNING_COLUMNS}
       FROM assignment_sessions
       WHERE id = (
         SELECT assignment_session_id
         FROM assignment_source_bindings
         WHERE user_id = $1 AND student_id = $2
           AND source_identity_kind = $3 AND source_fingerprint_scheme = $4
           AND source_fingerprint = $5
       )`,
      [
        params.userId,
        params.studentId,
        params.sourceIdentityKind,
        params.sourceFingerprintScheme,
        params.sourceFingerprint,
      ],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  });
}

export async function getCanonicalAssignmentSessionBySourceRecording(params: {
  userId: string;
  studentId: string;
  recordingId: string;
}): Promise<AssignmentSessionRecord | null> {
  return withPgClient(async (client) => {
    const result = await client.query<AssignmentSessionRow>(
      `SELECT ${RETURNING_COLUMNS}
       FROM assignment_sessions
       WHERE id = (
         SELECT b.assignment_session_id
         FROM assignment_source_bindings b
         JOIN recordings r ON r.id = $3
         WHERE b.user_id = $1 AND b.student_id = $2
           AND b.source_identity_kind = r.source_identity_kind
           AND b.source_fingerprint_scheme = r.source_fingerprint_scheme
           AND b.source_fingerprint = r.source_fingerprint
       )`,
      [params.userId, params.studentId, params.recordingId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  });
}

export async function isAssignmentConfirmedSourceCanonical(
  sessionId: string,
  userId: string,
  lineage?: { recordingId: string; transcriptId: string },
): Promise<boolean> {
  return withPgClient(async (client) => {
    const result = await client.query(
      `SELECT 1
       FROM assignment_source_bindings b
       JOIN assignment_sessions s ON s.id = b.assignment_session_id
       WHERE b.assignment_session_id = $1 AND b.user_id = $2
         AND b.binding_role = 'confirmed'
         AND s.confirmed_snapshot #>> '{source,sourceIdentityKind}' = b.source_identity_kind
         AND s.confirmed_snapshot #>> '{source,sourceFingerprintScheme}' = b.source_fingerprint_scheme
         AND s.confirmed_snapshot #>> '{source,sourceFingerprint}' = b.source_fingerprint
         AND (s.confirmed_snapshot #>> '{source,recordingId}')::uuid = b.recording_id
         AND (s.confirmed_snapshot #>> '{source,transcriptId}')::uuid = b.transcript_id
         AND ($3::uuid IS NULL OR b.recording_id = $3)
         AND ($4::uuid IS NULL OR b.transcript_id = $4)`,
      [sessionId, userId, lineage?.recordingId ?? null, lineage?.transcriptId ?? null],
    );
    return Boolean(result.rows[0]);
  });
}

export async function remapCanonicalAssignmentSource(params: {
  userId: string;
  targetSessionId: string;
  reason: string;
}): Promise<{ previousSessionId: string; session: AssignmentSessionRecord; changed: boolean }> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      const targetResult = await client.query<AssignmentSessionRow>(
        `SELECT ${RETURNING_COLUMNS} FROM assignment_sessions
         WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [params.targetSessionId, params.userId],
      );
      if (!targetResult.rows[0]) {
        throw new AssignmentSessionRepositoryError('ASSIGNMENT_SESSION_NOT_FOUND');
      }
      const target = mapRow(targetResult.rows[0]);
      const source = target.confirmed.source;
      if (
        !source?.sourceIdentityKind ||
        !source.sourceFingerprintScheme ||
        !source.sourceFingerprint
      ) {
        throw new AssignmentSourceIdentityRequiredError();
      }
      if (
        target.recordingId !== source.recordingId ||
        target.transcriptId !== source.transcriptId
      ) {
        throw new Error('Operator remap target does not have its confirmed source lineage loaded.');
      }
      const targetLineage = await client.query<{
        workspace_id: string;
        source_identity_kind: string | null;
        source_fingerprint_scheme: string | null;
        source_fingerprint: string | null;
      }>(
        `SELECT r.workspace_id, r.source_identity_kind, r.source_fingerprint_scheme,
                r.source_fingerprint
         FROM recordings r
         JOIN transcripts t ON t.id = $2 AND t.recording_id = r.id
         WHERE r.id = $1 AND r.student_id = $3
         FOR SHARE OF r, t`,
        [source.recordingId, source.transcriptId, target.studentId],
      );
      const lineage = targetLineage.rows[0];
      if (
        !lineage ||
        lineage.source_identity_kind !== source.sourceIdentityKind ||
        lineage.source_fingerprint_scheme !== source.sourceFingerprintScheme ||
        lineage.source_fingerprint !== source.sourceFingerprint
      ) {
        throw new Error('Operator remap target source provenance does not match durable identity.');
      }
      const bindingResult = await client.query<{
        id: string;
        assignment_session_id: string;
      }>(
        `SELECT id, assignment_session_id
         FROM assignment_source_bindings
         WHERE user_id = $1 AND student_id = $2 AND source_identity_kind = $3
           AND source_fingerprint_scheme = $4 AND source_fingerprint = $5
           AND binding_role = 'confirmed'
         FOR UPDATE`,
        [
          params.userId,
          target.studentId,
          source.sourceIdentityKind,
          source.sourceFingerprintScheme,
          source.sourceFingerprint,
        ],
      );
      const binding = bindingResult.rows[0];
      if (!binding) throw new Error('Operator remap requires an existing canonical source owner.');
      if (binding.assignment_session_id === target.id) {
        await client.query('COMMIT');
        return { previousSessionId: target.id, session: target, changed: false };
      }
      const occupiedTargetSlot = await client.query(
        `SELECT 1 FROM assignment_source_bindings
         WHERE assignment_session_id = $1 AND binding_role = 'confirmed' FOR UPDATE`,
        [target.id],
      );
      if (occupiedTargetSlot.rows[0]) {
        throw new Error('Operator remap target already owns a different canonical source.');
      }
      await client.query(
        `UPDATE assignment_source_bindings
         SET assignment_session_id = $2, recording_id = $3, transcript_id = $4,
             workspace_id = $5, updated_at = NOW()
         WHERE id = $1`,
        [binding.id, target.id, source.recordingId, source.transcriptId, lineage.workspace_id],
      );
      await client.query(
        `INSERT INTO assignment_source_binding_audit (
           id, workspace_id, user_id, student_id, source_identity_kind,
           source_fingerprint_scheme, source_fingerprint, prior_assignment_session_id,
           canonical_assignment_session_id, action, reason
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'operator_remap', $10)`,
        [
          randomUUID(),
          lineage.workspace_id,
          params.userId,
          target.studentId,
          source.sourceIdentityKind,
          source.sourceFingerprintScheme,
          source.sourceFingerprint,
          binding.assignment_session_id,
          target.id,
          params.reason,
        ],
      );
      await client.query('COMMIT');
      return {
        previousSessionId: binding.assignment_session_id,
        session: target,
        changed: true,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
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

function isUniqueViolation(error: unknown): error is { code: '23505'; constraint?: unknown } {
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
