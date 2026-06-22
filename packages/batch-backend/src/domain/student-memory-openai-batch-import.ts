import type { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import { insertCanonicalReadyLessonMemoryEntryWithinTransaction } from './lesson-memory-repository.js';
import {
  lockStudentMemoryOpenAiBatchItemForImport,
  markStudentMemoryOpenAiBatchItemImportedWithinTransaction,
  type StudentMemoryOpenAiBatchItem,
} from './student-memory-openai-batch-repository.js';

export class StudentMemoryOpenAiBatchStaleSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudentMemoryOpenAiBatchStaleSourceError';
  }
}

export class StudentMemoryOpenAiBatchIneligibleClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudentMemoryOpenAiBatchIneligibleClaimError';
  }
}

export async function importValidatedLessonMemoryOpenAiBatchItem(args: {
  item: StudentMemoryOpenAiBatchItem;
  content: unknown;
}): Promise<string> {
  if (args.item.workload !== 'lesson_memory') {
    throw new Error('Lesson-memory Batch importer received a non-lesson item');
  }
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      const locked = await lockStudentMemoryOpenAiBatchItemForImport(client, args.item.id);
      const refs = lessonRefs(args.item.sourceRefs);
      if (locked.importedCanonicalRecordId) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM lesson_memory_entries
           WHERE id = $1 AND student_id = $2 AND transcript_id = $3`,
          [locked.importedCanonicalRecordId, args.item.studentId, refs.transcriptId],
        );
        if (!existing.rows[0]) {
          throw new Error(`OpenAI Batch item has a missing canonical destination: ${args.item.id}`);
        }
        await client.query('COMMIT');
        return locked.importedCanonicalRecordId;
      }
      if (locked.claimState !== 'active' || locked.itemClaimState !== 'active') {
        throw new StudentMemoryOpenAiBatchIneligibleClaimError(
          `OpenAI Batch item is no longer eligible for import: ${args.item.id}`,
        );
      }
      assertSourceSelectionHash(args.item);
      await assertFreshLessonSource(args.item.sourceRefs, client);
      const content = args.content as Record<string, unknown>;
      await insertCanonicalReadyLessonMemoryEntryWithinTransaction(client, {
        id: args.item.id,
        studentId: args.item.studentId,
        transcriptId: refs.transcriptId,
        recordingId: refs.recordingId,
        schemaVersion: 'lesson-memory.v1',
        provider: 'openai',
        model: args.item.model,
        lessonSummary: stringOrNull(content.lessonSummary),
        topicsDiscussed: arrayOrEmpty(content.topicsDiscussed),
        mistakePatterns: arrayOrEmpty(content.mistakePatterns),
        grammarReviewed: arrayOrEmpty(content.grammarReviewed),
        grammarWatchlist: arrayOrEmpty(content.grammarWatchlist),
        vocabularyFocus: arrayOrEmpty(content.vocabularyFocus),
        pronunciationFocus: arrayOrEmpty(content.pronunciationFocus),
        studentFacts: arrayOrEmpty(content.studentFacts),
        progressSignals: arrayOrEmpty(content.progressSignals),
        followUpRecommendations: arrayOrEmpty(content.followUpRecommendations),
      } as never);
      await markStudentMemoryOpenAiBatchItemImportedWithinTransaction(client, {
        itemId: args.item.id,
        canonicalRecordId: args.item.id,
      });
      await client.query('COMMIT');
      return args.item.id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

function assertSourceSelectionHash(item: StudentMemoryOpenAiBatchItem): void {
  const expected = item.sourceRefs.sourceSelectionHash;
  const actual =
    item.requestEnvelope && typeof item.requestEnvelope === 'object'
      ? (item.requestEnvelope as Record<string, unknown>).sourceSelectionHash
      : null;
  if (typeof expected !== 'string' || typeof actual !== 'string' || expected !== actual) {
    throw new StudentMemoryOpenAiBatchStaleSourceError(
      'Batch item source selection changed after planning',
    );
  }
}

async function assertFreshLessonSource(
  refs: Record<string, unknown>,
  client: PoolClient,
): Promise<void> {
  const { transcriptId } = lessonRefs(refs);
  const expectedUpdatedAt =
    typeof refs.transcriptUpdatedAt === 'string' ? refs.transcriptUpdatedAt : null;
  if (!expectedUpdatedAt) {
    throw new StudentMemoryOpenAiBatchStaleSourceError(
      'Lesson Batch item is missing transcript version',
    );
  }
  const result = await client.query<{ updated_at: Date }>(
    'SELECT updated_at FROM transcripts WHERE id = $1 FOR UPDATE',
    [transcriptId],
  );
  const current = result.rows[0]?.updated_at;
  if (!current || current.toISOString() !== new Date(expectedUpdatedAt).toISOString()) {
    throw new StudentMemoryOpenAiBatchStaleSourceError(
      'Lesson Batch source changed after planning',
    );
  }
}

function lessonRefs(refs: Record<string, unknown>): { transcriptId: string; recordingId: string } {
  const transcriptId = typeof refs.transcriptId === 'string' ? refs.transcriptId : null;
  const recordingId = typeof refs.recordingId === 'string' ? refs.recordingId : null;
  if (!transcriptId || !recordingId) {
    throw new StudentMemoryOpenAiBatchStaleSourceError(
      'Lesson Batch item has incomplete source references',
    );
  }
  return { transcriptId, recordingId };
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
