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
        params.topicsDiscussed ?? [],
        params.mistakePatterns ?? [],
        params.grammarReviewed ?? [],
        params.grammarWatchlist ?? [],
        params.vocabularyFocus ?? [],
        params.pronunciationFocus ?? [],
        params.studentFacts ?? [],
        params.progressSignals ?? [],
        params.followUpRecommendations ?? [],
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

  const rows = await withPgClient(async (client: PoolClient) => {
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
      ${whereClause}
      ORDER BY generated_at ${orderDirection}, created_at ${orderDirection}, id ${orderDirection}
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
  const clauses = ['student_id = $1', `status = 'ready'`];

  if (options.excludeTranscriptId) {
    values.push(options.excludeTranscriptId);
    clauses.push(`transcript_id <> $${values.length}`);
  }

  values.push(options.limit);
  const limitParam = values.length;

  const rows = await withPgClient(async (client: PoolClient) => {
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
      WHERE ${clauses.join(' AND ')}
      ORDER BY generated_at DESC, created_at DESC, id DESC
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
