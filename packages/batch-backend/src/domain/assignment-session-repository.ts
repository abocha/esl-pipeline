import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type {
  GenerationProvider,
  PublishTarget,
  TtsProviderId,
  TtsStrategy,
} from '@esl-pipeline/contracts';

import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import type {
  AssignmentSessionRecord,
  AssignmentSessionStage,
} from './assignment-session-model.js';

interface AssignmentSessionRow {
  id: string;
  user_id: string;
  student_id: string | null;
  lesson_id: string | null;
  recording_id: string | null;
  transcript_id: string | null;
  prompt_package_id: string | null;
  draft_id: string | null;
  current_stage: AssignmentSessionStage;
  publish_target: PublishTarget | null;
  selected_tts_provider: TtsProviderId | null;
  selected_tts_strategy: TtsStrategy | null;
  selected_tts_model: string | null;
  selected_preset: string | null;
  selected_generation_provider: GenerationProvider | null;
  selected_generation_model: string | null;
  teacher_notes: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

export interface AssignmentSessionPatch {
  studentId?: string | null;
  lessonId?: string | null;
  recordingId?: string | null;
  transcriptId?: string | null;
  promptPackageId?: string | null;
  draftId?: string | null;
  currentStage?: AssignmentSessionStage;
  publishTarget?: PublishTarget | null;
  selectedTtsProvider?: TtsProviderId | null;
  selectedTtsStrategy?: TtsStrategy | null;
  selectedTtsModel?: string | null;
  selectedPreset?: string | null;
  selectedGenerationProvider?: GenerationProvider | null;
  selectedGenerationModel?: string | null;
  teacherNotes?: string | null;
}

export interface CreateAssignmentSessionParams extends AssignmentSessionPatch {
  userId: string;
}

export interface UpdateAssignmentSessionParams extends AssignmentSessionPatch {
  id: string;
  userId: string;
}

const RETURNING_COLUMNS = `
  id,
  user_id,
  student_id,
  lesson_id,
  recording_id,
  transcript_id,
  prompt_package_id,
  draft_id,
  current_stage,
  publish_target,
  selected_tts_provider,
  selected_tts_strategy,
  selected_tts_model,
  selected_preset,
  selected_generation_provider,
  selected_generation_model,
  teacher_notes,
  created_at,
  updated_at,
  archived_at
`;

const FIELD_COLUMNS = {
  studentId: 'student_id',
  lessonId: 'lesson_id',
  recordingId: 'recording_id',
  transcriptId: 'transcript_id',
  promptPackageId: 'prompt_package_id',
  draftId: 'draft_id',
  currentStage: 'current_stage',
  publishTarget: 'publish_target',
  selectedTtsProvider: 'selected_tts_provider',
  selectedTtsStrategy: 'selected_tts_strategy',
  selectedTtsModel: 'selected_tts_model',
  selectedPreset: 'selected_preset',
  selectedGenerationProvider: 'selected_generation_provider',
  selectedGenerationModel: 'selected_generation_model',
  teacherNotes: 'teacher_notes',
} as const satisfies Record<keyof AssignmentSessionPatch, string>;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

async function findActiveSessionByRecording(
  client: PoolClient,
  userId: string,
  recordingId: string,
): Promise<AssignmentSessionRow | null> {
  const existing = await client.query(
    `
    SELECT ${RETURNING_COLUMNS}
    FROM assignment_sessions
    WHERE user_id = $1
      AND recording_id = $2
      AND archived_at IS NULL
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [userId, recordingId],
  );
  return existing.rows[0] ?? null;
}

export async function createOrReuseAssignmentSession(
  params: CreateAssignmentSessionParams,
): Promise<AssignmentSessionRecord> {
  const now = new Date();

  const row = await withPgClient(async (client: PoolClient) => {
    if (params.recordingId) {
      const existing = await findActiveSessionByRecording(
        client,
        params.userId,
        params.recordingId,
      );
      if (existing) {
        return updateAssignmentSessionInClient(client, {
          ...params,
          id: existing.id,
        });
      }
    }

    const id = randomUUID();
    let result;
    try {
      result = await client.query(
        `
        INSERT INTO assignment_sessions (
          id,
          user_id,
          student_id,
          lesson_id,
          recording_id,
          transcript_id,
          prompt_package_id,
          draft_id,
          current_stage,
          publish_target,
          selected_tts_provider,
          selected_tts_strategy,
          selected_tts_model,
          selected_preset,
          selected_generation_provider,
          selected_generation_model,
          teacher_notes,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18
        )
        RETURNING ${RETURNING_COLUMNS}
        `,
        [
          id,
          params.userId,
          params.studentId ?? null,
          params.lessonId ?? null,
          params.recordingId ?? null,
          params.transcriptId ?? null,
          params.promptPackageId ?? null,
          params.draftId ?? null,
          params.currentStage ?? 'source',
          params.publishTarget ?? null,
          params.selectedTtsProvider ?? null,
          params.selectedTtsStrategy ?? null,
          params.selectedTtsModel ?? null,
          params.selectedPreset ?? null,
          params.selectedGenerationProvider ?? null,
          params.selectedGenerationModel ?? null,
          params.teacherNotes ?? null,
          now,
        ],
      );
    } catch (error) {
      if (!params.recordingId || !isUniqueViolation(error)) {
        throw error;
      }
      const existing = await findActiveSessionByRecording(
        client,
        params.userId,
        params.recordingId,
      );
      if (!existing) {
        throw error;
      }
      return updateAssignmentSessionInClient(client, {
        ...params,
        id: existing.id,
      });
    }
    return result.rows[0];
  });

  logger.info('Assignment session created or reused', {
    assignmentSessionId: row.id,
    userId: params.userId,
  });
  return mapRow(row);
}

export async function updateAssignmentSession(
  params: UpdateAssignmentSessionParams,
): Promise<AssignmentSessionRecord | null> {
  const row = await withPgClient((client) => updateAssignmentSessionInClient(client, params));
  return row ? mapRow(row) : null;
}

async function updateAssignmentSessionInClient(
  client: PoolClient,
  params: UpdateAssignmentSessionParams,
): Promise<AssignmentSessionRow | null> {
  const assignments: string[] = [];
  const values: unknown[] = [params.id, params.userId];

  for (const [field, column] of Object.entries(FIELD_COLUMNS) as [
    keyof AssignmentSessionPatch,
    string,
  ][]) {
    if (params[field] !== undefined) {
      values.push(params[field]);
      assignments.push(`${column} = $${values.length}`);
    }
  }

  values.push(new Date());
  assignments.push(`updated_at = $${values.length}`);

  const result = await client.query(
    `
    UPDATE assignment_sessions
    SET ${assignments.join(', ')}
    WHERE id = $1
      AND user_id = $2
      AND archived_at IS NULL
    RETURNING ${RETURNING_COLUMNS}
    `,
    values,
  );

  return result.rows[0] ?? null;
}

export async function getAssignmentSessionByIdForUser(
  id: string,
  userId: string,
): Promise<AssignmentSessionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT ${RETURNING_COLUMNS}
      FROM assignment_sessions
      WHERE id = $1
        AND user_id = $2
        AND archived_at IS NULL
      `,
      [id, userId],
    );
    return result.rows[0] ?? null;
  });

  return row ? mapRow(row) : null;
}

