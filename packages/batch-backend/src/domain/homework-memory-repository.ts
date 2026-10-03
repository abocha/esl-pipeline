import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import {
  type HomeworkMemoryEntryStatus,
  HomeworkMemoryEntryStatusSchema,
  type HomeworkMemoryGenerationNotes,
  type HomeworkMemoryInputType,
  HomeworkMemoryInputTypeSchema,
  type HomeworkMemoryLabeledNote,
  type HomeworkMemoryNamedTarget,
  type HomeworkMemoryPronunciationFocusEntry,
  type HomeworkMemoryPublishTarget,
  type HomeworkMemoryRecord,
  HomeworkMemorySourceKindSchema,
  type HomeworkMemoryStudyTextType,
  HomeworkMemoryStudyTextTypeSchema,
  type HomeworkMemoryTaskEntry,
  type HomeworkMemoryTeacherFollowUpCue,
  type HomeworkMemoryVocabularyTarget,
} from './homework-memory-model.js';

interface HomeworkMemoryRow {
  id: string;
  student_id: string;
  job_id: string;
  assignment_lineage_key: string;
  prompt_package_id: string | null;
  draft_id: string | null;
  lesson_id: string | null;
  recording_id: string | null;
  transcript_id: string | null;
  schema_version: string;
  generated_at: Date;
  provider: string;
  model: string;
  status: string;
  source_kind: string;
  content_hash: string | null;
  generation_notes: HomeworkMemoryGenerationNotes | null;
  homework_summary: string | null;
  topic: string | null;
  grammar_targets: HomeworkMemoryNamedTarget[] | null;
  vocabulary_targets: HomeworkMemoryVocabularyTarget[] | null;
  review_targets: HomeworkMemoryLabeledNote[] | null;
  task_list: HomeworkMemoryTaskEntry[] | null;
  pronunciation_focus: HomeworkMemoryPronunciationFocusEntry[] | null;
  study_text_type: string | null;
  input_type: string | null;
  communicative_outcome: string | null;
  teacher_follow_up_cues: HomeworkMemoryTeacherFollowUpCue[] | null;
  published_at: Date;
  publish_targets: HomeworkMemoryPublishTarget[] | null;
  superseded_by_id: string | null;
  superseded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface InsertHomeworkMemoryParams {
  id?: string;
  studentId: string;
  jobId: string;
  assignmentLineageKey: string;
  promptPackageId?: string | null;
  draftId?: string | null;
  lessonId?: string | null;
  recordingId?: string | null;
  transcriptId?: string | null;
  schemaVersion: string;
  generatedAt?: Date;
  provider: string;
  model: string;
  status: HomeworkMemoryEntryStatus;
  contentHash?: string | null;
  generationNotes?: HomeworkMemoryGenerationNotes | null;
  homeworkSummary?: string | null;
  topic?: string | null;
  grammarTargets?: HomeworkMemoryNamedTarget[];
  vocabularyTargets?: HomeworkMemoryVocabularyTarget[];
  reviewTargets?: HomeworkMemoryLabeledNote[];
  taskList?: HomeworkMemoryTaskEntry[];
  pronunciationFocus?: HomeworkMemoryPronunciationFocusEntry[];
  studyTextType?: HomeworkMemoryStudyTextType | null;
  inputType?: HomeworkMemoryInputType | null;
  communicativeOutcome?: string | null;
  teacherFollowUpCues?: HomeworkMemoryTeacherFollowUpCue[];
  publishedAt: Date;
  publishTargets?: HomeworkMemoryPublishTarget[];
}

export type InsertCanonicalReadyHomeworkMemoryParams = Omit<InsertHomeworkMemoryParams, 'status'>;
export interface CommitCanonicalReadyHomeworkMemoryParams
  extends InsertCanonicalReadyHomeworkMemoryParams {
  pendingEntryId?: string | null;
}

export interface CommitCanonicalReadyHomeworkMemoryResult {
  outcome: 'canonical_committed' | 'stale_discarded';
  entry: HomeworkMemoryRecord | null;
}
export interface EnsurePendingHomeworkMemoryEntryParams
  extends Omit<InsertHomeworkMemoryParams, 'status'> {
  bypassReadyReuse?: boolean;
  replayKey?: string;
}

export interface EnsurePendingHomeworkMemoryEntryResult {
  outcome: 'created' | 'pending_exists' | 'ready_exists' | 'stale_discarded';
  entry: HomeworkMemoryRecord;
}

interface HomeworkMemoryPublicationProvenance {
  jobId: string;
  studentId: string;
  assignmentLineageKey: string;
  publicationSequence: string;
}

export interface ListHomeworkMemoryEntriesOptions {
  studentId?: string | null;
  jobId?: string | null;
  assignmentLineageKey?: string | null;
  statuses?: HomeworkMemoryEntryStatus[];
  limit: number;
  offset: number;
  order?: 'asc' | 'desc';
}

export interface ListRecentReadyHomeworkMemoryOptions {
  limit: number;
  excludeAssignmentLineageKey?: string | null;
}

const HOMEWORK_MEMORY_COLUMNS = `
  id,
  student_id,
  job_id,
  assignment_lineage_key,
  prompt_package_id,
  draft_id,
  lesson_id,
  recording_id,
  transcript_id,
  schema_version,
  generated_at,
  provider,
  model,
  status,
  source_kind,
  content_hash,
  generation_notes,
  homework_summary,
  topic,
  grammar_targets,
  vocabulary_targets,
  review_targets,
  task_list,
  pronunciation_focus,
  study_text_type,
  input_type,
  communicative_outcome,
  teacher_follow_up_cues,
  published_at,
  publish_targets,
  superseded_by_id,
  superseded_at,
  created_at,
  updated_at
`;

export async function insertHomeworkMemoryEntry(
  params: InsertHomeworkMemoryParams,
): Promise<HomeworkMemoryRecord> {
  const id = params.id ?? randomUUID();
  const generatedAt = params.generatedAt ?? new Date();

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO homework_memory_entries (
        id,
        student_id,
        job_id,
        assignment_lineage_key,
        prompt_package_id,
        draft_id,
        lesson_id,
        recording_id,
        transcript_id,
        schema_version,
        generated_at,
        provider,
        model,
        status,
        source_kind,
        content_hash,
        generation_notes,
        homework_summary,
        topic,
        grammar_targets,
        vocabulary_targets,
        review_targets,
        task_list,
        pronunciation_focus,
        study_text_type,
        input_type,
        communicative_outcome,
        teacher_follow_up_cues,
        published_at,
        publish_targets
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'published_assignment',
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
      )
      RETURNING
        ${HOMEWORK_MEMORY_COLUMNS}
      `,
      [
        id,
        params.studentId,
        params.jobId,
        params.assignmentLineageKey,
        params.promptPackageId ?? null,
        params.draftId ?? null,
        params.lessonId ?? null,
        params.recordingId ?? null,
        params.transcriptId ?? null,
        params.schemaVersion,
        generatedAt,
        params.provider,
        params.model,
        params.status,
        params.contentHash ?? null,
        params.generationNotes ?? null,
        params.homeworkSummary ?? null,
        params.topic ?? null,
        JSON.stringify(params.grammarTargets ?? []),
        JSON.stringify(params.vocabularyTargets ?? []),
        JSON.stringify(params.reviewTargets ?? []),
        JSON.stringify(params.taskList ?? []),
        JSON.stringify(params.pronunciationFocus ?? []),
        params.studyTextType ?? null,
        params.inputType ?? null,
        params.communicativeOutcome ?? null,
        JSON.stringify(params.teacherFollowUpCues ?? []),
        params.publishedAt,
        JSON.stringify(params.publishTargets ?? []),
      ],
    );
    return result.rows[0];
  });

  logger.info('Homework memory entry inserted', {
    homeworkMemoryEntryId: id,
    jobId: params.jobId,
    status: params.status,
  });

  return mapRowToHomeworkMemory(row);
}

export async function insertCanonicalReadyHomeworkMemoryEntry(
  params: InsertCanonicalReadyHomeworkMemoryParams,
  options?: { client?: PoolClient },
): Promise<HomeworkMemoryRecord> {
  const result = await commitCanonicalReadyHomeworkMemoryEntry(params, options);
  if (!result.entry) {
    throw new Error('Canonical homework-memory insertion was discarded without a ready entry');
  }
  return result.entry;
}

export async function commitCanonicalReadyHomeworkMemoryEntry(
  params: CommitCanonicalReadyHomeworkMemoryParams,
  options?: { client?: PoolClient },
): Promise<CommitCanonicalReadyHomeworkMemoryResult> {
  const id = params.id ?? randomUUID();
  const generatedAt = params.generatedAt ?? new Date();

  const write = async (client: PoolClient) => {
    if (!options?.client) await client.query('BEGIN');
    try {
      await client.query('SELECT id FROM jobs WHERE id = $1 FOR UPDATE', [
        params.assignmentLineageKey,
      ]);
      await client.query('SELECT id FROM students WHERE id = $1 FOR UPDATE', [params.studentId]);

      const source = await loadHomeworkMemoryPublicationProvenance(client, params.jobId);
      if (
        !source ||
        source.studentId !== params.studentId ||
        source.assignmentLineageKey !== params.assignmentLineageKey
      ) {
        throw new Error('Homework-memory canonical commit source provenance no longer matches');
      }

      if (params.pendingEntryId) {
        const pendingResult = await client.query<HomeworkMemoryRow>(
          `SELECT ${HOMEWORK_MEMORY_COLUMNS} FROM homework_memory_entries WHERE id = $1 FOR UPDATE`,
          [params.pendingEntryId],
        );
        const pending = pendingResult.rows[0];
        if (pending?.student_id === params.studentId && pending.superseded_by_id) {
          const completed = (
            await client.query<HomeworkMemoryRow>(
              `SELECT * FROM homework_memory_entries WHERE id = $1 AND student_id = $2
             AND generation_notes ->> 'pendingEntryId' = $3`,
              [pending.superseded_by_id, params.studentId, pending.id],
            )
          ).rows[0];
          if (completed) {
            if (!options?.client) await client.query('COMMIT');
            return {
              outcome: 'canonical_committed' as const,
              entry: mapRowToHomeworkMemory(completed),
            };
          }
        }
        if (
          pending?.status !== 'pending' ||
          pending.job_id !== params.jobId ||
          pending.student_id !== params.studentId ||
          pending.assignment_lineage_key !== params.assignmentLineageKey ||
          (pending.content_hash ?? null) !== (params.contentHash ?? null) ||
          pending.published_at.getTime() !== params.publishedAt.getTime() ||
          pending.provider !== params.provider ||
          pending.model !== params.model
        ) {
          if (!options?.client) await client.query('COMMIT');
          return { outcome: 'stale_discarded' as const, entry: null };
        }
      }

      const newerReadyResult = await client.query<HomeworkMemoryRow>(
        `
        SELECT homework_memory_entries.*
        FROM homework_memory_entries
        INNER JOIN jobs source_job ON source_job.id = homework_memory_entries.job_id
        WHERE homework_memory_entries.assignment_lineage_key = $1
          AND homework_memory_entries.status = 'ready'
          AND (
            source_job.publication_sequence > $2::bigint
            OR (
              source_job.publication_sequence = 0
              AND $2::bigint = 0
              AND homework_memory_entries.published_at > $3
            )
          )
        ORDER BY source_job.publication_sequence DESC, homework_memory_entries.created_at DESC, homework_memory_entries.id DESC
        LIMIT 1
        `,
        [params.assignmentLineageKey, source.publicationSequence, params.publishedAt],
      );
      const newerReady = newerReadyResult.rows[0];
      if (newerReady) {
        if (params.pendingEntryId) {
          await client.query(
            `
            UPDATE homework_memory_entries
            SET status = 'superseded', superseded_by_id = $1, superseded_at = $2, updated_at = NOW()
            WHERE id = $3 AND status = 'pending'
            `,
            [newerReady.id, generatedAt, params.pendingEntryId],
          );
        }
        if (!options?.client) await client.query('COMMIT');
        return {
          outcome: 'stale_discarded' as const,
          entry: mapRowToHomeworkMemory(newerReady),
        };
      }

      const insertResult = await client.query(
        `
        INSERT INTO homework_memory_entries (
          id,
          student_id,
          job_id,
          assignment_lineage_key,
          prompt_package_id,
          draft_id,
          lesson_id,
          recording_id,
          transcript_id,
          schema_version,
          generated_at,
          provider,
          model,
          status,
          source_kind,
          content_hash,
          generation_notes,
          homework_summary,
          topic,
          grammar_targets,
          vocabulary_targets,
          review_targets,
          task_list,
          pronunciation_focus,
          study_text_type,
          input_type,
          communicative_outcome,
          teacher_follow_up_cues,
          published_at,
          publish_targets
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'ready',
          'published_assignment', $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
          $26, $27, $28
        )
        RETURNING
          ${HOMEWORK_MEMORY_COLUMNS}
        `,
        [
          id,
          params.studentId,
          params.jobId,
          params.assignmentLineageKey,
          params.promptPackageId ?? null,
          params.draftId ?? null,
          params.lessonId ?? null,
          params.recordingId ?? null,
          params.transcriptId ?? null,
          params.schemaVersion,
          generatedAt,
          params.provider,
          params.model,
          params.contentHash ?? null,
          params.generationNotes ?? null,
          params.homeworkSummary ?? null,
          params.topic ?? null,
          JSON.stringify(params.grammarTargets ?? []),
          JSON.stringify(params.vocabularyTargets ?? []),
          JSON.stringify(params.reviewTargets ?? []),
          JSON.stringify(params.taskList ?? []),
          JSON.stringify(params.pronunciationFocus ?? []),
          params.studyTextType ?? null,
          params.inputType ?? null,
          params.communicativeOutcome ?? null,
          JSON.stringify(params.teacherFollowUpCues ?? []),
          params.publishedAt,
          JSON.stringify(params.publishTargets ?? []),
        ],
      );

      await client.query(
        `
        UPDATE homework_memory_entries
        SET
          status = 'superseded',
          superseded_by_id = $1,
          superseded_at = $2,
          updated_at = NOW()
        FROM jobs source_job
        WHERE homework_memory_entries.job_id = source_job.id
          AND homework_memory_entries.assignment_lineage_key = $3
          AND homework_memory_entries.status = 'ready'
          AND homework_memory_entries.id <> $1
          AND (
            source_job.publication_sequence < $4::bigint
            OR homework_memory_entries.job_id = $5
            OR (
              source_job.publication_sequence = 0
              AND $4::bigint = 0
              AND homework_memory_entries.published_at < $6
            )
          )
        `,
        [
          id,
          generatedAt,
          params.assignmentLineageKey,
          source.publicationSequence,
          params.jobId,
          params.publishedAt,
        ],
      );

      if (params.pendingEntryId) {
        await client.query(
          `
          UPDATE homework_memory_entries
          SET status = 'superseded', superseded_by_id = $1, superseded_at = $2, updated_at = NOW()
          WHERE id = $3 AND status = 'pending'
          `,
          [id, generatedAt, params.pendingEntryId],
        );
      }

      if (!options?.client) await client.query('COMMIT');
      return {
        outcome: 'canonical_committed' as const,
        entry: mapRowToHomeworkMemory(insertResult.rows[0]),
      };
    } catch (error) {
      if (!options?.client) await client.query('ROLLBACK');
      throw error;
    }
  };
  const result = options?.client ? await write(options.client) : await withPgClient(write);

  logger.info('Canonical homework-memory ready commit resolved', {
    event:
      result.outcome === 'canonical_committed'
        ? 'homework_memory_canonical_ready_committed'
        : 'homework_memory_canonical_result_discarded_stale',
    homeworkMemoryEntryId: result.entry?.id ?? null,
    jobId: params.jobId,
    assignmentLineageKey: params.assignmentLineageKey,
  });

  return result;
}

export async function insertCanonicalReadyHomeworkMemoryEntryWithinTransaction(
  client: PoolClient,
  params: InsertCanonicalReadyHomeworkMemoryParams,
): Promise<HomeworkMemoryRecord> {
  return insertCanonicalReadyHomeworkMemoryEntry(params, { client });
}

export async function ensurePendingHomeworkMemoryEntry(
  params: EnsurePendingHomeworkMemoryEntryParams,
): Promise<EnsurePendingHomeworkMemoryEntryResult> {
  const id = params.id ?? randomUUID();
  const generatedAt = params.generatedAt ?? new Date();

  return withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      await client.query('SELECT id FROM jobs WHERE id = $1 FOR UPDATE', [
        params.assignmentLineageKey,
      ]);

      if (params.replayKey) {
        const existing = (
          await client.query<HomeworkMemoryRow>(
            `SELECT * FROM homework_memory_entries WHERE assignment_lineage_key = $1
           AND generation_notes ->> 'replayKey' = $2
           AND generation_notes ->> 'pendingEntryId' IS NULL FOR UPDATE`,
            [params.assignmentLineageKey, params.replayKey],
          )
        ).rows[0];
        if (existing) {
          if (existing.status === 'failed') {
            await client.query(
              `UPDATE homework_memory_entries SET status = 'pending', updated_at = NOW() WHERE id = $1`,
              [existing.id],
            );
            existing.status = 'pending';
          }
          await client.query('COMMIT');
          return {
            outcome: existing.status === 'pending' ? 'pending_exists' : 'ready_exists',
            entry: mapRowToHomeworkMemory(existing),
          };
        }
        params = {
          ...params,
          generationNotes: { ...params.generationNotes, replayKey: params.replayKey },
        };
        if (params.bypassReadyReuse) {
          await client.query(
            `UPDATE homework_memory_entries SET status = 'superseded',
            generation_notes = COALESCE(generation_notes, '{}'::jsonb) || jsonb_build_object('obsoleteReason', 'new_manual_replay'),
            updated_at = NOW() WHERE assignment_lineage_key = $1 AND status IN ('pending', 'failed')
            AND job_id = $2`,
            [params.assignmentLineageKey, params.jobId],
          );
        }
      }

      const source = await loadHomeworkMemoryPublicationProvenance(client, params.jobId);
      if (
        !source ||
        source.studentId !== params.studentId ||
        source.assignmentLineageKey !== params.assignmentLineageKey
      ) {
        throw new Error('Homework-memory pending source provenance no longer matches');
      }

      if (!params.bypassReadyReuse) {
        const readyResult = await client.query<HomeworkMemoryRow>(
          `
          SELECT
            ${HOMEWORK_MEMORY_COLUMNS}
          FROM homework_memory_entries
          WHERE assignment_lineage_key = $1
            AND status = 'ready'
            AND content_hash IS NOT DISTINCT FROM $2
          ORDER BY generated_at DESC, created_at DESC, id DESC
          LIMIT 1
          `,
          [params.assignmentLineageKey, params.contentHash ?? null],
        );

        const latestReady = readyResult.rows[0];
        if (latestReady) {
          await client.query('COMMIT');
          return {
            outcome: 'ready_exists',
            entry: mapRowToHomeworkMemory(latestReady),
          };
        }
      }

      const newerReadyResult = await client.query<HomeworkMemoryRow>(
        `
        SELECT homework_memory_entries.*
        FROM homework_memory_entries
        INNER JOIN jobs source_job ON source_job.id = homework_memory_entries.job_id
        WHERE homework_memory_entries.assignment_lineage_key = $1
          AND homework_memory_entries.status = 'ready'
          AND (
            source_job.publication_sequence > $2::bigint
            OR (
              source_job.publication_sequence = 0
              AND $2::bigint = 0
              AND homework_memory_entries.published_at > $3
            )
          )
        ORDER BY source_job.publication_sequence DESC, homework_memory_entries.created_at DESC, homework_memory_entries.id DESC
        LIMIT 1
        `,
        [params.assignmentLineageKey, source.publicationSequence, params.publishedAt],
      );
      const newerReady = newerReadyResult.rows[0];
      if (newerReady) {
        await client.query('COMMIT');
        return {
          outcome: 'stale_discarded',
          entry: mapRowToHomeworkMemory(newerReady),
        };
      }

      const newerPendingResult = await client.query<HomeworkMemoryRow>(
        `
        SELECT homework_memory_entries.*
        FROM homework_memory_entries
        INNER JOIN jobs source_job ON source_job.id = homework_memory_entries.job_id
        WHERE homework_memory_entries.assignment_lineage_key = $1
          AND homework_memory_entries.status = 'pending'
          AND (
            source_job.publication_sequence > $2::bigint
            OR (
              source_job.publication_sequence = 0
              AND $2::bigint = 0
              AND homework_memory_entries.published_at > $3
            )
          )
        ORDER BY source_job.publication_sequence DESC, homework_memory_entries.created_at DESC, homework_memory_entries.id DESC
        LIMIT 1
        `,
        [params.assignmentLineageKey, source.publicationSequence, params.publishedAt],
      );
      const newerPending = newerPendingResult.rows[0];
      if (newerPending) {
        await client.query('COMMIT');
        return {
          outcome: 'stale_discarded',
          entry: mapRowToHomeworkMemory(newerPending),
        };
      }

      const pendingResult = await client.query<HomeworkMemoryRow>(
        `
        SELECT
          ${HOMEWORK_MEMORY_COLUMNS}
        FROM homework_memory_entries
        WHERE assignment_lineage_key = $1
          AND status = 'pending'
          AND content_hash IS NOT DISTINCT FROM $2
        ORDER BY generated_at DESC, created_at DESC, id DESC
        LIMIT 1
        `,
        [params.assignmentLineageKey, params.contentHash ?? null],
      );

      const latestPending = pendingResult.rows[0];
      if (latestPending) {
        // An operator can resume already-durable online work without changing its target.
        if (params.replayKey && !latestPending.generation_notes?.replayKey) {
          const adopted = await client.query<HomeworkMemoryRow>(
            `UPDATE homework_memory_entries
             SET generation_notes = COALESCE(generation_notes, '{}'::jsonb) || jsonb_build_object('replayKey', $2::text)
             WHERE id = $1 RETURNING *`,
            [latestPending.id, params.replayKey],
          );
          Object.assign(latestPending, adopted.rows[0]);
        }
        await client.query('COMMIT');
        return {
          outcome: 'pending_exists',
          entry: mapRowToHomeworkMemory(latestPending),
        };
      }

      const insertResult = await client.query<HomeworkMemoryRow>(
        `
        INSERT INTO homework_memory_entries (
          id,
          student_id,
          job_id,
          assignment_lineage_key,
          prompt_package_id,
          draft_id,
          lesson_id,
          recording_id,
          transcript_id,
          schema_version,
          generated_at,
          provider,
          model,
          status,
          source_kind,
          content_hash,
          generation_notes,
          homework_summary,
          topic,
          grammar_targets,
          vocabulary_targets,
          review_targets,
          task_list,
          pronunciation_focus,
          study_text_type,
          input_type,
          communicative_outcome,
          teacher_follow_up_cues,
          published_at,
          publish_targets
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending',
          'published_assignment', $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
          $26, $27, $28
        )
        RETURNING
          ${HOMEWORK_MEMORY_COLUMNS}
        `,
        [
          id,
          params.studentId,
          params.jobId,
          params.assignmentLineageKey,
          params.promptPackageId ?? null,
          params.draftId ?? null,
          params.lessonId ?? null,
          params.recordingId ?? null,
          params.transcriptId ?? null,
          params.schemaVersion,
          generatedAt,
          params.provider,
          params.model,
          params.contentHash ?? null,
          params.generationNotes ?? null,
          params.homeworkSummary ?? null,
          params.topic ?? null,
          JSON.stringify(params.grammarTargets ?? []),
          JSON.stringify(params.vocabularyTargets ?? []),
          JSON.stringify(params.reviewTargets ?? []),
          JSON.stringify(params.taskList ?? []),
          JSON.stringify(params.pronunciationFocus ?? []),
          params.studyTextType ?? null,
          params.inputType ?? null,
          params.communicativeOutcome ?? null,
          JSON.stringify(params.teacherFollowUpCues ?? []),
          params.publishedAt,
          JSON.stringify(params.publishTargets ?? []),
        ],
      );

      const insertedRow = insertResult.rows[0];
      if (!insertedRow) {
        throw new Error('Failed to insert pending homework memory entry');
      }

      await client.query(
        `
          UPDATE homework_memory_entries
          SET
            status = 'superseded',
            superseded_by_id = $1,
            superseded_at = $2,
            updated_at = NOW()
          FROM jobs source_job
          WHERE homework_memory_entries.job_id = source_job.id
            AND homework_memory_entries.assignment_lineage_key = $3
            AND homework_memory_entries.status = 'pending'
            AND homework_memory_entries.id <> $1
            AND (
              source_job.publication_sequence < $4::bigint
              OR (
                source_job.publication_sequence = 0
                AND $4::bigint = 0
                AND homework_memory_entries.published_at < $5
              )
            )
        `,
        [
          id,
          generatedAt,
          params.assignmentLineageKey,
          source.publicationSequence,
          params.publishedAt,
        ],
      );

      await client.query('COMMIT');
      const inserted = mapRowToHomeworkMemory(insertedRow);
      logger.info('Pending homework memory entry inserted', {
        homeworkMemoryEntryId: inserted.id,
        jobId: params.jobId,
        assignmentLineageKey: params.assignmentLineageKey,
      });
      return {
        outcome: 'created',
        entry: inserted,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function getHomeworkMemoryEntryById(id: string): Promise<HomeworkMemoryRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        ${HOMEWORK_MEMORY_COLUMNS}
      FROM homework_memory_entries
      WHERE id = $1
      `,
      [id],
    );
    return result.rows[0];
  });

  return row ? mapRowToHomeworkMemory(row) : null;
}

