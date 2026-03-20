import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import type { HomeworkMemoryRecord } from '../domain/homework-memory-model.js';
import { listHomeworkMemoryEntries } from '../domain/homework-memory-repository.js';
import type { LessonMemoryRecord } from '../domain/lesson-memory-model.js';
import { listLessonMemoryEntries } from '../domain/lesson-memory-repository.js';
import {
  generateStudentMemorySnapshot,
  type GenerateStudentMemorySnapshotDependencies,
} from './student-memory-snapshot-generation.js';
import { buildStudentMemorySnapshotPrompt } from './student-memory-snapshot-prompt.js';

export interface ProcessStudentMemorySnapshotJobPayload {
  kind: 'student-memory-snapshot-refresh';
  studentId: string;
  provider: GenerationProvider;
  model: string;
  trigger: 'lesson-memory-ready' | 'homework-memory-ready' | 'manual-replay';
  sourceEntryId?: string | null;
}

export interface ProcessStudentMemorySnapshotJobDependencies {
  lessonMemory: {
    list: typeof listLessonMemoryEntries;
  };
  homeworkMemory: {
    list: typeof listHomeworkMemoryEntries;
  };
  generator: typeof generateStudentMemorySnapshot;
}

export async function processStudentMemorySnapshotJob(args: {
  config: BatchBackendConfig['generation'];
  payload: ProcessStudentMemorySnapshotJobPayload;
  overrides?: Partial<ProcessStudentMemorySnapshotJobDependencies & GenerateStudentMemorySnapshotDependencies>;
}): Promise<void> {
  const lessonMemory = args.overrides?.lessonMemory ?? {
    list: listLessonMemoryEntries,
  };
  const homeworkMemory = args.overrides?.homeworkMemory ?? {
    list: listHomeworkMemoryEntries,
  };
  const generator = args.overrides?.generator ?? generateStudentMemorySnapshot;

  const readyLessonMemory = await listAllReadyLessonMemory(args.payload.studentId, lessonMemory.list);
  const readyHomeworkMemory = await listAllReadyHomeworkMemory(
    args.payload.studentId,
    homeworkMemory.list,
  );

  if (readyLessonMemory.length === 0 && readyHomeworkMemory.length === 0) {
    return;
  }

  const prompt = buildStudentMemorySnapshotPrompt({
    lessonMemoryEntries: readyLessonMemory,
    homeworkMemoryEntries: readyHomeworkMemory,
  });

  await generator({
    config: args.config,
    request: {
      studentId: args.payload.studentId,
      lessonMemoryEntryIds: readyLessonMemory.map((entry: LessonMemoryRecord) => entry.id),
      homeworkMemoryEntryIds: readyHomeworkMemory.map((entry: HomeworkMemoryRecord) => entry.id),
      provider: args.payload.provider,
      model: args.payload.model,
      prompt,
    },
    overrides: args.overrides,
  });
}

async function listAllReadyLessonMemory(
  studentId: string,
  list: typeof listLessonMemoryEntries,
): Promise<LessonMemoryRecord[]> {
  return listAllPages<LessonMemoryRecord>(async ({ limit, offset }) =>
    list({
      studentId,
      statuses: ['ready'],
      limit,
      offset,
    }),
  );
}

async function listAllReadyHomeworkMemory(
  studentId: string,
  list: typeof listHomeworkMemoryEntries,
): Promise<HomeworkMemoryRecord[]> {
  return listAllPages<HomeworkMemoryRecord>(async ({ limit, offset }) =>
    list({
      studentId,
      statuses: ['ready'],
      limit,
      offset,
    }),
  );
}

async function listAllPages<T>(
  loadPage: (args: { limit: number; offset: number }) => Promise<T[]>,
): Promise<T[]> {
  const limit = 200;
  const records: T[] = [];

  for (let offset = 0; ; offset += limit) {
    const page = await loadPage({ limit, offset });
    records.push(...page);
    if (page.length < limit) {
      return records;
    }
  }
}
