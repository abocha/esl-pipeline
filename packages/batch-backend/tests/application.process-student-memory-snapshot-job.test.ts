import { describe, expect, it, vi } from 'vitest';

import { estimateGenerationTokens } from '../src/application/generation-budget-guard.js';
import { processStudentMemorySnapshotJob } from '../src/application/process-student-memory-snapshot-job.js';
import { StudentMemoryPacingDeferredError } from '../src/application/student-memory-generation-pacing.js';
import { loadConfig } from '../src/config/env.js';
import {
  StudentMemorySnapshotParentChangedError,
  StudentMemorySnapshotSourcesChangedError,
} from '../src/domain/student-memory-snapshot-repository.js';
import { logger } from '../src/infrastructure/logger.js';

function createTestConfig() {
  const base = loadConfig();
  return {
    ...base,
    generation: {
      ...base.generation,

      safetyMode: 'off' as const,
    },
  };
}

function lessonMemoryEntry(id: string, generatedAt: string, summary = id) {
  return {
    id,
    studentId: 'student-1',
    transcriptId: `transcript-${id}`,
    recordingId: `recording-${id}`,
    schemaVersion: 'lesson-memory.v1',
    generatedAt: new Date(generatedAt),
    provider: 'openai',
    model: 'gpt-5.2',
    status: 'ready',
    lessonSummary: summary,
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
}

function profileWorthyStudentFact(fact: string, category = 'goal') {
  return {
    fact,
    category,
    authority: 'student_stated',
    confidence: 'high',
    reviewNeeded: false,
    evidence: [{ quote: fact }],
  };
}

function homeworkMemoryEntry(id: string, generatedAt: string, summary = id) {
  return {
    id,
    studentId: 'student-1',
    jobId: `job-${id}`,
    assignmentLineageKey: `assignment-${id}`,
    schemaVersion: 'homework-memory.v1',
    generatedAt: new Date(generatedAt),
    provider: 'openai',
    model: 'gpt-5.2',
    status: 'ready',
    homeworkSummary: summary,
    topic: 'travel',
    grammarTargets: [],
    vocabularyTargets: [],
    reviewTargets: [],
    taskList: [],
    pronunciationFocus: [],
    teacherFollowUpCues: [],
  };
}

function largeText(prefix: string, tokenEstimate: number): string {
  return `${prefix} ${'x'.repeat(tokenEstimate * 4)}`;
}

function readySnapshot() {
  return {
    id: 'snapshot-ready-parent',
    studentId: 'student-1',
    schemaVersion: 'student-memory-snapshot.v1',
    generatedAt: new Date('2026-03-19T23:00:00.000Z'),
    provider: 'openai',
    model: 'gpt-5.2',
    status: 'ready',
    sourceKind: 'student_memory_rollup',
    lessonMemoryEntryIds: ['lesson-parent'],
    homeworkMemoryEntryIds: ['homework-parent'],
    contentHash: 'parent-hash',
    generationNotes: {
      strategy: 'full_rebuild_v1',
      coveredLessonMemoryEntryIds: ['lesson-parent'],
      coveredHomeworkMemoryEntryIds: ['homework-parent'],
    },
    stableStrengths: [{ label: 'Speaking confidence', note: 'Answers with less hesitation.' }],
    recurringIssues: [],
    activeReviewBacklog: [{ label: 'Tense contrast', note: 'Review travel story tense choices.' }],
    recentProgress: [],
    personalFacts: [],
    recommendedAssignmentDirections: [],
    unresolvedIssues: [],
    snapshotSummary: 'Parent snapshot summary',
  };
}

function generatedSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    ...readySnapshot(),
    id: 'snapshot-ready-1',
    generatedAt: new Date('2026-03-20T02:00:00.000Z'),
    contentHash: 'generated-hash',
    generationNotes: {},
    ...overrides,
  };
}

function successfulGenerator(snapshot = generatedSnapshot()) {
  return vi.fn().mockImplementation(async ({ request }) => {
    const finalizedGenerationNotes =
      request.finalizeGenerationNotes?.({
        content: snapshot,
        contentHash: snapshot.contentHash ?? 'generated-hash',
      }) ?? {};
    return {
      snapshot: {
        ...snapshot,
        generationNotes: {
          ...(snapshot.generationNotes ?? {}),
          ...finalizedGenerationNotes,
        },
      },
    };
  });
}

function finalizationRaceOverrides(args: {
  error: Error;
  markFailed: ReturnType<typeof vi.fn>;
  supersedePendingForStudent?: ReturnType<typeof vi.fn>;
  updateGenerationNotes?: ReturnType<typeof vi.fn>;
  requestRefresh?: ReturnType<typeof vi.fn>;
}) {
  return {
    lessonMemory: {
      list: vi.fn(),
      getById: vi.fn().mockResolvedValue(lessonMemoryEntry('lesson-1', '2026-03-20T00:00:00.000Z')),
      listRecentReadyByStudentId: vi.fn().mockResolvedValue([]),
    },
    homeworkMemory: {
      list: vi.fn(),
      getById: vi.fn(),
      listRecentReadyByStudentId: vi.fn().mockResolvedValue([]),
    },
    snapshots: {
      getById: vi.fn().mockResolvedValue({
        id: 'snapshot-pending-1',
        status: 'pending',
        generatedAt: new Date('2026-03-20T01:00:00.000Z'),
        generationNotes: {
          trigger: 'lesson-memory-ready',
          sourceEntryId: 'lesson-1',
        },
      }),
      getLatestReadyByStudentId: vi.fn().mockResolvedValue(readySnapshot()),
      markFailed: args.markFailed,
      supersedePendingForStudent: args.supersedePendingForStudent ?? vi.fn(),
      updateGenerationNotes: args.updateGenerationNotes ?? vi.fn(),
    },
    profileCandidates: { requestRefresh: args.requestRefresh ?? vi.fn() },
    generator: vi.fn().mockRejectedValue(args.error),
    pacer: { run: vi.fn(async ({ execute }) => execute()) },
  };
}

