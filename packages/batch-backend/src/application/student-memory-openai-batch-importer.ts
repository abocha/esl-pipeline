import { createHash } from 'node:crypto';

import { insertCanonicalReadyHomeworkMemoryEntryWithinTransaction } from '../domain/homework-memory-repository.js';
import {
  importValidatedLessonMemoryOpenAiBatchItem as importLessonMemoryItem,
  StudentMemoryOpenAiBatchIneligibleClaimError,
  StudentMemoryOpenAiBatchStaleSourceError,
} from '../domain/student-memory-openai-batch-import.js';
import {
  lockStudentMemoryOpenAiBatchItemForImport,
  markStudentMemoryOpenAiBatchItemImportedWithinTransaction,
  type StudentMemoryOpenAiBatchItem,
} from '../domain/student-memory-openai-batch-repository.js';
import { insertCanonicalReadyStudentMemorySnapshotWithinTransaction } from '../domain/student-memory-snapshot-repository.js';
import { withPgClient } from '../infrastructure/db.js';
import { resolveHomeworkMemorySourceFromSucceededJob } from './homework-memory-source.js';

export { StudentMemoryOpenAiBatchIneligibleClaimError, StudentMemoryOpenAiBatchStaleSourceError };

export async function importValidatedStudentMemoryOpenAiBatchResult(args: {
  item: StudentMemoryOpenAiBatchItem;
  content: unknown;
}): Promise<string> {
  switch (args.item.workload) {
    case 'lesson_memory':
      return importLessonMemoryItem(args);
    case 'homework_memory':
      return importHomeworkMemoryItem(args);
    case 'student_memory_snapshot':
      return importSnapshotItem(args);
  }
}

