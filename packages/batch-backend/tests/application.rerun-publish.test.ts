import { beforeEach, describe, expect, it, vi } from 'vitest';

import { rerunPublish } from '../src/application/job-actions/rerun-publish.js';
import * as jobEvents from '../src/domain/job-events.js';
import { JobActionType } from '../src/domain/job-actions.js';
import * as jobRepository from '../src/domain/job-repository.js';
import * as queueModule from '../src/infrastructure/queue-bullmq.js';

describe('application/job-actions/rerun-publish', () => {
  const getJobByIdSpy = vi.spyOn(jobRepository, 'getJobById');
  const insertJobSpy = vi.spyOn(jobRepository, 'insertJob');
  const publishJobEventSpy = vi.spyOn(jobEvents, 'publishJobEvent');
  const createJobQueueSpy = vi.spyOn(queueModule, 'createJobQueue');
  const enqueueSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    enqueueSpy.mockReset();
    enqueueSpy.mockImplementation(async () => {});
    createJobQueueSpy.mockReturnValue({
      queue: {} as never,
      queueEvents: {} as never,
      enqueue: enqueueSpy,
      cancelQueuedJob: vi.fn(async (_jobId: string) => 'not_found' as const),
    });
  });

  const makeAction = (payload: Record<string, unknown> = {}) =>
    ({
      type: JobActionType.RERUN_PUBLISH,
      requestedAt: new Date('2026-02-06T00:00:00.000Z'),
      payload,
    }) as const;

  it('returns not_found when source job is missing', async () => {
    getJobByIdSpy.mockResolvedValue(null);

    const result = await rerunPublish('job-missing', makeAction());

    expect(result).toMatchObject({
      success: false,
      jobId: 'job-missing',
      actionType: JobActionType.RERUN_PUBLISH,
      error: 'not_found',
    });
    expect(insertJobSpy).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('returns invalid_state when source job is not succeeded', async () => {
    getJobByIdSpy.mockResolvedValue({
      id: 'job-1',
      state: 'failed',
      md: '/tmp/lesson.md',
    } as never);

    const result = await rerunPublish('job-1', makeAction());

    expect(result).toMatchObject({
      success: false,
      jobId: 'job-1',
      actionType: JobActionType.RERUN_PUBLISH,
      error: 'invalid_state',
    });
    expect(insertJobSpy).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('returns validation_failed when source job has no markdown path', async () => {
    getJobByIdSpy.mockResolvedValue({
      id: 'job-1',
      state: 'succeeded',
      md: null,
    } as never);

    const result = await rerunPublish('job-1', makeAction());

    expect(result).toMatchObject({
      success: false,
      jobId: 'job-1',
      actionType: JobActionType.RERUN_PUBLISH,
      error: 'validation_failed',
    });
    expect(insertJobSpy).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('returns validation_failed when payload is invalid', async () => {
    getJobByIdSpy.mockResolvedValue({
      id: 'job-1',
      state: 'succeeded',
      md: '/tmp/lesson.md',
    } as never);

    const result = await rerunPublish('job-1', makeAction({ upload: 'none' }));

    expect(result).toMatchObject({
      success: false,
      jobId: 'job-1',
      actionType: JobActionType.RERUN_PUBLISH,
      error: 'validation_failed',
    });
    expect(insertJobSpy).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('creates and enqueues a publish rerun job for succeeded source jobs', async () => {
    getJobByIdSpy.mockResolvedValue({
      id: 'job-source',
      state: 'succeeded',
      md: '/tmp/lesson.md',
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
      voiceId: 'voice-old',
      voiceAccent: 'american',
      notionDatabase: 'db-1',
      publishTarget: 'anytype',
      ttsStrategy: 'auto',
      userId: 'user-1',
      autoPublish: false,
    } as never);
    insertJobSpy.mockResolvedValue({
      id: 'job-rerun-publish',
      state: 'queued',
    } as never);

    const result = await rerunPublish('job-source', makeAction());

    expect(insertJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        md: '/tmp/lesson.md',
        withTts: true,
        upload: 's3',
        forceTts: false,
        voiceId: 'voice-old',
        voiceAccent: 'american',
        publishTarget: 'anytype',
        sourceJobId: 'job-source',
      }),
    );
    expect(publishJobEventSpy).toHaveBeenCalledWith({
      type: 'job_created',
      job: expect.objectContaining({ id: 'job-rerun-publish' }),
    });
    expect(enqueueSpy).toHaveBeenCalledWith({
      jobId: 'job-rerun-publish',
      executionMode: 'rerun_publish',
      sourceJobId: 'job-source',
      rerun: {
        steps: ['add-audio'],
        upload: 's3',
        force: false,
        voiceId: 'voice-old',
        accentPreference: 'american',
        ttsStrategy: 'auto',
      },
    });
    expect(result).toMatchObject({
      success: true,
      jobId: 'job-rerun-publish',
      actionType: JobActionType.RERUN_PUBLISH,
    });
  });
});