describe('application/process-student-memory-snapshot-job', () => {
  it('no-ops a delayed queue job after its pending snapshot was superseded', async () => {
    const generator = vi.fn();

    await processStudentMemorySnapshotJob({
      config: createTestConfig(),
      payload: {
        kind: 'student-memory-snapshot-refresh',
        studentId: 'student-1',
        pendingEntryId: 'snapshot-superseded-1',
        provider: 'openai',
        model: 'gpt-5.2',
        trigger: 'homework-memory-ready',
        sourceEntryId: 'homework-memory-1',
      },
      overrides: {
        snapshots: {
          getById: vi.fn().mockResolvedValue({
            id: 'snapshot-superseded-1',
            status: 'superseded',
          }),
          getLatestReadyByStudentId: vi.fn(),
          markFailed: vi.fn(),
          supersedePendingForStudent: vi.fn(),
          updateGenerationNotes: vi.fn(),
        },
        generator,
      },
    });

    expect(generator).not.toHaveBeenCalled();
  });

  it('uses incremental lesson-memory refresh without calling full-history list-all paths', async () => {
    const generator = successfulGenerator();
    const supersedePendingForStudent = vi.fn().mockResolvedValue([]);
    const requestRefresh = vi.fn().mockImplementation(async () => {});
    const updateGenerationNotes = vi.fn().mockResolvedValue(generatedSnapshot());
    const listAllLessonMemory = vi.fn().mockRejectedValue(new Error('must not list all lessons'));
    const listAllHomeworkMemory = vi
      .fn()
      .mockRejectedValue(new Error('must not list all homework'));
    const triggerLesson = lessonMemoryEntry(
      'lesson-1',
      '2026-03-20T00:00:00.000Z',
      'Trigger lesson',
    );
    const supportingLesson = lessonMemoryEntry(
      'lesson-support',
      '2026-03-19T00:00:00.000Z',
      'Supporting lesson',
    );
    const supportingHomework = homeworkMemoryEntry(
      'homework-support',
      '2026-03-19T01:00:00.000Z',
      'Supporting homework',
    );
    const parentSnapshot = {
      ...readySnapshot(),
      generationNotes: {
        ...readySnapshot().generationNotes,
        coveredLessonMemoryEntryIds: ['stale-note-lesson'],
        coveredHomeworkMemoryEntryIds: ['stale-note-homework'],
      },
    };

    await processStudentMemorySnapshotJob({
      config: createTestConfig(),
      payload: {
        kind: 'student-memory-snapshot-refresh',
        studentId: 'student-1',
        pendingEntryId: 'snapshot-pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
        trigger: 'lesson-memory-ready',
        sourceEntryId: 'lesson-1',
      },
      overrides: {
        lessonMemory: {
          list: listAllLessonMemory,
          getById: vi.fn().mockResolvedValue(triggerLesson),
          listRecentReadyByStudentId: vi.fn().mockResolvedValue([supportingLesson]),
        },
        homeworkMemory: {
          list: listAllHomeworkMemory,
          getById: vi.fn().mockResolvedValue(null),
          listRecentReadyByStudentId: vi.fn().mockResolvedValue([supportingHomework]),
        },
        snapshots: {
          getById: vi.fn().mockResolvedValue({
            id: 'snapshot-pending-1',
            status: 'pending',
            generatedAt: new Date('2026-03-20T01:00:00.000Z'),
            generationNotes: {
              trigger: 'lesson-memory-ready',
            },
          }),
          getLatestReadyByStudentId: vi.fn().mockResolvedValue(parentSnapshot),
          markFailed: vi.fn(),
          supersedePendingForStudent,
          updateGenerationNotes,
        },
        profileCandidates: {
          requestRefresh,
        },
        generator,
      } as never,
    });

    expect(listAllLessonMemory).not.toHaveBeenCalled();
    expect(listAllHomeworkMemory).not.toHaveBeenCalled();
    expect(generator).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          studentId: 'student-1',
          lessonMemoryEntryIds: ['lesson-parent', 'lesson-1', 'lesson-support'],
          homeworkMemoryEntryIds: ['homework-parent', 'homework-support'],
          pendingEntryId: 'snapshot-pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
          expectedLatestReadySnapshotId: 'snapshot-ready-parent',
        }),
      }),
    );
    const request = generator.mock.calls[0]?.[0].request;
    expect(request.pendingGenerationNotes).toMatchObject({
      trigger: 'lesson-memory-ready',
      sourceEntryId: 'lesson-1',
      strategy: 'incremental_v1_1',
      parentSnapshotId: 'snapshot-ready-parent',
      triggerSourceKind: 'lesson_memory',
      triggerSourceEntryId: 'lesson-1',
      includedLessonMemoryEntryIds: ['lesson-1', 'lesson-support'],
      includedHomeworkMemoryEntryIds: ['homework-support'],
      coveredLessonMemoryEntryIds: ['lesson-parent', 'lesson-1', 'lesson-support'],
      coveredHomeworkMemoryEntryIds: ['homework-parent', 'homework-support'],
      includedLessonMemoryCount: 2,
      includedHomeworkMemoryCount: 1,
      coveredLessonMemoryCount: 3,
      coveredHomeworkMemoryCount: 2,
      promptByteLength: Buffer.byteLength(request.prompt, 'utf8'),
      inputTokenEstimate: estimateGenerationTokens({
        prompt: request.prompt,
        hardCap: 0,
      }),
      materialChange: null,
    });
    expect(supersedePendingForStudent).toHaveBeenCalled();
    const generated = await generator.mock.results[0]?.value;
    expect(generated.snapshot.generationNotes).toEqual(
      expect.objectContaining({
        candidateRefresh: expect.objectContaining({
          requested: false,
          enqueueStatus: 'not_requested',
          reasons: [],
          triggerProfileWorthyStudentFactCount: 0,
          skippedNoProfileWorthyDeltaCount: 1,
        }),
        materialChange: false,
      }),
    );
    expect(requestRefresh).not.toHaveBeenCalled();
    expect(updateGenerationNotes).not.toHaveBeenCalled();
  });

  it('requests candidate refresh when the trigger lesson contains a profile-worthy student fact', async () => {
    const generator = successfulGenerator();
    const requestRefresh = vi.fn().mockImplementation(async () => {});
    const updateGenerationNotes = vi.fn().mockResolvedValue(generatedSnapshot());
    const triggerLesson = {
      ...lessonMemoryEntry('lesson-1', '2026-03-20T00:00:00.000Z', 'Trigger lesson'),
      studentFacts: [profileWorthyStudentFact('Wants to speak English more confidently at work.')],
    };

    await processStudentMemorySnapshotJob({
      config: createTestConfig(),
      payload: {
        kind: 'student-memory-snapshot-refresh',
        studentId: 'student-1',
        pendingEntryId: 'snapshot-pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
        trigger: 'lesson-memory-ready',
        sourceEntryId: 'lesson-1',
      },
      overrides: {
        lessonMemory: {
          list: vi.fn(),
          getById: vi.fn().mockResolvedValue(triggerLesson),
          listRecentReadyByStudentId: vi.fn().mockResolvedValue([]),
        },
        homeworkMemory: {
          list: vi.fn(),
          getById: vi.fn(),
          listRecentReadyByStudentId: vi.fn().mockResolvedValue([]),
        },
        snapshots: {
          getById: vi.fn().mockResolvedValue({
            id: 'snapshot-pending-1',
            status: 'pending',
            generatedAt: new Date('2026-03-20T01:00:00.000Z'),
            generationNotes: null,
          }),
          getLatestReadyByStudentId: vi.fn().mockResolvedValue(readySnapshot()),
          markFailed: vi.fn(),
          supersedePendingForStudent: vi.fn().mockResolvedValue([]),
          updateGenerationNotes,
        },
        profileCandidates: { requestRefresh },
        generator,
      } as never,
    });

    const generated = await generator.mock.results[0]?.value;
    expect(generated.snapshot.generationNotes).toEqual(
      expect.objectContaining({
        candidateRefresh: expect.objectContaining({
          requested: true,
          enqueueStatus: 'pending',
          reasons: ['trigger_profile_worthy_student_fact'],
          triggerProfileWorthyStudentFactCount: 1,
          skippedNoProfileWorthyDeltaCount: 0,
        }),
        materialChange: false,
      }),
    );
    expect(updateGenerationNotes).toHaveBeenNthCalledWith(1, {
      id: 'snapshot-ready-1',
      generationNotes: expect.objectContaining({
        candidateRefresh: expect.objectContaining({
          requested: true,
          enqueueStatus: 'enqueued',
        }),
      }),
    });
    expect(requestRefresh).toHaveBeenCalledWith({
      params: {
        studentId: 'student-1',
        sourceSnapshotId: 'snapshot-ready-1',
        trigger: 'student-memory-snapshot-ready',
      },
    });
  });

  it('records failed candidate enqueue delivery without invalidating the ready snapshot', async () => {
    const generator = successfulGenerator();
    const enqueueError = new Error('Redis unavailable');
    const requestRefresh = vi.fn().mockRejectedValue(enqueueError);
    const updateGenerationNotes = vi.fn().mockResolvedValue(generatedSnapshot());
    const triggerLesson = {
      ...lessonMemoryEntry('lesson-1', '2026-03-20T00:00:00.000Z', 'Trigger lesson'),
      studentFacts: [profileWorthyStudentFact('Wants English for a new role.')],
    };
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await expect(
      processStudentMemorySnapshotJob({
        config: createTestConfig(),
        payload: {
          kind: 'student-memory-snapshot-refresh',
          studentId: 'student-1',
          pendingEntryId: 'snapshot-pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
          trigger: 'lesson-memory-ready',
          sourceEntryId: 'lesson-1',
        },
        overrides: {
          lessonMemory: {
            list: vi.fn(),
            getById: vi.fn().mockResolvedValue(triggerLesson),
            listRecentReadyByStudentId: vi.fn().mockResolvedValue([]),
          },
          homeworkMemory: {
            list: vi.fn(),
            getById: vi.fn(),
            listRecentReadyByStudentId: vi.fn().mockResolvedValue([]),
          },
          snapshots: {
            getById: vi.fn().mockResolvedValue({
              id: 'snapshot-pending-1',
              status: 'pending',
              generatedAt: new Date('2026-03-20T01:00:00.000Z'),
              generationNotes: null,
            }),
            getLatestReadyByStudentId: vi.fn().mockResolvedValue(readySnapshot()),
            markFailed: vi.fn(),
            supersedePendingForStudent: vi.fn().mockResolvedValue([]),
            updateGenerationNotes,
          },
          profileCandidates: { requestRefresh },
          generator,
        } as never,
      }),
    ).resolves.toBeUndefined();

    const generated = await generator.mock.results[0]?.value;
    expect(generated.snapshot.generationNotes).toEqual(
      expect.objectContaining({
        candidateRefresh: expect.objectContaining({ enqueueStatus: 'pending' }),
      }),
    );
    expect(updateGenerationNotes).toHaveBeenNthCalledWith(1, {
      id: 'snapshot-ready-1',
      generationNotes: expect.objectContaining({
        candidateRefresh: expect.objectContaining({ enqueueStatus: 'failed' }),
      }),
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'Student profile candidate refresh enqueue failed; continuing',
      expect.objectContaining({
        event: 'student_profile_candidate_refresh_enqueue_failed',
        error: enqueueError.message,
      }),
    );
    warnSpy.mockRestore();
  });

  it('retains durable pending intent when the enqueued-status metadata write fails', async () => {
    const generator = successfulGenerator();
    const requestRefresh = vi.fn().mockResolvedValue(undefined);
    const metadataError = new Error('Postgres unavailable');
    const updateGenerationNotes = vi
      .fn()
      .mockRejectedValueOnce(metadataError)
      .mockResolvedValueOnce(generatedSnapshot());
    const triggerLesson = {
      ...lessonMemoryEntry('lesson-1', '2026-03-20T00:00:00.000Z', 'Trigger lesson'),
      studentFacts: [profileWorthyStudentFact('Wants English for a new role.')],
    };
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await expect(
      processStudentMemorySnapshotJob({
        config: createTestConfig(),
        payload: {
          kind: 'student-memory-snapshot-refresh',
          studentId: 'student-1',
          pendingEntryId: 'snapshot-pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
          trigger: 'lesson-memory-ready',
          sourceEntryId: 'lesson-1',
        },
        overrides: {
          lessonMemory: {
            list: vi.fn(),
            getById: vi.fn().mockResolvedValue(triggerLesson),
            listRecentReadyByStudentId: vi.fn().mockResolvedValue([]),
          },
          homeworkMemory: {
            list: vi.fn(),
            getById: vi.fn(),
            listRecentReadyByStudentId: vi.fn().mockResolvedValue([]),
          },
          snapshots: {
            getById: vi.fn().mockResolvedValue({
              id: 'snapshot-pending-1',
              status: 'pending',
              generatedAt: new Date('2026-03-20T01:00:00.000Z'),
              generationNotes: null,
            }),
            getLatestReadyByStudentId: vi.fn().mockResolvedValue(readySnapshot()),
            markFailed: vi.fn(),
            supersedePendingForStudent: vi.fn().mockResolvedValue([]),
            updateGenerationNotes,
          },
          profileCandidates: { requestRefresh },
          generator,
        } as never,
      }),
    ).resolves.toBeUndefined();

    expect(requestRefresh).toHaveBeenCalledTimes(1);
    const generated = await generator.mock.results[0]?.value;
    expect(generated.snapshot.generationNotes).toEqual(
      expect.objectContaining({
        candidateRefresh: expect.objectContaining({
          requested: true,
          enqueueStatus: 'pending',
        }),
      }),
    );
    expect(updateGenerationNotes).toHaveBeenNthCalledWith(2, {
      id: 'snapshot-ready-1',
      generationNotes: expect.objectContaining({
        candidateRefresh: expect.objectContaining({
          requested: true,
          enqueueStatus: 'failed',
        }),
      }),
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'Student profile candidate refresh enqueue failed; continuing',
      expect.objectContaining({
        event: 'student_profile_candidate_refresh_enqueue_failed',
        error: metadataError.message,
      }),
    );
    warnSpy.mockRestore();
  });

  it('requests candidate refresh when generated snapshot personal facts change', async () => {
    const generator = successfulGenerator(
      generatedSnapshot({
        personalFacts: [profileWorthyStudentFact('Lives in Da Nang with her family.', 'personal')],
      }),
    );
    const requestRefresh = vi.fn().mockImplementation(async () => {});
    const updateGenerationNotes = vi.fn().mockResolvedValue(generatedSnapshot());

    await processStudentMemorySnapshotJob({
      config: createTestConfig(),
      payload: {
        kind: 'student-memory-snapshot-refresh',
        studentId: 'student-1',
        pendingEntryId: 'snapshot-pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
        trigger: 'lesson-memory-ready',
        sourceEntryId: 'lesson-1',
      },
      overrides: {
        lessonMemory: {
          list: vi.fn(),
          getById: vi
            .fn()
            .mockResolvedValue(lessonMemoryEntry('lesson-1', '2026-03-20T00:00:00.000Z')),
          listRecentReadyByStudentId: vi.fn().mockResolvedValue([]),
        },
        homeworkMemory: {
          list: vi.fn(),
          getById: vi.fn(),
          listRecentReadyByStudentId: vi.fn().mockResolvedValue([]),
        },
        snapshots: {
          getById: vi.fn().mockResolvedValue({
            id: 'snapshot-pending-1',
            status: 'pending',
            generatedAt: new Date('2026-03-20T01:00:00.000Z'),
            generationNotes: null,
          }),
          getLatestReadyByStudentId: vi.fn().mockResolvedValue(readySnapshot()),
          markFailed: vi.fn(),
          supersedePendingForStudent: vi.fn().mockResolvedValue([]),
          updateGenerationNotes,
        },
        profileCandidates: { requestRefresh },
        generator,
      } as never,
    });

    expect(updateGenerationNotes).toHaveBeenCalledWith({
      id: 'snapshot-ready-1',
      generationNotes: expect.objectContaining({
        candidateRefresh: expect.objectContaining({
          requested: true,
          reasons: ['personal_facts_hash_changed'],
          personalFactsHashChanged: true,
        }),
        materialChange: true,
      }),
    });
    expect(requestRefresh).toHaveBeenCalled();
  });

  it('requests candidate refresh when durable preferences or constraints change', async () => {
    const generator = successfulGenerator(
      generatedSnapshot({
        personalFacts: [
          profileWorthyStudentFact(
            'Prefers short structured homework checklists.',
            'study preference',
          ),
        ],
      }),
    );
    const requestRefresh = vi.fn().mockImplementation(async () => {});
    const updateGenerationNotes = vi.fn().mockResolvedValue(generatedSnapshot());

    await processStudentMemorySnapshotJob({
      config: createTestConfig(),
      payload: {
        kind: 'student-memory-snapshot-refresh',
        studentId: 'student-1',
        pendingEntryId: 'snapshot-pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
        trigger: 'homework-memory-ready',
        sourceEntryId: 'homework-1',
      },
      overrides: {
        lessonMemory: {
          list: vi.fn(),
          getById: vi.fn(),
          listRecentReadyByStudentId: vi.fn().mockResolvedValue([]),
        },
        homeworkMemory: {
          list: vi.fn(),
          getById: vi
            .fn()
            .mockResolvedValue(homeworkMemoryEntry('homework-1', '2026-03-20T00:00:00.000Z')),
          listRecentReadyByStudentId: vi.fn().mockResolvedValue([]),
        },
        snapshots: {
          getById: vi.fn().mockResolvedValue({
            id: 'snapshot-pending-1',
            status: 'pending',
            generatedAt: new Date('2026-03-20T01:00:00.000Z'),
            generationNotes: null,
          }),
          getLatestReadyByStudentId: vi.fn().mockResolvedValue(readySnapshot()),
          markFailed: vi.fn(),
          supersedePendingForStudent: vi.fn().mockResolvedValue([]),
          updateGenerationNotes,
        },
        profileCandidates: { requestRefresh },
        generator,
      } as never,
    });

    expect(updateGenerationNotes).toHaveBeenCalledWith({
      id: 'snapshot-ready-1',
      generationNotes: expect.objectContaining({
        candidateRefresh: expect.objectContaining({
          requested: true,
          reasons: ['personal_facts_hash_changed', 'durable_preferences_constraints_changed'],
          durablePreferencesConstraintsHashChanged: true,
        }),
        materialChange: true,
      }),
    });
    expect(requestRefresh).toHaveBeenCalled();
  });

  it('requests candidate refresh for manual replay only when explicitly requested', async () => {
    const generator = successfulGenerator(generatedSnapshot({ id: 'snapshot-ready-manual' }));
    const requestRefresh = vi.fn().mockImplementation(async () => {});
    const updateGenerationNotes = vi.fn().mockResolvedValue(generatedSnapshot());

    await processStudentMemorySnapshotJob({
      config: createTestConfig(),
      payload: {
        kind: 'student-memory-snapshot-refresh',
        studentId: 'student-1',
        pendingEntryId: 'snapshot-pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
        trigger: 'manual-replay',
        strategy: 'manual_rebuild_v1_1',
        operatorReason: 'Audit candidate refresh gating',
        requestCandidateRefresh: true,
      },
      overrides: {
        lessonMemory: {
          list: vi
            .fn()
            .mockResolvedValue([lessonMemoryEntry('lesson-1', '2026-03-20T00:00:00.000Z')]),
        },
        homeworkMemory: { list: vi.fn().mockResolvedValue([]) },
        snapshots: {
          getById: vi.fn().mockResolvedValue({
            id: 'snapshot-pending-1',
            status: 'pending',
            generatedAt: new Date('2026-03-20T01:00:00.000Z'),
            generationNotes: {
              trigger: 'manual-replay',
              strategy: 'manual_rebuild_v1_1',
              operatorReason: 'Audit candidate refresh gating',
              requestCandidateRefresh: true,
            },
          }),
          markFailed: vi.fn(),
          supersedePendingForStudent: vi.fn().mockResolvedValue([]),
          updateGenerationNotes,
        },
        profileCandidates: { requestRefresh },
        generator,
      } as never,
    });

    expect(generator.mock.calls[0]?.[0].request).not.toHaveProperty(
      'expectedLatestReadySnapshotId',
    );
    expect(updateGenerationNotes).toHaveBeenCalledWith({
      id: 'snapshot-ready-manual',
      generationNotes: expect.objectContaining({
        candidateRefresh: expect.objectContaining({
          requested: true,
          reasons: ['manual_replay_requested_candidate_refresh'],
          manualReplayRequestedCandidateRefresh: true,
        }),
      }),
    });
    expect(requestRefresh).toHaveBeenCalledWith({
      params: {
        studentId: 'student-1',
        sourceSnapshotId: 'snapshot-ready-manual',
        trigger: 'manual-replay',
      },
    });
  });

  it('does not request candidate refresh for manual replay without the explicit candidate-refresh flag', async () => {
    const generator = successfulGenerator(
      generatedSnapshot({
        id: 'snapshot-ready-manual',
        personalFacts: [profileWorthyStudentFact('Lives in Da Nang with her family.', 'personal')],
      }),
    );
    const requestRefresh = vi.fn().mockImplementation(async () => {});
    const updateGenerationNotes = vi.fn().mockResolvedValue(generatedSnapshot());

    await processStudentMemorySnapshotJob({
      config: createTestConfig(),
      payload: {
        kind: 'student-memory-snapshot-refresh',
        studentId: 'student-1',
        pendingEntryId: 'snapshot-pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
        trigger: 'manual-replay',
        strategy: 'manual_rebuild_v1_1',
        operatorReason: 'Manual rebuild without candidate refresh',
      },
      overrides: {
        lessonMemory: {
          list: vi
            .fn()
            .mockResolvedValue([lessonMemoryEntry('lesson-1', '2026-03-20T00:00:00.000Z')]),
        },
        homeworkMemory: { list: vi.fn().mockResolvedValue([]) },
        snapshots: {
          getById: vi.fn().mockResolvedValue({
            id: 'snapshot-pending-1',
            status: 'pending',
            generatedAt: new Date('2026-03-20T01:00:00.000Z'),
            generationNotes: {
              trigger: 'manual-replay',
              strategy: 'manual_rebuild_v1_1',
              operatorReason: 'Manual rebuild without candidate refresh',
            },
          }),
          markFailed: vi.fn(),
          supersedePendingForStudent: vi.fn().mockResolvedValue([]),
          updateGenerationNotes,
        },
        profileCandidates: { requestRefresh },
        generator,
      } as never,
    });

    const generated = await generator.mock.results[0]?.value;
    expect(generated.snapshot.generationNotes).toEqual(
      expect.objectContaining({
        candidateRefresh: expect.objectContaining({
          requested: false,
          enqueueStatus: 'not_requested',
          reasons: [],
          manualReplayRequestedCandidateRefresh: false,
          skippedNoProfileWorthyDeltaCount: 1,
        }),
      }),
    );
    expect(updateGenerationNotes).not.toHaveBeenCalled();
    expect(requestRefresh).not.toHaveBeenCalled();
  });

  it('uses bootstrap incremental refresh for homework-memory jobs without a previous ready snapshot', async () => {
    const generator = successfulGenerator(
      generatedSnapshot({
        id: 'snapshot-ready-1',
        generatedAt: new Date('2026-03-20T02:00:00.000Z'),
      }),
    );
    const listAllLessonMemory = vi.fn().mockRejectedValue(new Error('must not list all lessons'));
    const listAllHomeworkMemory = vi
      .fn()
      .mockRejectedValue(new Error('must not list all homework'));
    const triggerHomework = homeworkMemoryEntry(
      'homework-1',
      '2026-03-20T00:45:00.000Z',
      'Trigger homework',
    );
    const supportingLessons = Array.from({ length: 5 }, (_, index) =>
      lessonMemoryEntry(
        `lesson-support-${index + 1}`,
        `2026-03-19T0${index}:00:00.000Z`,
        `Supporting lesson ${index + 1}`,
      ),
    );
    const supportingHomework = [
      homeworkMemoryEntry(
        'homework-support-1',
        '2026-03-19T01:00:00.000Z',
        'Supporting homework 1',
      ),
      homeworkMemoryEntry(
        'homework-support-2',
        '2026-03-19T02:00:00.000Z',
        'Supporting homework 2',
      ),
    ];
    const listRecentLessonMemory = vi.fn().mockResolvedValue(supportingLessons);
    const listRecentHomeworkMemory = vi.fn().mockResolvedValue(supportingHomework);

    await processStudentMemorySnapshotJob({
      config: createTestConfig(),
      payload: {
        kind: 'student-memory-snapshot-refresh',
        studentId: 'student-1',
        pendingEntryId: 'snapshot-pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
        trigger: 'homework-memory-ready',
        sourceEntryId: 'homework-1',
      },
      overrides: {
        lessonMemory: {
          list: listAllLessonMemory,
          getById: vi.fn().mockResolvedValue(null),
          listRecentReadyByStudentId: listRecentLessonMemory,
        },
        homeworkMemory: {
          list: listAllHomeworkMemory,
          getById: vi.fn().mockResolvedValue(triggerHomework),
          listRecentReadyByStudentId: listRecentHomeworkMemory,
        },
        snapshots: {
          getById: vi.fn().mockResolvedValue({
            id: 'snapshot-pending-1',
            status: 'pending',
            generatedAt: new Date('2026-03-20T01:00:00.000Z'),
            generationNotes: {
              trigger: 'homework-memory-ready',
            },
          }),
          getLatestReadyByStudentId: vi.fn().mockResolvedValue(null),
          markFailed: vi.fn(),
          supersedePendingForStudent: vi.fn().mockResolvedValue([]),
        },
        profileCandidates: {
          requestRefresh: vi.fn().mockImplementation(async () => {}),
        },
        generator,
      } as never,
    });

    expect(listAllLessonMemory).not.toHaveBeenCalled();
    expect(listAllHomeworkMemory).not.toHaveBeenCalled();
    expect(listRecentLessonMemory).toHaveBeenCalledWith('student-1', {
      limit: 5,
    });
    expect(listRecentHomeworkMemory).toHaveBeenCalledWith('student-1', {
      limit: 2,
      excludeAssignmentLineageKey: 'assignment-homework-1',
    });
    const request = generator.mock.calls[0]?.[0].request;
    expect(request.expectedLatestReadySnapshotId).toBeNull();
    const expectedLessonIds = supportingLessons.map((entry) => entry.id);
    expect(request.pendingGenerationNotes).toMatchObject({
      trigger: 'homework-memory-ready',
      strategy: 'bootstrap_incremental_v1_1',
      parentSnapshotId: null,
      triggerSourceKind: 'homework_memory',
      triggerSourceEntryId: 'homework-1',
      includedLessonMemoryEntryIds: expectedLessonIds,
      includedHomeworkMemoryEntryIds: ['homework-1', 'homework-support-1', 'homework-support-2'],
      coveredLessonMemoryEntryIds: expectedLessonIds,
      coveredHomeworkMemoryEntryIds: ['homework-1', 'homework-support-1', 'homework-support-2'],
      includedLessonMemoryCount: 5,
      includedHomeworkMemoryCount: 3,
    });
  });

  it('fails oversized incremental prompts before provider execution', async () => {
    const markFailed = vi.fn().mockResolvedValue(null);
    const generator = successfulGenerator(
      generatedSnapshot({
        id: 'snapshot-ready-oversized',
        generatedAt: new Date('2026-03-20T02:00:00.000Z'),
      }),
    );
    const pacer = {
      run: vi.fn(async ({ execute }) => execute()),
    };
    const triggerLesson = lessonMemoryEntry(
      'lesson-oversized',
      '2026-03-20T00:00:00.000Z',
      largeText('Trigger lesson is too large for incremental refresh.', 36_000),
    );

    await expect(
      processStudentMemorySnapshotJob({
        config: createTestConfig(),
        payload: {
          kind: 'student-memory-snapshot-refresh',
          studentId: 'student-1',
          pendingEntryId: 'snapshot-pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
          trigger: 'lesson-memory-ready',
          sourceEntryId: 'lesson-oversized',
        },
        attemptsMade: 0,
        maxAttempts: 5,
        overrides: {
          lessonMemory: {
            list: vi.fn(),
            getById: vi.fn().mockResolvedValue(triggerLesson),
            listRecentReadyByStudentId: vi
              .fn()
              .mockResolvedValue([lessonMemoryEntry('lesson-support', '2026-03-19T00:00:00.000Z')]),
          },
          homeworkMemory: {
            list: vi.fn(),
            getById: vi.fn(),
            listRecentReadyByStudentId: vi
              .fn()
              .mockResolvedValue([
                homeworkMemoryEntry('homework-support', '2026-03-19T01:00:00.000Z'),
              ]),
          },
          snapshots: {
            getById: vi.fn().mockResolvedValue({
              id: 'snapshot-pending-1',
              status: 'pending',
              generatedAt: new Date('2026-03-20T01:00:00.000Z'),
              generationNotes: {
                trigger: 'lesson-memory-ready',
              },
            }),
            getLatestReadyByStudentId: vi.fn().mockResolvedValue(readySnapshot()),
            markFailed,
            supersedePendingForStudent: vi.fn(),
          },
          profileCandidates: {
            requestRefresh: vi.fn(),
          },
          generator,
          pacer,
        } as never,
      }),
    ).rejects.toThrow('Student-memory snapshot incremental prompt exceeds hard input-token budget');

    expect(pacer.run).not.toHaveBeenCalled();
    expect(generator).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith({
      id: 'snapshot-pending-1',
      errorMessage: expect.stringContaining(
        'Student-memory snapshot incremental prompt exceeds hard input-token budget',
      ),
      generationNotes: expect.objectContaining({
        strategy: 'incremental_v1_1',
        trigger: 'lesson-memory-ready',
        budgetDecision: expect.objectContaining({
          action: 'fail_before_provider',
          optionalSupportingContextDropped: true,
          incrementalTargetInputTokens: 25_000,
          incrementalHardInputTokens: 35_000,
          failureCode: 'incremental_prompt_input_tokens_exceeded_hard_budget',
        }),
        failureDetails: expect.objectContaining({
          code: 'incremental_prompt_input_tokens_exceeded_hard_budget',
          stage: 'snapshot_prompt_budget_preflight',
        }),
      }),
    });
  });

  it('drops optional incremental supporting context above target before provider execution', async () => {
    const generator = successfulGenerator(
      generatedSnapshot({
        id: 'snapshot-ready-compacted',
        generatedAt: new Date('2026-03-20T02:00:00.000Z'),
      }),
    );
    const triggerLesson = lessonMemoryEntry(
      'lesson-compact-trigger',
      '2026-03-20T00:00:00.000Z',
      'Small trigger source stays within hard budget after compaction.',
    );
    const supportingLesson = lessonMemoryEntry(
      'lesson-support-large',
      '2026-03-19T00:00:00.000Z',
      largeText('OPTIONAL_SUPPORTING_CONTEXT_SHOULD_BE_DROPPED', 26_000),
    );
    const supportingHomework = homeworkMemoryEntry(
      'homework-support-large',
      '2026-03-19T01:00:00.000Z',
      largeText('OPTIONAL_HOMEWORK_CONTEXT_SHOULD_BE_DROPPED', 2_000),
    );

    await processStudentMemorySnapshotJob({
      config: createTestConfig(),
      payload: {
        kind: 'student-memory-snapshot-refresh',
        studentId: 'student-1',
        pendingEntryId: 'snapshot-pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
        trigger: 'lesson-memory-ready',
        sourceEntryId: 'lesson-compact-trigger',
      },
      overrides: {
        lessonMemory: {
          list: vi.fn(),
          getById: vi.fn().mockResolvedValue(triggerLesson),
          listRecentReadyByStudentId: vi.fn().mockResolvedValue([supportingLesson]),
        },
        homeworkMemory: {
          list: vi.fn(),
          getById: vi.fn(),
          listRecentReadyByStudentId: vi.fn().mockResolvedValue([supportingHomework]),
        },
        snapshots: {
          getById: vi.fn().mockResolvedValue({
            id: 'snapshot-pending-1',
            status: 'pending',
            generatedAt: new Date('2026-03-20T01:00:00.000Z'),
            generationNotes: {
              trigger: 'lesson-memory-ready',
            },
          }),
          getLatestReadyByStudentId: vi.fn().mockResolvedValue(readySnapshot()),
          markFailed: vi.fn(),
          supersedePendingForStudent: vi.fn().mockResolvedValue([]),
        },
        profileCandidates: {
          requestRefresh: vi.fn().mockImplementation(async () => {}),
        },
        generator,
      } as never,
    });

    expect(generator).toHaveBeenCalled();
    const request = generator.mock.calls[0]?.[0].request;
    expect(request.prompt).toContain('lesson-compact-trigger');
    expect(request.prompt).not.toContain('OPTIONAL_SUPPORTING_CONTEXT_SHOULD_BE_DROPPED');
    expect(request.prompt).not.toContain('OPTIONAL_HOMEWORK_CONTEXT_SHOULD_BE_DROPPED');
    expect(request.envelope.sourceManifest).toEqual([
      {
        id: 'student-memory-snapshot:snapshot-ready-parent',
        label: 'PREVIOUS_STUDENT_MEMORY_SNAPSHOT',
      },
      {
        id: 'lesson-memory:lesson-compact-trigger',
        label: 'TRIGGER_LESSON_MEMORY_ENTRY',
      },
    ]);
    expect(request.pendingGenerationNotes).toMatchObject({
      strategy: 'incremental_v1_1',
      includedLessonMemoryEntryIds: ['lesson-compact-trigger'],
      includedHomeworkMemoryEntryIds: [],
      coveredLessonMemoryEntryIds: ['lesson-parent', 'lesson-compact-trigger'],
      coveredHomeworkMemoryEntryIds: ['homework-parent'],
      budgetDecision: expect.objectContaining({
        action: 'drop_optional_context',
        optionalSupportingContextDropped: true,
        incrementalTargetInputTokens: 25_000,
        incrementalHardInputTokens: 35_000,
        initialInputTokenEstimate: expect.any(Number),
        inputTokenEstimate: expect.any(Number),
      }),
    });
    expect(request.pendingGenerationNotes.budgetDecision.initialInputTokenEstimate).toBeGreaterThan(
      25_000,
    );
    expect(request.pendingGenerationNotes.inputTokenEstimate).toBeLessThanOrEqual(25_000);
  });

  it('allows oversized explicit manual rebuilds and records warning metadata', async () => {
    const generator = successfulGenerator(
      generatedSnapshot({
        id: 'snapshot-ready-manual',
        generatedAt: new Date('2026-03-20T02:00:00.000Z'),
      }),
    );
    const manualLesson = lessonMemoryEntry(
      'lesson-manual-large',
      '2026-03-20T00:00:00.000Z',
      largeText('Manual rebuild intentionally includes a large history.', 61_000),
    );
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await processStudentMemorySnapshotJob({
      config: createTestConfig(),
      payload: {
        kind: 'student-memory-snapshot-refresh',
        studentId: 'student-1',
        pendingEntryId: 'snapshot-pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
        trigger: 'manual-replay',
        strategy: 'manual_rebuild_v1_1',
        operatorReason: 'Intentional quality reset after drift check',
      },
      overrides: {
        lessonMemory: {
          list: vi.fn().mockResolvedValue([manualLesson]),
        },
        homeworkMemory: {
          list: vi.fn().mockResolvedValue([]),
        },
        snapshots: {
          getById: vi.fn().mockResolvedValue({
            id: 'snapshot-pending-1',
            status: 'pending',
            generatedAt: new Date('2026-03-20T01:00:00.000Z'),
            generationNotes: {
              trigger: 'manual-replay',
              strategy: 'manual_rebuild_v1_1',
              operatorReason: 'Intentional quality reset after drift check',
            },
          }),
          markFailed: vi.fn(),
          supersedePendingForStudent: vi.fn().mockResolvedValue([]),
        },
        profileCandidates: {
          requestRefresh: vi.fn().mockImplementation(async () => {}),
        },
        generator,
      } as never,
    });

    expect(generator).toHaveBeenCalled();
    const request = generator.mock.calls[0]?.[0].request;
    expect(request.pendingGenerationNotes).toMatchObject({
      strategy: 'manual_rebuild_v1_1',
      trigger: 'manual-replay',
      operatorReason: 'Intentional quality reset after drift check',
      budgetDecision: expect.objectContaining({
        action: 'warn_allow',
        fullRebuildWarnInputTokens: 60_000,
        warningCode: 'manual_full_rebuild_prompt_over_warning_budget',
      }),
    });
    expect(request.pendingGenerationNotes.inputTokenEstimate).toBeGreaterThan(60_000);
    expect(warnSpy).toHaveBeenCalledWith(
      'Student-memory snapshot manual rebuild prompt exceeds warning budget',
      expect.objectContaining({
        event: 'student_memory_snapshot_manual_rebuild_prompt_over_warning_budget',
        inputTokenEstimate: request.pendingGenerationNotes.inputTokenEstimate,
        fullRebuildWarnInputTokens: 60_000,
      }),
    );
    warnSpy.mockRestore();
  });

  it('treats parent-changed snapshot finalization as retryable without side effects before the final attempt', async () => {
    const markFailed = vi.fn().mockResolvedValue(null);
    const supersedePendingForStudent = vi.fn().mockResolvedValue([]);
    const updateGenerationNotes = vi.fn();
    const requestRefresh = vi.fn();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const parentChanged = new StudentMemorySnapshotParentChangedError({
      studentId: 'student-1',
      expectedLatestReadySnapshotId: 'snapshot-ready-parent',
      actualLatestReadySnapshotId: 'snapshot-newer-parent',
    });

    await expect(
      processStudentMemorySnapshotJob({
        config: createTestConfig(),
        payload: {
          kind: 'student-memory-snapshot-refresh',
          studentId: 'student-1',
          pendingEntryId: 'snapshot-pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
          trigger: 'lesson-memory-ready',
          sourceEntryId: 'lesson-1',
        },
        attemptsMade: 0,
        maxAttempts: 5,
        overrides: {
          lessonMemory: {
            list: vi.fn(),
            getById: vi
              .fn()
              .mockResolvedValue(lessonMemoryEntry('lesson-1', '2026-03-20T00:00:00.000Z')),
            listRecentReadyByStudentId: vi.fn().mockResolvedValue([]),
          },
          homeworkMemory: {
            list: vi.fn(),
            getById: vi.fn(),
            listRecentReadyByStudentId: vi.fn().mockResolvedValue([]),
          },
          snapshots: {
            getById: vi.fn().mockResolvedValue({
              id: 'snapshot-pending-1',
              status: 'pending',
              generatedAt: new Date('2026-03-20T01:00:00.000Z'),
              generationNotes: {
                trigger: 'lesson-memory-ready',
                sourceEntryId: 'lesson-1',
              },
            }),
            getLatestReadyByStudentId: vi.fn().mockResolvedValue(readySnapshot()),
            markFailed,
            supersedePendingForStudent,
            updateGenerationNotes,
          },
          profileCandidates: { requestRefresh },
          generator: vi.fn().mockRejectedValue(parentChanged),
          pacer: { run: vi.fn(async ({ execute }) => execute()) } as never,
        } as never,
      }),
    ).rejects.toBe(parentChanged);

    expect(markFailed).not.toHaveBeenCalled();
    expect(supersedePendingForStudent).not.toHaveBeenCalled();
    expect(updateGenerationNotes).not.toHaveBeenCalled();
    expect(requestRefresh).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Student-memory snapshot parent changed before ready finalization; retrying',
      expect.objectContaining({
        event: 'student_memory_snapshot_parent_changed_retry',
        studentId: 'student-1',
        pendingEntryId: 'snapshot-pending-1',
        expectedLatestReadySnapshotId: 'snapshot-ready-parent',
        actualLatestReadySnapshotId: 'snapshot-newer-parent',
      }),
    );
    warnSpy.mockRestore();
  });

  it('marks the pending snapshot failed with stale-parent diagnostics on final parent-changed attempt', async () => {
    const markFailed = vi.fn().mockResolvedValue(null);
    const parentChanged = new StudentMemorySnapshotParentChangedError({
      studentId: 'student-1',
      expectedLatestReadySnapshotId: 'snapshot-ready-parent',
      actualLatestReadySnapshotId: 'snapshot-newer-parent',
    });
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await expect(
      processStudentMemorySnapshotJob({
        config: createTestConfig(),
        payload: {
          kind: 'student-memory-snapshot-refresh',
          studentId: 'student-1',
          pendingEntryId: 'snapshot-pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
          trigger: 'lesson-memory-ready',
          sourceEntryId: 'lesson-1',
        },
        attemptsMade: 4,
        maxAttempts: 5,
        overrides: {
          lessonMemory: {
            list: vi.fn(),
            getById: vi
              .fn()
              .mockResolvedValue(lessonMemoryEntry('lesson-1', '2026-03-20T00:00:00.000Z')),
            listRecentReadyByStudentId: vi.fn().mockResolvedValue([]),
          },
          homeworkMemory: {
            list: vi.fn(),
            getById: vi.fn(),
            listRecentReadyByStudentId: vi.fn().mockResolvedValue([]),
          },
          snapshots: {
            getById: vi.fn().mockResolvedValue({
              id: 'snapshot-pending-1',
              status: 'pending',
              generatedAt: new Date('2026-03-20T01:00:00.000Z'),
              generationNotes: {
                trigger: 'lesson-memory-ready',
                sourceEntryId: 'lesson-1',
              },
            }),
            getLatestReadyByStudentId: vi.fn().mockResolvedValue(readySnapshot()),
            markFailed,
            supersedePendingForStudent: vi.fn().mockResolvedValue([]),
            updateGenerationNotes: vi.fn(),
          },
          profileCandidates: { requestRefresh: vi.fn() },
          generator: vi.fn().mockRejectedValue(parentChanged),
          pacer: { run: vi.fn(async ({ execute }) => execute()) } as never,
        } as never,
      }),
    ).rejects.toBe(parentChanged);

    expect(markFailed).toHaveBeenCalledWith({
      id: 'snapshot-pending-1',
      errorMessage: parentChanged.message,
      generationNotes: expect.objectContaining({
        parentSnapshotId: 'snapshot-ready-parent',
        failureDetails: {
          code: 'student_memory_snapshot_parent_changed_before_finalize',
          stage: 'snapshot_ready_finalization',
          message: parentChanged.message,
          expectedLatestReadySnapshotId: 'snapshot-ready-parent',
          actualLatestReadySnapshotId: 'snapshot-newer-parent',
        },
      }),
    });
    warnSpy.mockRestore();
  });

  it('retries source-changed finalization without side effects before the final attempt', async () => {
    const markFailed = vi.fn().mockResolvedValue(null);
    const supersedePendingForStudent = vi.fn();
    const updateGenerationNotes = vi.fn();
    const requestRefresh = vi.fn();
    const sourcesChanged = new StudentMemorySnapshotSourcesChangedError([
      'lesson-retired-during-generation',
    ]);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await expect(
      processStudentMemorySnapshotJob({
        config: createTestConfig(),
        payload: {
          kind: 'student-memory-snapshot-refresh',
          studentId: 'student-1',
          pendingEntryId: 'snapshot-pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
          trigger: 'lesson-memory-ready',
          sourceEntryId: 'lesson-1',
        },
        attemptsMade: 0,
        maxAttempts: 5,
        overrides: finalizationRaceOverrides({
          error: sourcesChanged,
          markFailed,
          supersedePendingForStudent,
          updateGenerationNotes,
          requestRefresh,
        }) as never,
      }),
    ).rejects.toBe(sourcesChanged);

    expect(markFailed).not.toHaveBeenCalled();
    expect(supersedePendingForStudent).not.toHaveBeenCalled();
    expect(updateGenerationNotes).not.toHaveBeenCalled();
    expect(requestRefresh).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Student-memory snapshot sources changed before ready finalization; retrying',
      {
        event: 'student_memory_snapshot_sources_changed_retry',
        studentId: 'student-1',
        pendingEntryId: 'snapshot-pending-1',
        unavailableLessonMemoryEntryIds: ['lesson-retired-during-generation'],
      },
    );
    warnSpy.mockRestore();
  });

  it('records typed source-change diagnostics on the final attempt', async () => {
    const markFailed = vi.fn().mockResolvedValue(null);
    const sourcesChanged = new StudentMemorySnapshotSourcesChangedError([
      'lesson-retired-during-generation',
    ]);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await expect(
      processStudentMemorySnapshotJob({
        config: createTestConfig(),
        payload: {
          kind: 'student-memory-snapshot-refresh',
          studentId: 'student-1',
          pendingEntryId: 'snapshot-pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
          trigger: 'lesson-memory-ready',
          sourceEntryId: 'lesson-1',
        },
        attemptsMade: 4,
        maxAttempts: 5,
        overrides: finalizationRaceOverrides({
          error: sourcesChanged,
          markFailed,
        }) as never,
      }),
    ).rejects.toBe(sourcesChanged);

    expect(markFailed).toHaveBeenCalledWith({
      id: 'snapshot-pending-1',
      errorMessage: sourcesChanged.message,
      generationNotes: expect.objectContaining({
        parentSnapshotId: 'snapshot-ready-parent',
        failureDetails: {
          code: 'student_memory_snapshot_sources_changed_before_finalize',
          stage: 'snapshot_ready_finalization',
          message: sourcesChanged.message,
          unavailableLessonMemoryEntryIds: ['lesson-retired-during-generation'],
        },
      }),
    });
    expect(warnSpy).not.toHaveBeenCalledWith(
      'Student-memory snapshot sources changed before ready finalization; retrying',
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it('rejects a lesson-memory trigger source that belongs to another student', async () => {
    const markFailed = vi.fn().mockResolvedValue(null);

    await expect(
      processStudentMemorySnapshotJob({
        config: createTestConfig(),
        payload: {
          kind: 'student-memory-snapshot-refresh',
          studentId: 'student-1',
          pendingEntryId: 'snapshot-pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
          trigger: 'lesson-memory-ready',
          sourceEntryId: 'lesson-foreign',
        },
        attemptsMade: 0,
        maxAttempts: 1,
        overrides: {
          lessonMemory: {
            list: vi.fn(),
            getById: vi.fn().mockResolvedValue({
              ...lessonMemoryEntry('lesson-foreign', '2026-03-20T00:00:00.000Z'),
              studentId: 'student-2',
            }),
            listRecentReadyByStudentId: vi.fn(),
          },
          homeworkMemory: {
            list: vi.fn(),
            getById: vi.fn(),
            listRecentReadyByStudentId: vi.fn(),
          },
          snapshots: {
            getById: vi.fn().mockResolvedValue({
              id: 'snapshot-pending-1',
              status: 'pending',
              generatedAt: new Date('2026-03-20T01:00:00.000Z'),
              generationNotes: null,
            }),
            getLatestReadyByStudentId: vi.fn().mockResolvedValue(readySnapshot()),
            markFailed,
            supersedePendingForStudent: vi.fn(),
          },
          profileCandidates: { requestRefresh: vi.fn() },
          generator: vi.fn(),
        } as never,
      }),
    ).rejects.toThrow('Lesson memory trigger source belongs to a different student');

    expect(markFailed).toHaveBeenCalledWith({
      id: 'snapshot-pending-1',
      errorMessage: 'Lesson memory trigger source belongs to a different student',
      generationNotes: undefined,
    });
  });

  it('rejects a homework-memory trigger source that belongs to another student', async () => {
    const markFailed = vi.fn().mockResolvedValue(null);

    await expect(
      processStudentMemorySnapshotJob({
        config: createTestConfig(),
        payload: {
          kind: 'student-memory-snapshot-refresh',
          studentId: 'student-1',
          pendingEntryId: 'snapshot-pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
          trigger: 'homework-memory-ready',
          sourceEntryId: 'homework-foreign',
        },
        attemptsMade: 0,
        maxAttempts: 1,
        overrides: {
          lessonMemory: {
            list: vi.fn(),
            getById: vi.fn(),
            listRecentReadyByStudentId: vi.fn(),
          },
          homeworkMemory: {
            list: vi.fn(),
            getById: vi.fn().mockResolvedValue({
              ...homeworkMemoryEntry('homework-foreign', '2026-03-20T00:00:00.000Z'),
              studentId: 'student-2',
            }),
            listRecentReadyByStudentId: vi.fn(),
          },
          snapshots: {
            getById: vi.fn().mockResolvedValue({
              id: 'snapshot-pending-1',
              status: 'pending',
              generatedAt: new Date('2026-03-20T01:00:00.000Z'),
              generationNotes: null,
            }),
            getLatestReadyByStudentId: vi.fn().mockResolvedValue(readySnapshot()),
            markFailed,
            supersedePendingForStudent: vi.fn(),
          },
          profileCandidates: { requestRefresh: vi.fn() },
          generator: vi.fn(),
        } as never,
      }),
    ).rejects.toThrow('Homework memory trigger source belongs to a different student');

    expect(markFailed).toHaveBeenCalledWith({
      id: 'snapshot-pending-1',
      errorMessage: 'Homework memory trigger source belongs to a different student',
      generationNotes: undefined,
    });
  });

  it('marks the pending snapshot row failed on the final attempt', async () => {
    const markFailed = vi.fn().mockResolvedValue(null);

    await expect(
      processStudentMemorySnapshotJob({
        config: createTestConfig(),
        payload: {
          kind: 'student-memory-snapshot-refresh',
          studentId: 'student-1',
          pendingEntryId: 'snapshot-pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
          trigger: 'manual-replay',
          sourceEntryId: null,
          strategy: 'manual_rebuild_v1_1',
          operatorReason: 'Backfill missing alpha snapshot',
        },
        attemptsMade: 0,
        maxAttempts: 1,
        overrides: {
          lessonMemory: {
            list: vi.fn().mockResolvedValue([
              {
                id: 'lesson-1',
                generatedAt: new Date('2026-03-20T00:00:00.000Z'),
                lessonSummary: 'Strong lesson',
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
            ]),
          },
          homeworkMemory: {
            list: vi.fn().mockResolvedValue([]),
          },
          snapshots: {
            getById: vi.fn().mockResolvedValue({
              id: 'snapshot-pending-1',
              status: 'pending',
              generatedAt: new Date('2026-03-20T01:00:00.000Z'),
              generationNotes: {
                trigger: 'manual-replay',
                strategy: 'manual_rebuild_v1_1',
                operatorReason: 'Backfill missing alpha snapshot',
              },
            }),
            markFailed,
            supersedePendingForStudent: vi.fn(),
          },
          profileCandidates: {
            requestRefresh: vi.fn().mockImplementation(async () => {}),
          },
          generator: vi.fn().mockRejectedValue(new Error('structured output failed')),
        } as never,
      }),
    ).rejects.toThrow('structured output failed');

    expect(markFailed).toHaveBeenCalledWith({
      id: 'snapshot-pending-1',
      errorMessage: 'structured output failed',
      generationNotes: expect.objectContaining({
        trigger: 'manual-replay',
        sourceEntryId: null,
        strategy: 'manual_rebuild_v1_1',
        operatorReason: 'Backfill missing alpha snapshot',
        triggerSourceKind: 'manual',
        triggerSourceEntryId: null,
        parentSnapshotId: null,
        includedLessonMemoryEntryIds: ['lesson-1'],
        includedHomeworkMemoryEntryIds: [],
        coveredLessonMemoryEntryIds: ['lesson-1'],
        coveredHomeworkMemoryEntryIds: [],
        includedLessonMemoryCount: 1,
        includedHomeworkMemoryCount: 0,
        coveredLessonMemoryCount: 1,
        coveredHomeworkMemoryCount: 0,
        materialChange: null,
      }),
    });
    const failedNotes = markFailed.mock.calls[0]?.[0].generationNotes;
    expect(failedNotes.promptByteLength).toBeGreaterThan(0);
    expect(failedNotes.inputTokenEstimate).toBeGreaterThan(0);
  });

  it('keeps a pending snapshot row pending when pacing defers the provider call', async () => {
    const markFailed = vi.fn();
    const deferred = new StudentMemoryPacingDeferredError({
      reason: 'budget_rpm_minute',
      provider: 'openai',
      model: 'gpt-5.4-mini',
      notBefore: new Date('2026-06-21T10:12:00.000Z'),
      estimatedTokens: 400,
    });
    const run = vi.fn().mockRejectedValue(deferred);

    await expect(
      processStudentMemorySnapshotJob({
        config: createTestConfig(),
        payload: {
          kind: 'student-memory-snapshot-refresh',
          studentId: 'student-1',
          pendingEntryId: 'snapshot-pending-1',
          provider: 'openai',
          model: 'gpt-5.4-mini',
          trigger: 'manual-replay',
          strategy: 'manual_rebuild_v1_1',
          operatorReason: 'Backfill missing alpha snapshot',
        },
        attemptsMade: 4,
        maxAttempts: 5,
        overrides: {
          lessonMemory: {
            list: vi.fn().mockResolvedValue([
              {
                id: 'lesson-1',
                generatedAt: new Date('2026-06-21T10:00:00.000Z'),
                lessonSummary: 'Summary',
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
            ]),
          },
          homeworkMemory: { list: vi.fn().mockResolvedValue([]) },
          snapshots: {
            getById: vi.fn().mockResolvedValue({
              id: 'snapshot-pending-1',
              status: 'pending',
              generatedAt: new Date('2026-06-21T10:00:00.000Z'),
              generationNotes: {
                strategy: 'manual_rebuild_v1_1',
                operatorReason: 'Backfill missing alpha snapshot',
              },
            }),
            markFailed,
            supersedePendingForStudent: vi.fn(),
          },
          profileCandidates: { requestRefresh: vi.fn() },
          generator: vi.fn(),
          pacer: { run } as never,
        } as never,
      }),
    ).rejects.toBe(deferred);

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        workload: 'student_memory_snapshot',
        provider: 'openai',
        model: 'gpt-5.4-mini',
      }),
    );
    expect(markFailed).not.toHaveBeenCalled();
  });
});
