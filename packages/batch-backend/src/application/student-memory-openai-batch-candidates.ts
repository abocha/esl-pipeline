import type { PoolClient } from 'pg';

import { listHomeworkMemoryEntries } from '../domain/homework-memory-repository.js';
import { listLessonMemoryEntries } from '../domain/lesson-memory-repository.js';
import { withPgClient } from '../infrastructure/db.js';
import { createTranscriptionStorageForUri } from '../infrastructure/transcription-storage.js';
import { buildHomeworkMemoryEnvelope } from './homework-memory-prompt.js';
import { resolveHomeworkMemorySourceFromSucceededJob } from './homework-memory-source.js';
import { buildLessonMemoryEnvelope } from './lesson-memory-prompt.js';
import type { StudentMemoryOpenAiBatchPlanItem } from './student-memory-openai-batch-operations.js';
import {
  buildStudentMemoryOpenAiBatchItem,
  sha256,
} from './student-memory-openai-batch-planner.js';
import { buildStudentMemorySnapshotEnvelope } from './student-memory-snapshot-prompt.js';

interface LessonBatchSourceRow {
  transcript_id: string;
  recording_id: string;
  student_id: string;
  storage_uri: string;
  updated_at: Date;
}

export async function buildLessonMemoryBatchCandidates(args: {
  transcriptIds: string[];
  model: string;
}): Promise<StudentMemoryOpenAiBatchPlanItem[]> {
  const candidates: StudentMemoryOpenAiBatchPlanItem[] = [];
  for (const transcriptId of uniqueSortedIds(args.transcriptIds)) {
    const source = await loadLessonSource(transcriptId);
    if (!source) {
      throw new Error(`Lesson-memory Batch transcript not found: ${transcriptId}`);
    }
    const storage = createTranscriptionStorageForUri(source.storage_uri);
    const transcriptText = await storage.getText(source.storage_uri);
    const envelope = buildLessonMemoryEnvelope({
      transcriptId: source.transcript_id,
      transcriptText,
    });
    const planned = buildStudentMemoryOpenAiBatchItem({
      workload: 'lesson_memory',
      model: args.model,
      canonicalScopeKey: source.transcript_id,
      sourceVersionHash: sha256(
        JSON.stringify({
          transcriptUpdatedAt: source.updated_at.toISOString(),
          sourceSelectionHash: envelope.sourceSelectionHash,
        }),
      ),
      envelope,
      sourceRefs: {
        transcriptId: source.transcript_id,
        recordingId: source.recording_id,
        transcriptUpdatedAt: source.updated_at.toISOString(),
        sourceSelectionHash: envelope.sourceSelectionHash,
      },
    });
    candidates.push({ ...planned, studentId: source.student_id });
  }
  return candidates;
}

export async function buildHomeworkMemoryBatchCandidates(args: {
  jobIds: string[];
  model: string;
}): Promise<StudentMemoryOpenAiBatchPlanItem[]> {
  const candidates: StudentMemoryOpenAiBatchPlanItem[] = [];
  for (const jobId of uniqueSortedIds(args.jobIds)) {
    const source = await resolveHomeworkMemorySourceFromSucceededJob(jobId);
    if (source.assignmentLineageKey !== source.jobId) {
      throw new Error(`Homework-memory Batch job must be the lineage root: ${jobId}`);
    }
    const envelope = buildHomeworkMemoryEnvelope({
      normalizedMarkdown: source.normalizedMarkdown,
      source,
    });
    const planned = buildStudentMemoryOpenAiBatchItem({
      workload: 'homework_memory',
      model: args.model,
      canonicalScopeKey: source.assignmentLineageKey,
      sourceVersionHash: sha256(
        JSON.stringify({
          jobId: source.jobId,
          assignmentLineageKey: source.assignmentLineageKey,
          contentHash: source.contentHash,
          sourceSelectionHash: envelope.sourceSelectionHash,
        }),
      ),
      envelope,
      sourceRefs: {
        jobId: source.jobId,
        assignmentLineageKey: source.assignmentLineageKey,
        promptPackageId: source.promptPackageId ?? null,
        draftId: source.draftId ?? null,
        lessonId: source.lessonId ?? null,
        recordingId: source.recordingId ?? null,
        transcriptId: source.transcriptId ?? null,
        publishedAt: source.publishedAt.toISOString(),
        contentHash: source.contentHash,
        publishTargets: source.publishTargets,
        sourceSelectionHash: envelope.sourceSelectionHash,
      },
    });
    candidates.push({ ...planned, studentId: source.studentId });
  }
  return candidates;
}