export async function listAssignmentSessionsForUser(
  userId: string,
  limit: number,
): Promise<AssignmentSessionRecord[]> {
  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT ${RETURNING_COLUMNS}
      FROM assignment_sessions
      WHERE user_id = $1
        AND archived_at IS NULL
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
  const count = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT COUNT(*) AS count
      FROM assignment_sessions
      WHERE user_id = $1
        AND archived_at IS NULL
      `,
      [userId],
    );
    return result.rows[0]?.count ?? '0';
  });

  return Number.parseInt(count, 10);
}

export async function archiveAssignmentSession(
  id: string,
  userId: string,
): Promise<AssignmentSessionRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE assignment_sessions
      SET archived_at = NOW(), updated_at = NOW()
      WHERE id = $1
        AND user_id = $2
        AND archived_at IS NULL
      RETURNING ${RETURNING_COLUMNS}
      `,
      [id, userId],
    );
    return result.rows[0] ?? null;
  });

  return row ? mapRow(row) : null;
}

function mapRow(row: AssignmentSessionRow): AssignmentSessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    studentId: row.student_id,
    lessonId: row.lesson_id ?? null,
    recordingId: row.recording_id,
    transcriptId: row.transcript_id,
    promptPackageId: row.prompt_package_id,
    draftId: row.draft_id,
    currentStage: row.current_stage,
    publishTarget: row.publish_target,
    selectedTtsProvider: row.selected_tts_provider,
    selectedTtsStrategy: row.selected_tts_strategy,
    selectedTtsModel: row.selected_tts_model,
    selectedPreset: row.selected_preset,
    selectedGenerationProvider: row.selected_generation_provider,
    selectedGenerationModel: row.selected_generation_model,
    teacherNotes: row.teacher_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}
