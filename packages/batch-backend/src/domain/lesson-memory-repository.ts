import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import {
  LessonMemoryEntryStatusSchema,
  LessonMemorySourceKindSchema,
  type LessonMemoryEntryStatus,
  type LessonMemoryGenerationNotes,
  type LessonMemoryRecord,
  type LabeledNote,
  type MistakePattern,
  type NamedNote,
  type PronunciationFocusEntry,
  type StudentFact,
  type TextNote,
  type TopicNote,
} from './lesson-memory-model.js';

interface LessonMemoryRow {
  id: string;
  student_id: string;
  transcript_id: string;
  recording_id: string;
  schema_version: string;
  generated_at: Date;
  provider: string;
  model: string;
  status: string;
  source_kind: string;
  generation_notes: LessonMemoryGenerationNotes | null;
  lesson_summary: string | null;
  topics_discussed: TopicNote[] | null;
  mistake_patterns: MistakePattern[] | null;
  grammar_reviewed: NamedNote[] | null;
  grammar_watchlist: NamedNote[] | null;
  vocabulary_focus: TextNote[] | null;
  pronunciation_focus: PronunciationFocusEntry[] | null;
  student_facts: StudentFact[] | null;
  progress_signals: LabeledNote[] | null;
  follow_up_recommendations: LabeledNote[] | null;
  superseded_by_id: string | null;
  superseded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface TranscriptVersionRow {
  id: string;
  updated_at: Date;
}

export interface InsertLessonMemoryParams {
  id?: string;
  studentId: string;
  transcriptId: string;
  recordingId: string;
  schemaVersion: string;
  generatedAt?: Date;
  provider: string;
  model: string;
  status: LessonMemoryEntryStatus;
  generationNotes?: LessonMemoryGenerationNotes | null;
  lessonSummary?: string | null;
  topicsDiscussed?: TopicNote[];
  mistakePatterns?: MistakePattern[];
  grammarReviewed?: NamedNote[];
  grammarWatchlist?: NamedNote[];
  vocabularyFocus?: TextNote[];
  pronunciationFocus?: PronunciationFocusEntry[];
  studentFacts?: StudentFact[];
  progressSignals?: LabeledNote[];
  followUpRecommendations?: LabeledNote[];
}

export interface ListLessonMemoryEntriesOptions {
  studentId?: string | null;
  transcriptId?: string | null;
  recordingId?: string | null;
  statuses?: LessonMemoryEntryStatus[];
  limit: number;
  offset: number;
  order?: 'asc' | 'desc';
}

export interface ListRecentReadyLessonMemoryOptions {
  limit: number;
  excludeTranscriptId?: string | null;
}

export type InsertCanonicalReadyLessonMemoryParams = Omit<InsertLessonMemoryParams, 'status'>;

export interface EnsurePendingLessonMemoryEntryParams
  extends Omit<InsertLessonMemoryParams, 'status'> {}

export interface EnsurePendingLessonMemoryEntryResult {
  outcome: 'created' | 'pending_exists' | 'ready_exists';
  entry: LessonMemoryRecord;
}

export async function insertLessonMemoryEntry(
  params: InsertLessonMemoryParams,
): Promise<LessonMemoryRecord> {
  const id = params.id ?? randomUUID();
  const generatedAt = params.generatedAt ?? new Date();

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO lesson_memory_entries (
        id,
        student_id,
        transcript_id,
        recording_id,
        schema_version,
        generated_at,
        provider,
        model,
        status,
        source_kind,
        generation_notes,
        lesson_summary,
        topics_discussed,
        mistake_patterns,
        grammar_reviewed,
        grammar_watchlist,
        vocabulary_focus,
        pronunciation_focus,
        student_facts,
        progress_signals,
        follow_up_recommendations
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, 'lesson_transcript', $10, $11,
        $12, $13, $14, $15, $16, $17, $18, $19, $20
      )
      RETURNING
        id,
        student_id,
        transcript_id,
        recording_id,
        schema_version,
        generated_at,
        provider,
        model,
        status,
        source_kind,
        generation_notes,
        lesson_summary,
        topics_discussed,
        mistake_patterns,
        grammar_reviewed,
        grammar_watchlist,
        vocabulary_focus,
        pronunciation_focus,
        student_facts,
        progress_signals,
        follow_up_recommendations,
        superseded_by_id,
        superseded_at,
        created_at,
        updated_at
      `,
      [
        id,
        params.studentId,
        params.transcriptId,
        params.recordingId,
        params.schemaVersion,
        generatedAt,
        params.provider,
        params.model,
        params.status,
        params.generationNotes ?? null,
        params.lessonSummary ?? null,
        JSON.stringify(params.topicsDiscussed ?? []),
        JSON.stringify(params.mistakePatterns ?? []),
        JSON.stringify(params.grammarReviewed ?? []),
        JSON.stringify(params.grammarWatchlist ?? []),
        JSON.stringify(params.vocabularyFocus ?? []),
        JSON.stringify(params.pronunciationFocus ?? []),
        JSON.stringify(params.studentFacts ?? []),
        JSON.stringify(params.progressSignals ?? []),
        JSON.stringify(params.followUpRecommendations ?? []),
      ],
    );
    return result.rows[0];
  });

  logger.info('Lesson memory entry inserted', {
    lessonMemoryEntryId: id,
    transcriptId: params.transcriptId,
    status: params.status,
  });

  return mapRowToLessonMemory(row);
}

export async function insertCanonicalReadyLessonMemoryEntry(
  params: InsertCanonicalReadyLessonMemoryParams,
): Promise<LessonMemoryRecord> {
  const id = params.id ?? randomUUID();
  const generatedAt = params.generatedAt ?? new Date();

  const row = await withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      // Serialize canonical ready replacement per transcript to avoid supersession races.
      await client.query('SELECT id FROM transcripts WHERE id = $1 FOR UPDATE', [params.transcriptId]);

      const insertResult = await client.query(
        `
        INSERT INTO lesson_memory_entries (
          id,
          student_id,
          transcript_id,
          recording_id,
          schema_version,
          generated_at,
          provider,
          model,
          status,
          source_kind,
          generation_notes,
          lesson_summary,
          topics_discussed,
          mistake_patterns,
          grammar_reviewed,
          grammar_watchlist,
          vocabulary_focus,
          pronunciation_focus,
          student_facts,
          progress_signals,
          follow_up_recommendations
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, 'ready', 'lesson_transcript', $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19
        )
        RETURNING
          id,
          student_id,
          transcript_id,
          recording_id,
          schema_version,
          generated_at,
          provider,
          model,
          status,
          source_kind,
          generation_notes,
          lesson_summary,
          topics_discussed,
          mistake_patterns,
          grammar_reviewed,
          grammar_watchlist,
          vocabulary_focus,
          pronunciation_focus,
          student_facts,
          progress_signals,
          follow_up_recommendations,
          superseded_by_id,
          superseded_at,
          created_at,
          updated_at
        `,
        [
          id,
          params.studentId,
          params.transcriptId,
          params.recordingId,
          params.schemaVersion,
          generatedAt,
          params.provider,
          params.model,
          params.generationNotes ?? null,
          params.lessonSummary ?? null,
          JSON.stringify(params.topicsDiscussed ?? []),
          JSON.stringify(params.mistakePatterns ?? []),
          JSON.stringify(params.grammarReviewed ?? []),
          JSON.stringify(params.grammarWatchlist ?? []),
          JSON.stringify(params.vocabularyFocus ?? []),
          JSON.stringify(params.pronunciationFocus ?? []),
          JSON.stringify(params.studentFacts ?? []),
          JSON.stringify(params.progressSignals ?? []),
          JSON.stringify(params.followUpRecommendations ?? []),
        ],
      );

      await client.query(
        `
        UPDATE lesson_memory_entries
        SET
          status = 'superseded',
          superseded_by_id = $1,
          superseded_at = $2,
          updated_at = NOW()
        WHERE transcript_id = $3
          AND status = 'ready'
          AND id <> $1
        `,
        [id, generatedAt, params.transcriptId],
      );

      await client.query('COMMIT');
      return insertResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  logger.info('Canonical ready lesson memory entry inserted', {
    lessonMemoryEntryId: id,
    transcriptId: params.transcriptId,
  });

  return mapRowToLessonMemory(row);
}

export async function ensurePendingLessonMemoryEntry(
  params: EnsurePendingLessonMemoryEntryParams,
): Promise<EnsurePendingLessonMemoryEntryResult> {
  const id = params.id ?? randomUUID();
  const generatedAt = params.generatedAt ?? new Date();

  return withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      const transcriptResult = await client.query<TranscriptVersionRow>(
        'SELECT id, updated_at FROM transcripts WHERE id = $1 FOR UPDATE',
        [params.transcriptId],
      );
      const transcript = transcriptResult.rows[0];
      if (!transcript) {
        throw new Error(`Transcript not found for lesson-memory request: ${params.transcriptId}`);
      }
      const transcriptUpdatedAt = transcript.updated_at;

      const readyResult = await client.query<LessonMemoryRow>(
        `
        SELECT
          id,
          student_id,
          transcript_id,
          recording_id,
          schema_version,
          generated_at,
          provider,
          model,
          status,
          source_kind,
          generation_notes,
          lesson_summary,
          topics_discussed,
          mistake_patterns,
          grammar_reviewed,
          grammar_watchlist,
          vocabulary_focus,
          pronunciation_focus,
          student_facts,
          progress_signals,
          follow_up_recommendations,
          superseded_by_id,
          superseded_at,
          created_at,
          updated_at
        FROM lesson_memory_entries
        WHERE transcript_id = $1
          AND status = 'ready'
        ORDER BY generated_at DESC, created_at DESC, id DESC
        LIMIT 1
        `,
        [params.transcriptId],
      );

      const latestReady = readyResult.rows[0];
      if (latestReady && latestReady.generated_at >= transcriptUpdatedAt) {
        await client.query('COMMIT');
        return {
          outcome: 'ready_exists',
          entry: mapRowToLessonMemory(latestReady),
        };
      }

      const pendingResult = await client.query<LessonMemoryRow>(
        `
        SELECT
          id,
          student_id,
          transcript_id,
          recording_id,
          schema_version,
          generated_at,
          provider,
          model,
          status,
          source_kind,
          generation_notes,
          lesson_summary,
          topics_discussed,
          mistake_patterns,
          grammar_reviewed,
          grammar_watchlist,
          vocabulary_focus,
          pronunciation_focus,
          student_facts,
          progress_signals,
          follow_up_recommendations,
          superseded_by_id,
          superseded_at,
          created_at,
          updated_at
        FROM lesson_memory_entries
        WHERE transcript_id = $1
          AND status = 'pending'
        ORDER BY generated_at DESC, created_at DESC, id DESC
        LIMIT 1
        `,
        [params.transcriptId],
      );

      const latestPending = pendingResult.rows[0];
      if (latestPending && latestPending.generated_at >= transcriptUpdatedAt) {
        await client.query('COMMIT');
        return {
          outcome: 'pending_exists',
          entry: mapRowToLessonMemory(latestPending),
        };
      }

      const insertResult = await client.query<LessonMemoryRow>(
        `
        INSERT INTO lesson_memory_entries (
          id,
          student_id,
          transcript_id,
          recording_id,
          schema_version,
          generated_at,
          provider,
          model,
          status,
          source_kind,
          generation_notes,
          lesson_summary,
          topics_discussed,
          mistake_patterns,
          grammar_reviewed,
          grammar_watchlist,
          vocabulary_focus,
          pronunciation_focus,
          student_facts,
          progress_signals,
          follow_up_recommendations
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'lesson_transcript', $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19
        )
        RETURNING
          id,
          student_id,
          transcript_id,
          recording_id,
          schema_version,
          generated_at,
          provider,
          model,
          status,
          source_kind,
          generation_notes,
          lesson_summary,
          topics_discussed,
          mistake_patterns,
          grammar_reviewed,
          grammar_watchlist,
          vocabulary_focus,
          pronunciation_focus,
          student_facts,
          progress_signals,
          follow_up_recommendations,
          superseded_by_id,
          superseded_at,
          created_at,
          updated_at
        `,
        [
          id,
          params.studentId,
          params.transcriptId,
          params.recordingId,
          params.schemaVersion,
          generatedAt,
          params.provider,
          params.model,
          params.generationNotes ?? null,
          params.lessonSummary ?? null,
          JSON.stringify(params.topicsDiscussed ?? []),
          JSON.stringify(params.mistakePatterns ?? []),
          JSON.stringify(params.grammarReviewed ?? []),
          JSON.stringify(params.grammarWatchlist ?? []),
          JSON.stringify(params.vocabularyFocus ?? []),
          JSON.stringify(params.pronunciationFocus ?? []),
          JSON.stringify(params.studentFacts ?? []),
          JSON.stringify(params.progressSignals ?? []),
          JSON.stringify(params.followUpRecommendations ?? []),
        ],
      );

      const insertedRow = insertResult.rows[0];
      if (!insertedRow) {
        throw new Error('Failed to insert pending lesson memory entry');
      }

      await client.query(
        `
        UPDATE lesson_memory_entries
        SET
          status = 'superseded',
          superseded_by_id = $1,
          superseded_at = $2,
          updated_at = NOW()
        WHERE transcript_id = $3
          AND status = 'pending'
          AND id <> $1
          AND generated_at < $4
        `,
        [id, generatedAt, params.transcriptId, transcriptUpdatedAt],
      );

      await client.query('COMMIT');
      const inserted = mapRowToLessonMemory(insertedRow);
      logger.info('Pending lesson memory entry inserted', {
        lessonMemoryEntryId: inserted.id,
        transcriptId: params.transcriptId,
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

export async function getLessonMemoryEntryById(id: string): Promise<LessonMemoryRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        id,
        student_id,
        transcript_id,
        recording_id,
        schema_version,
        generated_at,
        provider,
        model,
        status,
        source_kind,
        generation_notes,
        lesson_summary,
        topics_discussed,
        mistake_patterns,
        grammar_reviewed,
        grammar_watchlist,
        vocabulary_focus,
        pronunciation_focus,
        student_facts,
        progress_signals,
        follow_up_recommendations,
        superseded_by_id,
        superseded_at,
        created_at,
        updated_at
      FROM lesson_memory_entries
      WHERE id = $1
      `,
      [id],
    );
    return result.rows[0];
  });

  return row ? mapRowToLessonMemory(row) : null;
}