export async function buildStudentMemorySnapshotBatchCandidates(args: {
  studentIds: string[];
  model: string;
}): Promise<StudentMemoryOpenAiBatchPlanItem[]> {
  const candidates: StudentMemoryOpenAiBatchPlanItem[] = [];
  for (const studentId of uniqueSortedIds(args.studentIds)) {
    const [lessonMemoryEntries, homeworkMemoryEntries] = await Promise.all([
      listAllReadyLessonMemory(studentId),
      listAllReadyHomeworkMemory(studentId),
    ]);
    if (lessonMemoryEntries.length === 0 && homeworkMemoryEntries.length === 0) {
      throw new Error(`Student-memory snapshot Batch candidate has no ready memory: ${studentId}`);
    }
    const envelope = buildStudentMemorySnapshotEnvelope({
      lessonMemoryEntries,
      homeworkMemoryEntries,
    });
    const lessonMemoryEntryIds = lessonMemoryEntries.map((entry) => entry.id);
    const homeworkMemoryEntryIds = homeworkMemoryEntries.map((entry) => entry.id);
    const planned = buildStudentMemoryOpenAiBatchItem({
      workload: 'student_memory_snapshot',
      model: args.model,
      canonicalScopeKey: studentId,
      sourceVersionHash: sha256(
        JSON.stringify({
          lessonMemoryEntryIds,
          homeworkMemoryEntryIds,
          sourceSelectionHash: envelope.sourceSelectionHash,
        }),
      ),
      envelope,
      sourceRefs: {
        lessonMemoryEntryIds,
        homeworkMemoryEntryIds,
        sourceSelectionHash: envelope.sourceSelectionHash,
      },
    });
    candidates.push({ ...planned, studentId });
  }
  return candidates;
}

async function loadLessonSource(transcriptId: string): Promise<LessonBatchSourceRow | null> {
  return withPgClient(async (client: PoolClient) => {
    const result = await client.query<LessonBatchSourceRow>(
      `
        SELECT
          t.id AS transcript_id,
          t.recording_id,
          r.student_id,
          t.storage_uri,
          t.updated_at
        FROM transcripts t
        INNER JOIN recordings r ON r.id = t.recording_id
        WHERE t.id = $1
      `,
      [transcriptId],
    );
    return result.rows[0] ?? null;
  });
}

async function listAllReadyLessonMemory(studentId: string) {
  return listAllPages(({ limit, offset }) =>
    listLessonMemoryEntries({ studentId, statuses: ['ready'], limit, offset, order: 'asc' }),
  );
}

async function listAllReadyHomeworkMemory(studentId: string) {
  return listAllPages(({ limit, offset }) =>
    listHomeworkMemoryEntries({ studentId, statuses: ['ready'], limit, offset, order: 'asc' }),
  );
}

async function listAllPages<T>(
  loadPage: (args: { limit: number; offset: number }) => Promise<T[]>,
): Promise<T[]> {
  const result: T[] = [];
  const limit = 200;
  for (let offset = 0; ; offset += limit) {
    const page = await loadPage({ limit, offset });
    result.push(...page);
    if (page.length < limit) return result;
  }
}

function uniqueSortedIds(ids: string[]): string[] {
  const result = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (result.length === 0) {
    throw new Error('Batch candidate selection requires at least one explicit id');
  }
  return result.sort((left, right) => left.localeCompare(right));
}