export async function getLatestReadyHomeworkMemoryByAssignmentLineageKey(
  assignmentLineageKey: string,
): Promise<HomeworkMemoryRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        ${HOMEWORK_MEMORY_COLUMNS}
      FROM homework_memory_entries
      WHERE assignment_lineage_key = $1
        AND status = 'ready'
      ORDER BY generated_at DESC, created_at DESC, id DESC
      LIMIT 1
      `,
      [assignmentLineageKey],
    );
    return result.rows[0];
  });

  return row ? mapRowToHomeworkMemory(row) : null;
}

export async function getLatestPendingHomeworkMemoryByAssignmentLineageKey(
  assignmentLineageKey: string,
): Promise<HomeworkMemoryRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        ${HOMEWORK_MEMORY_COLUMNS}
      FROM homework_memory_entries
      WHERE assignment_lineage_key = $1
        AND status = 'pending'
      ORDER BY generated_at DESC, created_at DESC, id DESC
      LIMIT 1
      `,
      [assignmentLineageKey],
    );
    return result.rows[0];
  });

  return row ? mapRowToHomeworkMemory(row) : null;
}

export async function listHomeworkMemoryEntries(
  options: ListHomeworkMemoryEntriesOptions,
): Promise<HomeworkMemoryRecord[]> {
  const {
    studentId,
    jobId,
    assignmentLineageKey,
    statuses,
    limit,
    offset,
    order = 'desc',
  } = options;
  const values: (string | string[] | number)[] = [];
  const clauses: string[] = [];

  if (studentId) {
    values.push(studentId);
    clauses.push(`student_id = $${values.length}`);
  }

  if (jobId) {
    values.push(jobId);
    clauses.push(`job_id = $${values.length}`);
  }

  if (assignmentLineageKey) {
    values.push(assignmentLineageKey);
    clauses.push(`assignment_lineage_key = $${values.length}`);
  }

  if (statuses && statuses.length > 0) {
    values.push(statuses);
    clauses.push(`status = ANY($${values.length}::text[])`);
  }

  values.push(limit);
  const limitParam = values.length;
  values.push(offset);
  const offsetParam = values.length;

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderDirection = order === 'asc' ? 'ASC' : 'DESC';

  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        ${HOMEWORK_MEMORY_COLUMNS}
      FROM homework_memory_entries
      ${whereClause}
      ORDER BY generated_at ${orderDirection}, created_at ${orderDirection}, id ${orderDirection}
      LIMIT $${limitParam}
      OFFSET $${offsetParam}
      `,
      values,
    );
    return result.rows;
  });

  return rows.map((row) => mapRowToHomeworkMemory(row));
}

export async function listRecentReadyHomeworkMemoryByStudentId(
  studentId: string,
  options: ListRecentReadyHomeworkMemoryOptions,
): Promise<HomeworkMemoryRecord[]> {
  const values: (string | number)[] = [studentId];
  const clauses = ['student_id = $1', `status = 'ready'`];

  if (options.excludeAssignmentLineageKey) {
    values.push(options.excludeAssignmentLineageKey);
    clauses.push(`assignment_lineage_key <> $${values.length}`);
  }

  values.push(options.limit);
  const limitParam = values.length;

  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        ${HOMEWORK_MEMORY_COLUMNS}
      FROM homework_memory_entries
      WHERE ${clauses.join(' AND ')}
      ORDER BY generated_at DESC, created_at DESC, id DESC
      LIMIT $${limitParam}
      `,
      values,
    );
    return result.rows;
  });

  return rows.map((row) => mapRowToHomeworkMemory(row));
}

