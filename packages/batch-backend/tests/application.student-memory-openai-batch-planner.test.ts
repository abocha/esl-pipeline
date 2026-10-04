import { describe, expect, it } from 'vitest';

import { buildHomeworkMemoryEnvelope } from '../src/application/homework-memory-prompt.js';
import { buildLessonMemoryEnvelope } from '../src/application/lesson-memory-prompt.js';
import { buildOpenAiResponsesRequestBody } from '../src/application/openai-responses-contract.js';
import { buildStudentMemoryOpenAiBatchItem } from '../src/application/student-memory-openai-batch-planner.js';
import { buildStudentMemorySnapshotEnvelope } from '../src/application/student-memory-snapshot-prompt.js';
import { assignmentFixture } from './assignment-v1.test-harness.js';

describe('application/student-memory-openai-batch-planner', () => {
  it.each([
    [
      'lesson_memory',
      buildLessonMemoryEnvelope({ transcriptId: 't1', transcriptText: 'Student: I goed.' }),
    ],
    [
      'homework_memory',
      buildHomeworkMemoryEnvelope({
        source: {
          format: 'assignment_v1',
          assignment: assignmentFixture(),
          assignmentLineageKey: 'job-1',
          publishedAt: new Date('2026-06-01'),
          publishTargets: [],
        },
      }),
    ],
    [
      'student_memory_snapshot',
      buildStudentMemorySnapshotEnvelope({ lessonMemoryEntries: [], homeworkMemoryEntries: [] }),
    ],
  ] as const)('uses the exact online Responses body for %s', (workload, envelope) => {
    const item = buildStudentMemoryOpenAiBatchItem({
      workload,
      model: 'gpt-5.4-nano',
      canonicalScopeKey: `${workload}:scope`,
      sourceVersionHash: 'a'.repeat(64),
      envelope,
      sourceRefs: { scope: 'safe-id-only' },
    });

    expect(item.body).toEqual(
      buildOpenAiResponsesRequestBody({
        model: 'gpt-5.4-nano',
        envelope,
        responseSchema: envelope.responseSchema,
      }),
    );
    expect(item.customId).toMatch(/^student-memory-batch:v1:/u);
    expect(item.sourceRefs).toEqual({ scope: 'safe-id-only' });
  });
});
