import { describe, expect, it, vi } from 'vitest';

import { shareAssignmentSession } from '../src/application/share-assignment-session.js';
import type { AssignmentSessionRecord } from '../src/domain/assignment-session-model.js';
import type { JobRecord } from '../src/domain/job-model.js';

const request = {
  expectedRevision: 4,
  requestId: '11111111-1111-4111-8111-111111111111',
};

function createSession(): AssignmentSessionRecord {
  return {
    id: 'session-1',
    userId: 'user-1',
    studentId: 'student-1',
    lessonId: 'lesson-1',
    recordingId: 'recording-1',
    transcriptId: 'transcript-1',
    promptPackageId: 'prompt-1',
    draftId: 'draft-1',
    revision: 4,
    confirmedStep: 'create',
    confirmed: {
      student: { studentId: 'student-1' },
      source: {
        lessonId: 'lesson-1',
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        transcriptWorkingVersion: 1,
        transcriptStorageUri: 'local://confirmed/transcript.txt',
        transcriptHash: 'a'.repeat(64),
      },
      context: {
        teacherNotes: null,
        profileId: null,
        profileRevisionId: null,
        profileRevisionHash: null,
      },
      create: {
        promptPackageId: 'prompt-1',
        draftId: 'draft-1',
        draftWorkingVersion: 1,
        draftStorageUri: 'local://confirmed/draft.md',
        draftHash: 'b'.repeat(64),
      },
    },
    creationRequestId: null,
    publishTarget: 'html' as const,
    selectedTtsProvider: null,
    selectedTtsStrategy: null,
    selectedTtsModel: null,
    selectedPreset: null,
    selectedGenerationProvider: null,
    selectedGenerationModel: null,
    teacherNotes: null,
    selectedProfileId: null,
    selectedProfileRevisionId: null,
    selectedProfileRevisionHash: null,
    shareJobId: null as string | null,
    createdAt: new Date('2026-07-19T00:00:00Z'),
    updatedAt: new Date('2026-07-19T00:01:00Z'),
  };
}

function createJob(): JobRecord {
  return {
    id: request.requestId,
    studentId: 'student-1',
    state: 'awaiting_approval',
    md: null,
    mdStorageUri: 'local://confirmed/draft.md',
    recordingId: 'recording-1',
    transcriptId: 'transcript-1',
    promptPackageId: 'prompt-1',
    draftId: 'draft-1',
    lessonId: 'lesson-1',
    sourceJobId: null,
    userId: 'user-1',
    createdAt: new Date('2026-07-19T00:00:00Z'),
    updatedAt: new Date('2026-07-19T00:00:00Z'),
  };
}

function createHarness(stopAfter?: string) {
  const session = createSession();
  let job = createJob();
  let interrupted = false;
  const createdJobIds: string[] = [];
  const enqueuedJobIds = new Set<string>();
  const reserveShare = vi.fn(async () => {
    const created = !session.shareJobId;
    if (created) {
      session.shareJobId = job.id;
      session.revision += 1;
      createdJobIds.push(job.id);
    }
    return { session: { ...session }, job: { ...job }, created } as never;
  });
  const completeShare = vi.fn(async () => {
    if (session.confirmedStep !== 'share') {
      session.confirmedStep = 'share';
      session.revision += 1;
    }
    return { ...session } as never;
  });
  const materialize = vi.fn(async () => ({
    draftId: 'draft-1',
    jobId: job.id,
    mdPath: null,
    mdStorageUri: 'local://confirmed/draft.md',
  }));
  const approve = vi.fn(async () => {
    if (job.state !== 'awaiting_approval') return null;
    job = { ...job, state: 'queued' };
    return { ...job } as never;
  });
  const reconcile = vi.fn(async ({ jobId }: { jobId: string }) => {
    enqueuedJobIds.add(jobId);
  });
  const checkpoint = vi.fn(async (point: string) => {
    if (!interrupted && point === stopAfter) {
      interrupted = true;
      throw new Error('simulated interruption');
    }
  });
  const overrides = {
    sessions: {
      getByIdForUser: async () => ({ ...session }) as never,
      reserveShare,
      completeShare,
    },
    jobs: {
      getById: async () => ({ ...job }) as never,
      approve,
      resetFailedShare: vi.fn(async () => {
        job = { ...job, state: 'queued' };
        return { ...job } as never;
      }),
    },
    queue: { reconcile },
    resolveJobConfig: vi.fn(async () => ({ publishTarget: 'html' as const })),
    materialize,
    publishEvent: vi.fn(),
    checkpoint,
  };
  return {
    firstAttempt: () =>
      shareAssignmentSession({
        userId: 'user-1',
        sessionId: 'session-1',
        request,
        overrides: overrides as never,
      }),
    retrySameRequest: () =>
      shareAssignmentSession({
        userId: 'user-1',
        sessionId: 'session-1',
        request,
        overrides: overrides as never,
      }),
    createdJobIds,
    enqueuedJobIds,
    materialize,
    setFailed: () => {
      job = { ...job, state: 'failed' };
      session.shareJobId = job.id;
    },
    resetFailedShare: overrides.jobs.resetFailedShare,
  };
}

describe('application/share-assignment-session', () => {
  it.each(['reservation', 'materialization', 'approval', 'enqueue', 'confirmation'])(
    'resumes after interruption at %s with one stable job',
    async (stopAfter) => {
      const harness = createHarness(stopAfter);
      await expect(harness.firstAttempt()).rejects.toThrow('simulated interruption');

      const recovered = await harness.retrySameRequest();

      expect(recovered.session.confirmedStep).toBe('share');
      expect(recovered.session.shareJobId).toBe(request.requestId);
      expect(harness.createdJobIds).toEqual([request.requestId]);
      expect([...harness.enqueuedJobIds]).toEqual([request.requestId]);
      expect(harness.materialize).toHaveBeenCalledWith({
        draftId: 'draft-1',
        jobId: request.requestId,
        sourceStorageUri: 'local://confirmed/draft.md',
        expectedContentHash: 'b'.repeat(64),
      });
    },
  );

  it('resets and re-enqueues a failed linked job under the same identity', async () => {
    const harness = createHarness();
    harness.setFailed();

    const result = await harness.retrySameRequest();

    expect(harness.resetFailedShare).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userId: 'user-1',
      jobId: request.requestId,
    });
    expect([...harness.enqueuedJobIds]).toEqual([request.requestId]);
    expect(result.job.jobId).toBe(request.requestId);
  });
});