export async function supersedeReadyHomeworkMemoryEntriesForAssignmentLineage(params: {
  assignmentLineageKey: string;
  supersededById: string;
  excludeEntryId?: string | null;
  supersededAt?: Date;
}): Promise<HomeworkMemoryRecord[]> {
  const supersededAt = params.supersededAt ?? new Date();
  const values: (string | Date)[] = [
    params.supersededById,
    supersededAt,
    params.assignmentLineageKey,
  ];
  const clauses = [`assignment_lineage_key = $3`, `status = 'ready'`, `id <> $1`];

  if (params.excludeEntryId) {
    values.push(params.excludeEntryId);
    clauses.push(`id <> $${values.length}`);
  }

  const rows = await withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      await client.query('SELECT id FROM jobs WHERE id = $1 FOR UPDATE', [
        params.assignmentLineageKey,
      ]);
      await client.query(
        `SELECT s.id FROM students s JOIN jobs j ON j.student_id = s.id
        WHERE j.id = $1 FOR UPDATE OF s`,
        [params.assignmentLineageKey],
      );
      const result = await client.query(
        `
      UPDATE homework_memory_entries
      SET
        status = 'superseded',
        superseded_by_id = $1,
        superseded_at = $2,
        updated_at = NOW()
      WHERE ${clauses.join(' AND ')}
      RETURNING
        ${HOMEWORK_MEMORY_COLUMNS}
      `,
        values,
      );
      await client.query('COMMIT');
      return result.rows;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  if (rows.length > 0) {
    logger.info('Homework memory entries superseded for assignment lineage scope', {
      assignmentLineageKey: params.assignmentLineageKey,
      supersededById: params.supersededById,
      supersededCount: rows.length,
    });
  }

  return rows.map((row) => mapRowToHomeworkMemory(row));
}

