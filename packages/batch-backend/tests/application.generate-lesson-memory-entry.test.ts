import { describe, expect, it, vi } from 'vitest';

import { generateLessonMemoryEntry } from '../src/application/generate-lesson-memory-entry.js';
import type { LessonMemoryRecord } from '../src/domain/lesson-memory-model.js';

describe('application/generate-lesson-memory-entry', () => {
  it('persists extracted lesson memory and supersedes older ready rows for the transcript', async () => {
    const extractor = vi.fn().mockResolvedValue({
      content: {
        lessonSummary: 'Talked about travel plans and present perfect.',
        topicsDiscussed: [{ topic: 'travel', note: 'Weekend plans and destinations.' }],
        mistakePatterns: [
          {
            label: 'present perfect vs past simple',
            explanation: 'Student switched tense when describing recent experiences.',
            reviewRecommended: true,
            confidence: 'high',
            evidence: [],
          },
        ],
        grammarReviewed: [{ name: 'present perfect', note: 'Used for life experience.' }],
        grammarWatchlist: [{ name: 'past simple contrast', note: 'Keep timeline clear.' }],
        vocabularyFocus: [{ text: 'destination', note: 'Travel planning vocabulary.' }],
        pronunciationFocus: [
          {
            label: 'sentence stress',
            note: 'Stress on key travel nouns.',
            confidence: 'medium',
            evidence: [],
          },
        ],
        studentFacts: [],
        progressSignals: [{ label: 'fluency', note: 'Longer answers than usual.' }],
        followUpRecommendations: [{ label: 'review', note: 'Revisit tense contrast.' }],
      },
      rawOutput: {},
      rawText: '{}',
      providerRequestId: 'req-1',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });

    const insertCanonicalReady = vi.fn().mockImplementation(async (params): Promise<LessonMemoryRecord> => ({
      id: 'lesson-memory-1',
      studentId: params.studentId,
      transcriptId: params.transcriptId,
      recordingId: params.recordingId,
      schemaVersion: params.schemaVersion,
      generatedAt: params.generatedAt,
      provider: params.provider,
      model: params.model,
      status: params.status,
      sourceKind: 'lesson_transcript',
      generationNotes: params.generationNotes ?? null,
      lessonSummary: params.lessonSummary ?? null,
      topicsDiscussed: params.topicsDiscussed ?? [],
      mistakePatterns: params.mistakePatterns ?? [],
      grammarReviewed: params.grammarReviewed ?? [],
      grammarWatchlist: params.grammarWatchlist ?? [],
      vocabularyFocus: params.vocabularyFocus ?? [],
      pronunciationFocus: params.pronunciationFocus ?? [],
      studentFacts: params.studentFacts ?? [],
      progressSignals: params.progressSignals ?? [],
      followUpRecommendations: params.followUpRecommendations ?? [],
      supersededById: null,
      supersededAt: null,
      createdAt: params.generatedAt,
      updatedAt: params.generatedAt,
    }));
    const now = () => new Date('2026-03-20T15:00:00.000Z');

    const result = await generateLessonMemoryEntry({
      config: {} as never,
      request: {
        studentId: 'student-1',
        transcriptId: 'transcript-1',
        recordingId: 'recording-1',
        provider: 'openrouter',
        model: 'qwen/qwen3-235b-a22b',
        prompt: 'extract lesson memory',
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
        model: 'qwen/qwen3-235b-a22b',
        prompt: 'extract lesson memory',
        maxOutputTokens: undefined,
      },
    });
    expect(insertCanonicalReady).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'student-1',
        transcriptId: 'transcript-1',
        recordingId: 'recording-1',
        schemaVersion: 'lesson-memory.v1',
        provider: 'openrouter',
        model: 'qwen/qwen3-235b-a22b',
        lessonSummary: 'Talked about travel plans and present perfect.',
      }),
    );
    expect(result.providerRequestId).toBe('req-1');
    expect(result.usage?.totalTokens).toBe(150);
  });
});
