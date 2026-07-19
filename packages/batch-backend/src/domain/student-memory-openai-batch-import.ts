import { type StudentMemoryOpenAiBatchItem } from './student-memory-openai-batch-repository.js';

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
  throw new Error(
    'Lesson-memory OpenAI Batch import is disabled; confirmed Source owns canonical generation',
  );
}
