import { describe, expect, it, vi } from 'vitest';

import { buildStudentMemorySnapshotGenerationNotes } from '../src/application/student-memory-snapshot-generation-notes.js';
import { generateStudentMemorySnapshot } from '../src/application/student-memory-snapshot-generation.js';
import type { StudentMemorySnapshotRecord } from '../src/domain/student-memory-snapshot-model.js';

describe('application/student-memory-snapshot-generation', () => {
  it('builds typed v1.1 generation notes for the legacy full rebuild strategy', () => {
    expect(
      buildStudentMemorySnapshotGenerationNotes({
        existingNotes: {
          trigger: 'homework-memory-ready',
          sourceEntryId: 'homework-1',
          requestedAt: '2026-07-01T10:00:00.000Z',
        },
        strategy: 'full_rebuild_v1',
        trigger: 'homework-memory-ready',
        triggerSourceKind: 'homework_memory',
        triggerSourceEntryId: 'homework-1',
        includedLessonMemoryEntryIds: ['lesson-1'],
        includedHomeworkMemoryEntryIds: ['homework-1', 'homework-2'],
        coveredLessonMemoryEntryIds: ['lesson-1'],
        coveredHomeworkMemoryEntryIds: ['homework-1', 'homework-2'],
        inputTokenEstimate: 1234,
        promptByteLength: 4321,
        materialChange: null,
      }),
    ).toEqual({
      trigger: 'homework-memory-ready',
      sourceEntryId: 'homework-1',
      requestedAt: '2026-07-01T10:00:00.000Z',
      strategy: 'full_rebuild_v1',
      triggerSourceKind: 'homework_memory',
      triggerSourceEntryId: 'homework-1',
      includedLessonMemoryEntryIds: ['lesson-1'],
      includedHomeworkMemoryEntryIds: ['homework-1', 'homework-2'],
      coveredLessonMemoryEntryIds: ['lesson-1'],
      coveredHomeworkMemoryEntryIds: ['homework-1', 'homework-2'],
      includedLessonMemoryCount: 1,
      includedHomeworkMemoryCount: 2,
      coveredLessonMemoryCount: 1,
      coveredHomeworkMemoryCount: 2,
      inputTokenEstimate: 1234,
      promptByteLength: 4321,
      materialChange: null,
    });
  });

  it('persists extracted student-memory snapshot content with content hash and source ids', async () => {
    const extractor = vi.fn().mockResolvedValue({
      content: {
        stableStrengths: [{ label: 'Fluency', note: 'Longer spoken answers.' }],
        recurringIssues: [
          {
            label: 'Present perfect vs past simple',
            issueType: 'grammar',
            note: 'Still unstable in personal storytelling.',
            confidence: 'high',
          },
        ],
        activeReviewBacklog: [{ label: 'Travel retell', note: 'Review tense contrast.' }],
        recentProgress: [{ label: 'Confidence', note: 'Less hesitation before speaking.' }],
        personalFacts: [],
        recommendedAssignmentDirections: [
          {
            direction: 'Use a grounded retell mission with advice language.',
            rationale: 'Supports speech without asking for heavy creativity.',
          },
        ],
        unresolvedIssues: [
          {
            label: 'Tense contrast in stories',
            issueType: 'grammar',
            note: 'Still needs targeted recycling.',
            priority: 'high',
          },
        ],
        snapshotSummary:
          'The student is more fluent and willing to speak, but tense contrast remains unresolved.',
      },
      rawOutput: {},
      rawText: '{}',
      providerRequestId: 'snapshot-req-1',
      usage: { inputTokens: 120, outputTokens: 60, totalTokens: 180 },
    });

    const insertCanonicalReady = vi.fn().mockImplementation(
      async (params): Promise<StudentMemorySnapshotRecord> => ({
        id: 'student-snapshot-1',
        studentId: params.studentId,
        schemaVersion: params.schemaVersion,
        generatedAt: params.generatedAt,
        provider: params.provider,
        model: params.model,
        status: 'ready',
        sourceKind: 'student_memory_rollup',
        lessonMemoryEntryIds: params.lessonMemoryEntryIds ?? [],
        homeworkMemoryEntryIds: params.homeworkMemoryEntryIds ?? [],
        contentHash: params.contentHash ?? null,
        generationNotes: params.generationNotes ?? null,
        stableStrengths: params.stableStrengths ?? [],
        recurringIssues: params.recurringIssues ?? [],
        activeReviewBacklog: params.activeReviewBacklog ?? [],
        recentProgress: params.recentProgress ?? [],
        personalFacts: params.personalFacts ?? [],
        recommendedAssignmentDirections: params.recommendedAssignmentDirections ?? [],
        unresolvedIssues: params.unresolvedIssues ?? [],
        snapshotSummary: params.snapshotSummary ?? null,
        supersededById: null,
        supersededAt: null,
        createdAt: params.generatedAt,
        updatedAt: params.generatedAt,
      }),
    );
    const now = () => new Date('2026-03-20T17:30:00.000Z');

    const result = await generateStudentMemorySnapshot({
      config: {} as never,
      request: {
        studentId: 'student-1',
        lessonMemoryEntryIds: ['lesson-1', 'lesson-2', 'lesson-3'],
        homeworkMemoryEntryIds: ['homework-1', 'homework-2'],
        provider: 'openai',
        model: 'gpt-5.4',
        prompt: 'extract student memory snapshot',
      },
      overrides: {
        extractor,
        repository: {
          insertCanonicalReady,
        },
        now,
      },
    });

    expect(extractor).toHaveBeenCalledWith({
      config: {},
      request: {
        provider: 'openai',
        model: 'gpt-5.4',
        prompt: 'extract student memory snapshot',
        maxOutputTokens: undefined,
      },
    });

    expect(insertCanonicalReady).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'student-1',
        schemaVersion: 'student-memory-snapshot.v1',
        lessonMemoryEntryIds: ['lesson-1', 'lesson-2', 'lesson-3'],
        homeworkMemoryEntryIds: ['homework-1', 'homework-2'],
        provider: 'openai',
        model: 'gpt-5.4',
        snapshotSummary:
          'The student is more fluent and willing to speak, but tense contrast remains unresolved.',
      }),
    );

    const insertedParams = insertCanonicalReady.mock.calls[0]?.[0];
    expect(insertedParams.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.providerRequestId).toBe('snapshot-req-1');
    expect(result.usage?.totalTokens).toBe(180);
  });
});