export async function supersedePendingHomeworkMemoryEntriesForAssignmentLineage(params: {
  assignmentLineageKey: string;
  supersededById: string;
  supersededAt?: Date;
  maxGeneratedAt?: Date;
}): Promise<HomeworkMemoryRecord[]> {
  const supersededAt = params.supersededAt ?? new Date();
  const maxGeneratedAt = params.maxGeneratedAt ?? supersededAt;

  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE homework_memory_entries
      SET
        status = 'superseded',
        superseded_by_id = $1,
        superseded_at = $2,
        updated_at = NOW()
      WHERE assignment_lineage_key = $3
        AND status = 'pending'
        AND generated_at <= $4
      RETURNING
        ${HOMEWORK_MEMORY_COLUMNS}
      `,
      [params.supersededById, supersededAt, params.assignmentLineageKey, maxGeneratedAt],
    );
    return result.rows;
  });

  return rows.map((row) => mapRowToHomeworkMemory(row));
}

export async function markHomeworkMemoryEntryFailed(params: {
  id: string;
  errorMessage: string;
  providerRequestId?: string | null;
  usage?: unknown;
}): Promise<HomeworkMemoryRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE homework_memory_entries
      SET
        status = 'failed',
        generation_notes = COALESCE(generation_notes, '{}'::jsonb) || jsonb_build_object(
          'error', $2::text, 'failedAt', $5::text,
          'providerRequestId', COALESCE($3::text, generation_notes ->> 'providerRequestId'),
          'usage', COALESCE($4::jsonb, generation_notes -> 'usage')),
        updated_at = NOW()
      WHERE id = $1
        AND status = 'pending'
      RETURNING
        ${HOMEWORK_MEMORY_COLUMNS}
      `,
      [
        params.id,
        params.errorMessage,
        params.providerRequestId ?? null,
        params.usage == null ? null : JSON.stringify(params.usage),
        new Date().toISOString(),
      ],
    );
    return result.rows[0];
  });

  return row ? mapRowToHomeworkMemory(row) : null;
}

