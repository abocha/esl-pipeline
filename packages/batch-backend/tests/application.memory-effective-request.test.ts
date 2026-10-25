import { describe, it } from 'vitest';

import { flattenGenerationRequestEnvelope } from '../src/application/generation-request-envelope.js';
import { buildHomeworkMemoryEnvelope } from '../src/application/homework-memory-prompt.js';
import { buildLessonMemoryEnvelope } from '../src/application/lesson-memory-prompt.js';
import {
  buildIncrementalStudentMemorySnapshotEnvelope,
  buildStudentMemorySnapshotEnvelope,
} from '../src/application/student-memory-snapshot-prompt.js';
import { assertMemoryRequest } from './support/memory-request-capture.js';

const lesson = {
  id: 'lesson-1',
  generatedAt: new Date('2026-01-01T00:00:00Z'),
  lessonSummary: 'Practice travel stories.',
  topicsDiscussed: [],
  mistakePatterns: [],
  grammarReviewed: [],
  grammarWatchlist: [],
  vocabularyFocus: [],
  pronunciationFocus: [],
  studentFacts: [],
  progressSignals: [],
  followUpRecommendations: [],
};
const homework = {
  id: 'homework-1',
  generatedAt: new Date('2026-01-02T00:00:00Z'),
  homeworkSummary: 'Assigned travel practice.',
  topic: 'travel',
  grammarTargets: [],
  vocabularyTargets: [],
  reviewTargets: [],
  taskList: [],
  pronunciationFocus: [],
  teacherFollowUpCues: [],
};
const previous = {
  id: 'snapshot-1',
  generatedAt: new Date('2026-01-03T00:00:00Z'),
  snapshotSummary: 'Retain travel context.',
  stableStrengths: [],
  recurringIssues: [],
  activeReviewBacklog: [],
  recentProgress: [],
  personalFacts: [],
  recommendedAssignmentDirections: [],
  unresolvedIssues: [],
};

describe('effective memory provider requests', () => {
  it('captures lesson policy and source boundaries', async () => {
    const params = {
      transcriptId: 'transcript-1',
      transcriptText: 'Teacher: Tell me about travel.\nStudent: I went to a museum.',
      teacherNotes: 'Recycle past tense.',
    };
    const envelope = buildLessonMemoryEnvelope(params);
    await assertMemoryRequest('lesson', {
      model: 'fixture',
      envelope,
      prompt: flattenGenerationRequestEnvelope(envelope),
      responseSchema: envelope.responseSchema!,
      maxOutputTokens: 1234,
    });
  });
  it('captures published homework input without claiming completion', async () => {
    const params = {
      source: {
        format: 'assignment_v1',
        artifact: { uri: 'local://fixture.json' },
        assignment: { schemaVersion: 'assignment_v1' },
        assignmentLineageKey: 'lineage-1',
        publishTargets: ['html'],
        publishedAt: '2026-01-02T00:00:00Z',
      },
    } as never;
    const envelope = buildHomeworkMemoryEnvelope(params);
    await assertMemoryRequest('homework', {
      model: 'fixture',
      envelope,
      prompt: flattenGenerationRequestEnvelope(envelope),
      responseSchema: envelope.responseSchema!,
      maxOutputTokens: 1234,
    });
  });
  it('captures full snapshot policy', async () => {
    const params = { lessonMemoryEntries: [lesson], homeworkMemoryEntries: [homework] } as never;
    const envelope = buildStudentMemorySnapshotEnvelope(params);
    await assertMemoryRequest('snapshot-full', {
      model: 'fixture',
      envelope,
      prompt: flattenGenerationRequestEnvelope(envelope),
      responseSchema: envelope.responseSchema!,
      maxOutputTokens: 1234,
    });
  });
  it('captures incremental state and bounded context policy', async () => {
    const params = {
      previousSnapshot: previous,
      triggerSource: { kind: 'lesson_memory', entry: lesson },
      supportingLessonMemoryEntries: [],
      supportingHomeworkMemoryEntries: [homework],
    } as never;
    const envelope = buildIncrementalStudentMemorySnapshotEnvelope(params);
    await assertMemoryRequest('snapshot-incremental', {
      model: 'fixture',
      envelope,
      prompt: flattenGenerationRequestEnvelope(envelope),
      responseSchema: envelope.responseSchema!,
      maxOutputTokens: 1234,
    });
  });
});