async function importHomeworkMemoryItem(args: {
  item: StudentMemoryOpenAiBatchItem;
  content: unknown;
}): Promise<string> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      const locked = await lockStudentMemoryOpenAiBatchItemForImport(client, args.item.id);
      const refs = homeworkRefs(args.item.sourceRefs);
      if (locked.importedCanonicalRecordId) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM homework_memory_entries
           WHERE id = $1 AND student_id = $2 AND assignment_lineage_key = $3`,
          [locked.importedCanonicalRecordId, args.item.studentId, refs.assignmentLineageKey],
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
      await client.query('SELECT id FROM jobs WHERE id = $1 FOR UPDATE', [refs.jobId]);
      const source = await resolveHomeworkMemorySourceFromSucceededJob(refs.jobId, { client });
      if (
        source.assignmentLineageKey !== refs.assignmentLineageKey ||
        source.jobId !== refs.jobId ||
        source.contentHash !== refs.contentHash
      ) {
        throw new StudentMemoryOpenAiBatchStaleSourceError(
          'Homework Batch source changed after planning',
        );
      }
      const content = args.content as Record<string, unknown>;
      await insertCanonicalReadyHomeworkMemoryEntryWithinTransaction(client, {
        id: args.item.id,
        studentId: args.item.studentId,
        jobId: source.jobId,
        assignmentLineageKey: source.assignmentLineageKey,
        promptPackageId: source.promptPackageId ?? null,
        draftId: source.draftId ?? null,
        lessonId: source.lessonId ?? null,
        recordingId: source.recordingId ?? null,
        transcriptId: source.transcriptId ?? null,
        schemaVersion: 'homework-memory.v1',
        provider: 'openai',
        model: args.item.model,
        contentHash: source.contentHash,
        homeworkSummary: stringOrNull(content.homeworkSummary),
        topic: stringOrNull(content.topic),
        grammarTargets: arrayOrEmpty(content.grammarTargets),
        vocabularyTargets: arrayOrEmpty(content.vocabularyTargets),
        reviewTargets: arrayOrEmpty(content.reviewTargets),
        taskList: arrayOrEmpty(content.taskList),
        pronunciationFocus: arrayOrEmpty(content.pronunciationFocus),
        studyTextType: stringOrNull(content.studyTextType),
        inputType: stringOrNull(content.inputType),
        communicativeOutcome: stringOrNull(content.communicativeOutcome),
        teacherFollowUpCues: arrayOrEmpty(content.teacherFollowUpCues),
        publishedAt: source.publishedAt,
        publishTargets: source.publishTargets,
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

async function importSnapshotItem(args: {
  item: StudentMemoryOpenAiBatchItem;
  content: unknown;
}): Promise<string> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      const locked = await lockStudentMemoryOpenAiBatchItemForImport(client, args.item.id);
      const refs = snapshotRefs(args.item.sourceRefs);
      if (locked.importedCanonicalRecordId) {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM student_memory_snapshots WHERE id = $1 AND student_id = $2`,
          [locked.importedCanonicalRecordId, args.item.studentId],
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
      await client.query('SELECT id FROM students WHERE id = $1 FOR UPDATE', [args.item.studentId]);
      const [lessonRows, homeworkRows] = await Promise.all([
        client.query<{ id: string }>(
          `SELECT id FROM lesson_memory_entries
           WHERE student_id = $1 AND status = 'ready' AND source_content_hash IS NOT NULL
           ORDER BY generated_at ASC, created_at ASC, id ASC`,
          [args.item.studentId],
        ),
        client.query<{ id: string }>(
          `SELECT id FROM homework_memory_entries
           WHERE student_id = $1 AND status = 'ready'
           ORDER BY generated_at ASC, created_at ASC, id ASC`,
          [args.item.studentId],
        ),
      ]);
      const currentLessonIds = lessonRows.rows.map((entry) => entry.id);
      const currentHomeworkIds = homeworkRows.rows.map((entry) => entry.id);
      if (
        !sameIds(currentLessonIds, refs.lessonMemoryEntryIds) ||
        !sameIds(currentHomeworkIds, refs.homeworkMemoryEntryIds)
      ) {
        throw new StudentMemoryOpenAiBatchStaleSourceError(
          'Student-memory snapshot source changed after planning',
        );
      }
      const content = args.content as Record<string, unknown>;
      await insertCanonicalReadyStudentMemorySnapshotWithinTransaction(client, {
        id: args.item.id,
        studentId: args.item.studentId,
        schemaVersion: 'student-memory-snapshot.v1',
        provider: 'openai',
        model: args.item.model,
        lessonMemoryEntryIds: currentLessonIds,
        homeworkMemoryEntryIds: currentHomeworkIds,
        contentHash: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
        stableStrengths: arrayOrEmpty(content.stableStrengths),
        recurringIssues: arrayOrEmpty(content.recurringIssues),
        activeReviewBacklog: arrayOrEmpty(content.activeReviewBacklog),
        recentProgress: arrayOrEmpty(content.recentProgress),
        personalFacts: arrayOrEmpty(content.personalFacts),
        recommendedAssignmentDirections: arrayOrEmpty(content.recommendedAssignmentDirections),
        unresolvedIssues: arrayOrEmpty(content.unresolvedIssues),
        snapshotSummary: stringOrNull(content.snapshotSummary),
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

function homeworkRefs(refs: Record<string, unknown>) {
  const jobId = typeof refs.jobId === 'string' ? refs.jobId : null;
  const assignmentLineageKey =
    typeof refs.assignmentLineageKey === 'string' ? refs.assignmentLineageKey : null;
  const contentHash = typeof refs.contentHash === 'string' ? refs.contentHash : null;
  if (!jobId || !assignmentLineageKey || !contentHash)
    throw new StudentMemoryOpenAiBatchStaleSourceError(
      'Homework Batch item has incomplete source references',
    );
  return { jobId, assignmentLineageKey, contentHash };
}

function snapshotRefs(refs: Record<string, unknown>) {
  const lessonMemoryEntryIds = stringArray(refs.lessonMemoryEntryIds);
  const homeworkMemoryEntryIds = stringArray(refs.homeworkMemoryEntryIds);
  return { lessonMemoryEntryIds, homeworkMemoryEntryIds };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new StudentMemoryOpenAiBatchStaleSourceError(
      'Snapshot Batch item has invalid source references',
    );
  }
  return value;
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
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