async function loadHomeworkMemoryPublicationProvenance(
  client: PoolClient,
  jobId: string,
): Promise<HomeworkMemoryPublicationProvenance | null> {
  const result = await client.query<{
    id: string;
    student_id: string | null;
    assignment_lineage_key: string;
    publication_sequence: string;
  }>(
    `
    WITH RECURSIVE upstream AS (
      SELECT id, source_job_id
      FROM jobs
      WHERE id = $1

      UNION ALL

      SELECT parent.id, parent.source_job_id
      FROM jobs parent
      INNER JOIN upstream child ON parent.id = child.source_job_id
    )
    SELECT
      source.id,
      source.student_id,
      root.id AS assignment_lineage_key,
      source.publication_sequence::text
    FROM jobs source
    CROSS JOIN LATERAL (
      SELECT id
      FROM upstream
      WHERE source_job_id IS NULL
      LIMIT 1
    ) root
    WHERE source.id = $1
      AND source.state = 'succeeded'
    `,
    [jobId],
  );
  const row = result.rows[0];
  if (!row?.student_id) {
    return null;
  }
  return {
    jobId: row.id,
    studentId: row.student_id,
    assignmentLineageKey: row.assignment_lineage_key,
    publicationSequence: row.publication_sequence,
  };
}

function mapRowToHomeworkMemory(row: HomeworkMemoryRow): HomeworkMemoryRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    jobId: row.job_id,
    assignmentLineageKey: row.assignment_lineage_key,
    promptPackageId: row.prompt_package_id ?? null,
    draftId: row.draft_id ?? null,
    lessonId: row.lesson_id ?? null,
    recordingId: row.recording_id ?? null,
    transcriptId: row.transcript_id ?? null,
    schemaVersion: row.schema_version,
    generatedAt: row.generated_at,
    provider: row.provider,
    model: row.model,
    status: HomeworkMemoryEntryStatusSchema.parse(row.status),
    sourceKind: HomeworkMemorySourceKindSchema.parse(row.source_kind),
    contentHash: row.content_hash ?? null,
    generationNotes: row.generation_notes ?? null,
    homeworkSummary: row.homework_summary ?? null,
    topic: row.topic ?? null,
    grammarTargets: row.grammar_targets ?? [],
    vocabularyTargets: row.vocabulary_targets ?? [],
    reviewTargets: row.review_targets ?? [],
    taskList: row.task_list ?? [],
    pronunciationFocus: row.pronunciation_focus ?? [],
    studyTextType: row.study_text_type
      ? HomeworkMemoryStudyTextTypeSchema.parse(row.study_text_type)
      : null,
    inputType: row.input_type ? HomeworkMemoryInputTypeSchema.parse(row.input_type) : null,
    communicativeOutcome: row.communicative_outcome ?? null,
    teacherFollowUpCues: row.teacher_follow_up_cues ?? [],
    publishedAt: row.published_at,
    publishTargets: row.publish_targets ?? [],
    supersededById: row.superseded_by_id ?? null,
    supersededAt: row.superseded_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
