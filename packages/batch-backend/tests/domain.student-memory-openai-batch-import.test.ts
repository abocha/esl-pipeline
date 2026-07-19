import { describe, expect, it } from 'vitest';

import { importValidatedLessonMemoryOpenAiBatchItem } from '../src/domain/student-memory-openai-batch-import.js';

describe('domain/student-memory-openai-batch-import', () => {
  it('rejects the removed mutable lesson-memory Batch import path before persistence', async () => {
    await expect(
      importValidatedLessonMemoryOpenAiBatchItem({
        item: { workload: 'lesson_memory' } as never,
        content: { lessonSummary: 'Must not become canonical.' },
      }),
    ).rejects.toThrow(
      'Lesson-memory OpenAI Batch import is disabled; confirmed Source owns canonical generation',
    );
  });

  it('still rejects accidental non-lesson dispatch', async () => {
    await expect(
      importValidatedLessonMemoryOpenAiBatchItem({
        item: { workload: 'homework_memory' } as never,
        content: {},
      }),
    ).rejects.toThrow('Lesson-memory Batch importer received a non-lesson item');
  });
});