export async function getLatestReadyLessonMemoryByTranscriptId(
  transcriptId: string,
): Promise<LessonMemoryRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        lesson_memory_entries.id,
        lesson_memory_entries.student_id,
        lesson_memory_entries.transcript_id,
        lesson_memory_entries.recording_id,
        lesson_memory_entries.schema_version,
        lesson_memory_entries.generated_at,
        lesson_memory_entries.provider,
        lesson_memory_entries.model,
        lesson_memory_entries.status,
        lesson_memory_entries.source_kind,
        lesson_memory_entries.generation_notes,
        lesson_memory_entries.lesson_summary,
        lesson_memory_entries.topics_discussed,
        lesson_memory_entries.mistake_patterns,
        lesson_memory_entries.grammar_reviewed,
        lesson_memory_entries.grammar_watchlist,
        lesson_memory_entries.vocabulary_focus,
        lesson_memory_entries.pronunciation_focus,
        lesson_memory_entries.student_facts,
        lesson_memory_entries.progress_signals,
        lesson_memory_entries.follow_up_recommendations,
        lesson_memory_entries.superseded_by_id,
        lesson_memory_entries.superseded_at,
        lesson_memory_entries.created_at,
        lesson_memory_entries.updated_at
      FROM lesson_memory_entries
      INNER JOIN transcripts t ON t.id = lesson_memory_entries.transcript_id
      WHERE lesson_memory_entries.transcript_id = $1
        AND lesson_memory_entries.status = 'ready'
        AND lesson_memory_entries.generated_at >= t.updated_at
      ORDER BY lesson_memory_entries.generated_at DESC, lesson_memory_entries.created_at DESC, lesson_memory_entries.id DESC
      LIMIT 1
      `,
      [transcriptId],
    );
    return result.rows[0];
  });

  return row ? mapRowToLessonMemory(row) : null;
}

export async function getLatestPendingLessonMemoryByTranscriptId(
  transcriptId: string,
): Promise<LessonMemoryRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        id,
        student_id,
        transcript_id,
        recording_id,
        schema_version,
        generated_at,
        provider,
        model,
        status,
        source_kind,
        generation_notes,
        lesson_summary,
        topics_discussed,
        mistake_patterns,
        grammar_reviewed,
        grammar_watchlist,
        vocabulary_focus,
        pronunciation_focus,
        student_facts,
        progress_signals,
        follow_up_recommendations,
        superseded_by_id,
        superseded_at,
        created_at,
        updated_at
      FROM lesson_memory_entries
      WHERE transcript_id = $1
        AND status = 'pending'
      ORDER BY generated_at DESC, created_at DESC, id DESC
      LIMIT 1
      `,
      [transcriptId],
    );
    return result.rows[0];
  });

  return row ? mapRowToLessonMemory(row) : null;
}

