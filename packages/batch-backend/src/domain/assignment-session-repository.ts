import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type {
  AssignmentConfirmedSnapshot,
  AssignmentConfirmedStep,
  GenerationProvider,
  PublishTarget,
  TtsProviderId,
  TtsStrategy,
} from '@esl-pipeline/contracts';

import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import {
  AssignmentConfirmedSnapshotSchema,
  type AssignmentSessionRecord,
} from './assignment-session-model.js';

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

export class AssignmentSessionRequestConflictError extends Error {
  readonly code = 'ASSIGNMENT_SESSION_REQUEST_CONFLICT';

  constructor(readonly session: AssignmentSessionRecord) {
    super('Student confirmation request ID was already used with different input.');
    this.name = 'AssignmentSessionRequestConflictError';
  }
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
  const row = await withPgClient(async (client) => {
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
  });
  return row ? mapRow(row) : null;
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

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === '23505';
}
