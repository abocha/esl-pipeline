import { describe, expect, it, vi } from 'vitest';

import { generateStudentMemorySnapshot } from '../src/application/student-memory-snapshot-generation.js';
import { buildStudentMemorySnapshotGenerationNotes } from '../src/application/student-memory-snapshot-generation-notes.js';
import {
  buildIncrementalStudentMemorySnapshotEnvelope,
  buildIncrementalStudentMemorySnapshotPrompt,
} from '../src/application/student-memory-snapshot-prompt.js';
import type { StudentMemorySnapshotRecord } from '../src/domain/student-memory-snapshot-model.js';

describe('application/student-memory-snapshot-generation', () => {
  it('builds incremental prompts from previous snapshot, trigger source, and bounded supporting context', () => {
    const previousSnapshot = {
      id: 'snapshot-parent',
      generatedAt: new Date('2026-03-19T22:00:00.000Z'),
      snapshotSummary: 'Parent summary with known tense issues.',
      stableStrengths: [{ label: 'Confidence', note: 'Speaks more freely.' }],
      recurringIssues: [],
      activeReviewBacklog: [{ label: 'Past tense', note: 'Keep recycling travel stories.' }],
      recentProgress: [],
      personalFacts: [],
      recommendedAssignmentDirections: [],
      unresolvedIssues: [],
    };
    const triggerSource = {
      kind: 'lesson_memory' as const,
      entry: {
        id: 'lesson-trigger',
        generatedAt: new Date('2026-03-20T00:00:00.000Z'),
        lessonSummary: 'Trigger lesson focused on airport conversations.',
        topicsDiscussed: [],
        mistakePatterns: [],
        grammarReviewed: [],
        grammarWatchlist: [],
        vocabularyFocus: [],
        pronunciationFocus: [],
        studentFacts: [],
        progressSignals: [],
        followUpRecommendations: [],
      },
    };
    const supportingLesson = {
      id: 'lesson-support',
      generatedAt: new Date('2026-03-18T00:00:00.000Z'),
      lessonSummary: 'Supporting lesson about hotel check-in.',
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
    const supportingHomework = {
      id: 'homework-support',
      generatedAt: new Date('2026-03-18T01:00:00.000Z'),
      homeworkSummary: 'Supporting homework practiced travel advice.',
      topic: 'travel',
      grammarTargets: [],
      vocabularyTargets: [],
      reviewTargets: [],
      taskList: [],
      pronunciationFocus: [],
      teacherFollowUpCues: [],
    };

    const prompt = buildIncrementalStudentMemorySnapshotPrompt({
      previousSnapshot,
      triggerSource,
      supportingLessonMemoryEntries: [supportingLesson],
      supportingHomeworkMemoryEntries: [supportingHomework],
    } as never);
    const envelope = buildIncrementalStudentMemorySnapshotEnvelope({
      previousSnapshot,
      triggerSource,
      supportingLessonMemoryEntries: [supportingLesson],
      supportingHomeworkMemoryEntries: [supportingHomework],
    } as never);

    expect(prompt).toContain('You are updating an existing long-term ESL student-memory snapshot.');
    expect(prompt).toContain('[PREVIOUS_SNAPSHOT]');
    expect(prompt).toContain('Parent summary with known tense issues.');
    expect(prompt).toContain('[TRIGGER_SOURCE]');
    expect(prompt).toContain('Trigger lesson focused on airport conversations.');
    expect(prompt).toContain('[SUPPORTING_LESSON_MEMORY_ENTRIES]');
    expect(prompt).toContain('Supporting lesson about hotel check-in.');
    expect(prompt).toContain('[SUPPORTING_HOMEWORK_MEMORY_ENTRIES]');
    expect(prompt).toContain('Supporting homework practiced travel advice.');
    expect(envelope.sourceManifest.map((source) => source.id)).toEqual([
      'student-memory-snapshot:snapshot-parent',
      'lesson-memory:lesson-trigger',
      'lesson-memory:lesson-support',
      'homework-memory:homework-support',
    ]);
  });

  it('normalizes previous snapshot personal-fact evidence to the previous snapshot source', () => {
    const previousSnapshot = {
      id: 'snapshot-parent',
      generatedAt: new Date('2026-03-19T22:00:00.000Z'),
      snapshotSummary: 'Parent summary.',
      stableStrengths: [],
      recurringIssues: [],
      activeReviewBacklog: [],
      recentProgress: [],
      personalFacts: [
        {
          fact: 'The student plans to visit Japan.',
          category: 'personal_plan',
          authority: 'student_stated',
          confidence: 'high',
          evidence: [
            {
              sourceId: 'lesson-memory:old-lesson',
              quote: 'I want to visit Japan.',
              speakerRole: 'student',
              evidenceNote: 'Original lesson note.',
              transcriptSpan: null,
            },
          ],
          reviewNeeded: false,
        },
      ],
      recommendedAssignmentDirections: [],
      unresolvedIssues: [],
    };
    const triggerSource = {
      kind: 'lesson_memory' as const,
      entry: {
        id: 'lesson-trigger',
        generatedAt: new Date('2026-03-20T00:00:00.000Z'),
        lessonSummary: 'Trigger lesson.',
        topicsDiscussed: [],
        mistakePatterns: [],
        grammarReviewed: [],
        grammarWatchlist: [],
        vocabularyFocus: [],
        pronunciationFocus: [],
        studentFacts: [],
        progressSignals: [],
        followUpRecommendations: [],
      },
    };

    const prompt = buildIncrementalStudentMemorySnapshotPrompt({
      previousSnapshot,
      triggerSource,
      supportingLessonMemoryEntries: [],
      supportingHomeworkMemoryEntries: [],
    } as never);
    const envelope = buildIncrementalStudentMemorySnapshotEnvelope({
      previousSnapshot,
      triggerSource,
      supportingLessonMemoryEntries: [],
      supportingHomeworkMemoryEntries: [],
    } as never);

    expect(prompt).toContain('"sourceId": "student-memory-snapshot:snapshot-parent"');
    expect(prompt).not.toContain('"sourceId": "lesson-memory:old-lesson"');
    expect(prompt).toContain('Original sourceId: lesson-memory:old-lesson');
    expect(prompt).toContain(
      'When preserving prior personal facts, cite the previous snapshot source unless the trigger or supporting sources provide newer evidence.',
    );
    expect(envelope.input).toContain('"sourceId":"student-memory-snapshot:snapshot-parent"');
    expect(envelope.input).not.toContain('"sourceId":"lesson-memory:old-lesson"');
    expect(envelope.sourceManifest.map((source) => source.id)).toEqual([
      'student-memory-snapshot:snapshot-parent',
      'lesson-memory:lesson-trigger',
    ]);
  });

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
      parentSnapshotId: null,
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
        expectedLatestReadySnapshotId: 'snapshot-parent',
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
        expectedLatestReadySnapshotId: 'snapshot-parent',
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