export async function listLessonMemoryEntries(
  options: ListLessonMemoryEntriesOptions,
): Promise<LessonMemoryRecord[]> {
  const { studentId, transcriptId, recordingId, statuses, limit, offset, order = 'desc' } = options;
  const values: Array<string | string[] | number> = [];
  const clauses: string[] = [];
  const requiresCanonicalReadyFilter =
    Array.isArray(statuses) &&
    statuses.length === 1 &&
    statuses[0] === 'ready';

  if (studentId) {
    values.push(studentId);
    clauses.push(`student_id = $${values.length}`);
  }

  if (transcriptId) {
    values.push(transcriptId);
    clauses.push(`transcript_id = $${values.length}`);
  }

  if (recordingId) {
    values.push(recordingId);
    clauses.push(`recording_id = $${values.length}`);
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
  const fromClause = requiresCanonicalReadyFilter
    ? 'FROM lesson_memory_entries INNER JOIN transcripts t ON t.id = lesson_memory_entries.transcript_id'
    : 'FROM lesson_memory_entries';
  const freshnessClause = requiresCanonicalReadyFilter
    ? `${whereClause ? ' AND' : 'WHERE'} lesson_memory_entries.generated_at >= t.updated_at`
    : '';

  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        lesson_memory_entries.id,
        lesson_memory_entries.student_id,
        lesson_memory_entries.transcript_id,
        lesson_memory_entries.recording_id,
        lesson_memory_entries.schema_version,
        lesson_memory_entries.generated_at,
        lesson_memory_entries.provider,
        lesson_memory_entries.model,
        lesson_memory_entries.status,
        lesson_memory_entries.source_kind,
        lesson_memory_entries.generation_notes,
        lesson_memory_entries.lesson_summary,
        lesson_memory_entries.topics_discussed,
        lesson_memory_entries.mistake_patterns,
        lesson_memory_entries.grammar_reviewed,
        lesson_memory_entries.grammar_watchlist,
        lesson_memory_entries.vocabulary_focus,
        lesson_memory_entries.pronunciation_focus,
        lesson_memory_entries.student_facts,
        lesson_memory_entries.progress_signals,
        lesson_memory_entries.follow_up_recommendations,
        lesson_memory_entries.superseded_by_id,
        lesson_memory_entries.superseded_at,
        lesson_memory_entries.created_at,
        lesson_memory_entries.updated_at
      ${fromClause}
      ${whereClause}
      ${freshnessClause}
      ORDER BY lesson_memory_entries.generated_at ${orderDirection}, lesson_memory_entries.created_at ${orderDirection}, lesson_memory_entries.id ${orderDirection}
      LIMIT $${limitParam}
      OFFSET $${offsetParam}
      `,
      values,
    );
    return result.rows;
  });

  return rows.map((row) => mapRowToLessonMemory(row));
}

export async function listRecentReadyLessonMemoryByStudentId(
  studentId: string,
  options: ListRecentReadyLessonMemoryOptions,
): Promise<LessonMemoryRecord[]> {
  const values: Array<string | number> = [studentId];
  const clauses = ['lesson_memory_entries.student_id = $1', `lesson_memory_entries.status = 'ready'`];

  if (options.excludeTranscriptId) {
    values.push(options.excludeTranscriptId);
    clauses.push(`lesson_memory_entries.transcript_id <> $${values.length}`);
  }

  values.push(options.limit);
  const limitParam = values.length;

  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        lesson_memory_entries.id,
        lesson_memory_entries.student_id,
        lesson_memory_entries.transcript_id,
        lesson_memory_entries.recording_id,
        lesson_memory_entries.schema_version,
        lesson_memory_entries.generated_at,
        lesson_memory_entries.provider,
        lesson_memory_entries.model,
        lesson_memory_entries.status,
        lesson_memory_entries.source_kind,
        lesson_memory_entries.generation_notes,
        lesson_memory_entries.lesson_summary,
        lesson_memory_entries.topics_discussed,
        lesson_memory_entries.mistake_patterns,
        lesson_memory_entries.grammar_reviewed,
        lesson_memory_entries.grammar_watchlist,
        lesson_memory_entries.vocabulary_focus,
        lesson_memory_entries.pronunciation_focus,
        lesson_memory_entries.student_facts,
        lesson_memory_entries.progress_signals,
        lesson_memory_entries.follow_up_recommendations,
        lesson_memory_entries.superseded_by_id,
        lesson_memory_entries.superseded_at,
        lesson_memory_entries.created_at,
        lesson_memory_entries.updated_at
      FROM lesson_memory_entries
      INNER JOIN transcripts t ON t.id = lesson_memory_entries.transcript_id
      WHERE ${clauses.join(' AND ')}
        AND lesson_memory_entries.generated_at >= t.updated_at
      ORDER BY lesson_memory_entries.generated_at DESC, lesson_memory_entries.created_at DESC, lesson_memory_entries.id DESC
      LIMIT $${limitParam}
      `,
      values,
    );
    return result.rows;
  });

  return rows.map((row) => mapRowToLessonMemory(row));
}

