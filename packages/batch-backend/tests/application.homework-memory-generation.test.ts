import { describe, expect, it, vi } from 'vitest';

import { generateHomeworkMemoryFromSource } from '../src/application/homework-memory-generation.js';
import type { HomeworkMemoryRecord } from '../src/domain/homework-memory-model.js';

describe('application/homework-memory-generation', () => {
  it('persists extracted homework memory with published-delivery provenance', async () => {
    const extractor = vi.fn().mockResolvedValue({
      content: {
        homeworkSummary: 'Travel assignment with article review and an advice mission.',
        topic: 'Travel advice',
        grammarTargets: [{ name: 'Articles', note: 'Use a/an correctly.', targetKind: 'review' }],
        vocabularyTargets: [{ text: 'itinerary', note: 'Travel noun.', targetKind: 'new' }],
        reviewTargets: [{ label: 'Articles', note: 'Keep articles active in speech.' }],
        taskList: [
          {
            section: 'Mission',
            task: 'Give travel advice to the person.',
            taskType: 'mission',
            review: true,
          },
        ],
        pronunciationFocus: [
          {
            mode: 'sentence_stress',
            target: 'travel advice phrases',
            action: 'Stress the recommendation.',
          },
        ],
        studyTextType: 'dialogue',
        inputType: 'authentic',
        communicativeOutcome: 'Student gives spoken advice in English.',
        teacherFollowUpCues: [{ cueType: 'monitoring', note: 'Listen for article omissions.' }],
      },
      rawOutput: {},
      rawText: '{}',
      providerRequestId: 'req-homework-1',
      usage: { inputTokens: 80, outputTokens: 40, totalTokens: 120 },
    });

    const insertCanonicalReady = vi.fn().mockImplementation(
      async (params): Promise<HomeworkMemoryRecord> => ({
        id: 'homework-memory-1',
        studentId: params.studentId,
        jobId: params.jobId,
        assignmentLineageKey: params.assignmentLineageKey,
        promptPackageId: params.promptPackageId ?? null,
        draftId: params.draftId ?? null,
        recordingId: params.recordingId ?? null,
        transcriptId: params.transcriptId ?? null,
        schemaVersion: params.schemaVersion,
        generatedAt: params.generatedAt,
        provider: params.provider,
        model: params.model,
        status: 'ready',
        sourceKind: 'published_assignment',
        contentHash: params.contentHash ?? null,
        generationNotes: params.generationNotes ?? null,
        homeworkSummary: params.homeworkSummary ?? null,
        topic: params.topic ?? null,
        grammarTargets: params.grammarTargets ?? [],
        vocabularyTargets: params.vocabularyTargets ?? [],
        reviewTargets: params.reviewTargets ?? [],
        taskList: params.taskList ?? [],
        pronunciationFocus: params.pronunciationFocus ?? [],
        studyTextType: params.studyTextType ?? null,
        inputType: params.inputType ?? null,
        communicativeOutcome: params.communicativeOutcome ?? null,
        teacherFollowUpCues: params.teacherFollowUpCues ?? [],
        publishedAt: params.publishedAt,
        publishTargets: params.publishTargets ?? [],
        supersededById: null,
        supersededAt: null,
        createdAt: params.generatedAt,
        updatedAt: params.generatedAt,
      }),
    );

    const now = () => new Date('2026-03-20T16:00:00.000Z');

    const result = await generateHomeworkMemoryFromSource({
      config: {} as never,
      request: {
        source: {
          jobId: 'job-1',
          assignmentLineageKey: 'job-root',
          studentId: 'student-1',
          promptPackageId: 'prompt-1',
          draftId: 'draft-1',
          recordingId: 'recording-1',
          transcriptId: 'transcript-1',
          publishedAt: new Date('2026-03-20T15:30:00.000Z'),
          publishedMarkdown: '# homework',
          contentHash: 'sha-123',
          publishTargets: [
            {
              target: 'notion',
              url: 'https://notion.so/example',
              jobId: 'job-1',
              publishedAt: '2026-03-20T15:30:00.000Z',
            },
          ],
          normalizedMarkdown: {
            frontmatter: null,
            sections: [],
            plainText: '# homework',
          },
        },
        pendingEntryId: 'pending-1',
        pendingGenerationNotes: {
          trigger: 'publish-succeeded',
          requestedAt: '2026-03-20T15:31:00.000Z',
        },
        provider: 'openrouter',
        model: 'qwen/qwen3.5',
        prompt: 'extract homework memory',
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
        provider: 'openrouter',
        model: 'qwen/qwen3.5',
        prompt: 'extract homework memory',
        maxOutputTokens: undefined,
      },
    });
    expect(insertCanonicalReady).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'student-1',
        jobId: 'job-1',
        assignmentLineageKey: 'job-root',
        schemaVersion: 'homework-memory.v1',
        contentHash: 'sha-123',
        generationNotes: expect.objectContaining({
          trigger: 'publish-succeeded',
          pendingEntryId: 'pending-1',
          providerRequestId: 'req-homework-1',
        }),
      }),
    );
    expect(result.providerRequestId).toBe('req-homework-1');
    expect(result.usage?.totalTokens).toBe(120);
  });
});