export async function supersedeReadyLessonMemoryEntriesForTranscript(params: {
  transcriptId: string;
  supersededById: string;
  excludeEntryId?: string | null;
  supersededAt?: Date;
}): Promise<LessonMemoryRecord[]> {
  const supersededAt = params.supersededAt ?? new Date();
  const values: Array<string | Date> = [params.supersededById, supersededAt, params.transcriptId];
  const clauses = [`transcript_id = $3`, `status = 'ready'`, `id <> $1`];

  if (params.excludeEntryId) {
    values.push(params.excludeEntryId);
    clauses.push(`id <> $${values.length}`);
  }

  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE lesson_memory_entries
      SET
        status = 'superseded',
        superseded_by_id = $1,
        superseded_at = $2,
        updated_at = NOW()
      WHERE ${clauses.join(' AND ')}
      RETURNING
        id,
        student_id,
        transcript_id,
        recording_id,
        schema_version,
        generated_at,
        provider,
        model,
        status,
        source_kind,
        generation_notes,
        lesson_summary,
        topics_discussed,
        mistake_patterns,
        grammar_reviewed,
        grammar_watchlist,
        vocabulary_focus,
        pronunciation_focus,
        student_facts,
        progress_signals,
        follow_up_recommendations,
        superseded_by_id,
        superseded_at,
        created_at,
        updated_at
      `,
      values,
    );
    return result.rows;
  });

  if (rows.length > 0) {
    logger.info('Lesson memory entries superseded for transcript scope', {
      transcriptId: params.transcriptId,
      supersededById: params.supersededById,
      supersededCount: rows.length,
    });
  }

  return rows.map((row) => mapRowToLessonMemory(row));
}

export async function supersedePendingLessonMemoryEntriesForTranscript(params: {
  transcriptId: string;
  supersededById: string;
  supersededAt?: Date;
}): Promise<LessonMemoryRecord[]> {
  const supersededAt = params.supersededAt ?? new Date();

  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE lesson_memory_entries
      SET
        status = 'superseded',
        superseded_by_id = $1,
        superseded_at = $2,
        updated_at = NOW()
      WHERE transcript_id = $3
        AND status = 'pending'
      RETURNING
        id,
        student_id,
        transcript_id,
        recording_id,
        schema_version,
        generated_at,
        provider,
        model,
        status,
        source_kind,
        generation_notes,
        lesson_summary,
        topics_discussed,
        mistake_patterns,
        grammar_reviewed,
        grammar_watchlist,
        vocabulary_focus,
        pronunciation_focus,
        student_facts,
        progress_signals,
        follow_up_recommendations,
        superseded_by_id,
        superseded_at,
        created_at,
        updated_at
      `,
      [params.supersededById, supersededAt, params.transcriptId],
    );
    return result.rows;
  });

  return rows.map((row) => mapRowToLessonMemory(row));
}

export async function markLessonMemoryEntryFailed(params: {
  id: string;
  errorMessage: string;
  providerRequestId?: string | null;
  usage?: unknown;
}): Promise<LessonMemoryRecord | null> {
  const existing = await getLessonMemoryEntryById(params.id);
  if (!existing) {
    return null;
  }

  const generationNotes: LessonMemoryGenerationNotes = {
    ...(existing.generationNotes ?? {}),
    error: params.errorMessage,
    providerRequestId: params.providerRequestId ?? (existing.generationNotes?.providerRequestId ?? null),
    usage: params.usage ?? (existing.generationNotes?.usage ?? null),
    failedAt: new Date().toISOString(),
  };

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE lesson_memory_entries
      SET
        status = 'failed',
        generation_notes = $2::jsonb,
        updated_at = NOW()
      WHERE id = $1
        AND status = 'pending'
      RETURNING
        id,
        student_id,
        transcript_id,
        recording_id,
        schema_version,
        generated_at,
        provider,
        model,
        status,
        source_kind,
        generation_notes,
        lesson_summary,
        topics_discussed,
        mistake_patterns,
        grammar_reviewed,
        grammar_watchlist,
        vocabulary_focus,
        pronunciation_focus,
        student_facts,
        progress_signals,
        follow_up_recommendations,
        superseded_by_id,
        superseded_at,
        created_at,
        updated_at
      `,
      [params.id, JSON.stringify(generationNotes)],
    );
    return result.rows[0];
  });

  return row ? mapRowToLessonMemory(row) : null;
}

function mapRowToLessonMemory(row: LessonMemoryRow): LessonMemoryRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    transcriptId: row.transcript_id,
    recordingId: row.recording_id,
    schemaVersion: row.schema_version,
    generatedAt: row.generated_at,
    provider: row.provider,
    model: row.model,
    status: LessonMemoryEntryStatusSchema.parse(row.status),
    sourceKind: LessonMemorySourceKindSchema.parse(row.source_kind),
    generationNotes: row.generation_notes ?? null,
    lessonSummary: row.lesson_summary ?? null,
    topicsDiscussed: row.topics_discussed ?? [],
    mistakePatterns: row.mistake_patterns ?? [],
    grammarReviewed: row.grammar_reviewed ?? [],
    grammarWatchlist: row.grammar_watchlist ?? [],
    vocabularyFocus: row.vocabulary_focus ?? [],
    pronunciationFocus: row.pronunciation_focus ?? [],
    studentFacts: row.student_facts ?? [],
    progressSignals: row.progress_signals ?? [],
    followUpRecommendations: row.follow_up_recommendations ?? [],
    supersededById: row.superseded_by_id ?? null,
    supersededAt: row.superseded_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
