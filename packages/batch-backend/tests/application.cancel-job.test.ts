import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelJob } from '../src/application/job-actions/cancel-job.js';
import * as jobEvents from '../src/domain/job-events.js';
import { JobActionType } from '../src/domain/job-actions.js';
import * as jobRepository from '../src/domain/job-repository.js';
import * as queueModule from '../src/infrastructure/queue-bullmq.js';

describe('application/job-actions/cancel-job', () => {
  const getJobByIdSpy = vi.spyOn(jobRepository, 'getJobById');
  const updateJobStateAndResultSpy = vi.spyOn(jobRepository, 'updateJobStateAndResult');
  const publishJobEventSpy = vi.spyOn(jobEvents, 'publishJobEvent');
  const createJobQueueSpy = vi.spyOn(queueModule, 'createJobQueue');
  const cancelQueuedJobSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    cancelQueuedJobSpy.mockReset();
    cancelQueuedJobSpy.mockResolvedValue('removed');
    createJobQueueSpy.mockReturnValue({
      queue: {} as never,
      queueEvents: {} as never,
      enqueue: vi.fn(),
      cancelQueuedJob: cancelQueuedJobSpy,
    });
  });

  const makeAction = (payload: Record<string, unknown> = {}) =>
    ({
      type: JobActionType.CANCEL,
      requestedAt: new Date('2026-02-06T00:00:00.000Z'),
      payload,
    }) as const;

  it('returns not_found when job is missing', async () => {
    getJobByIdSpy.mockResolvedValue(null);

    const result = await cancelJob('job-missing', makeAction());

    expect(result).toMatchObject({
      success: false,
      actionType: JobActionType.CANCEL,
      error: 'not_found',
    });
    expect(updateJobStateAndResultSpy).not.toHaveBeenCalled();
    expect(cancelQueuedJobSpy).not.toHaveBeenCalled();
  });

  it('returns validation_failed when reason is empty', async () => {
    getJobByIdSpy.mockResolvedValue({
      id: 'job-1',
      state: 'queued',
    } as never);

    const result = await cancelJob('job-1', makeAction({ reason: '   ' }));

    expect(result).toMatchObject({
      success: false,
      actionType: JobActionType.CANCEL,
      error: 'validation_failed',
    });
    expect(updateJobStateAndResultSpy).not.toHaveBeenCalled();
  });

  it('returns invalid_state when job is not queued or running', async () => {
    getJobByIdSpy.mockResolvedValue({
      id: 'job-1',
      state: 'succeeded',
    } as never);

    const result = await cancelJob('job-1', makeAction());

    expect(result).toMatchObject({
      success: false,
      actionType: JobActionType.CANCEL,
      error: 'invalid_state',
    });
    expect(updateJobStateAndResultSpy).not.toHaveBeenCalled();
  });

  it('cancels queued jobs, updates state, emits event, and removes queue entry', async () => {
    getJobByIdSpy.mockResolvedValue({
      id: 'job-1',
      state: 'queued',
    } as never);
    const cancelledJob = {
      id: 'job-1',
      state: 'failed',
      error: 'cancelled: duplicate run',
    };
    updateJobStateAndResultSpy.mockResolvedValue(cancelledJob as never);

    const result = await cancelJob('job-1', makeAction({ reason: 'duplicate run' }));

    expect(updateJobStateAndResultSpy).toHaveBeenCalledWith({
      id: 'job-1',
      expectedState: 'queued',
      nextState: 'failed',
      error: 'cancelled: duplicate run',
      finishedAt: expect.any(Date),
    });
    expect(publishJobEventSpy).toHaveBeenCalledWith({
      type: 'job_state_changed',
      job: cancelledJob,
    });
    expect(cancelQueuedJobSpy).toHaveBeenCalledWith('job-1');
    expect(result).toMatchObject({
      success: true,
      actionType: JobActionType.CANCEL,
      message: 'Job cancelled',
      jobId: 'job-1',
    });
  });

  it('cancels running jobs without queue removal (best-effort)', async () => {
    getJobByIdSpy.mockResolvedValue({
      id: 'job-1',
      state: 'running',
    } as never);
    updateJobStateAndResultSpy.mockResolvedValue({
      id: 'job-1',
      state: 'failed',
      error: 'cancelled',
    } as never);

    const result = await cancelJob('job-1', makeAction());

    expect(updateJobStateAndResultSpy).toHaveBeenCalledWith({
      id: 'job-1',
      expectedState: 'running',
      nextState: 'failed',
      error: 'cancelled',
      finishedAt: expect.any(Date),
    });
    expect(cancelQueuedJobSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      actionType: JobActionType.CANCEL,
    });
    expect(result.message).toContain('best-effort');
  });

  it('returns invalid_state if update fails due to a race', async () => {
    getJobByIdSpy
      .mockResolvedValueOnce({
        id: 'job-1',
        state: 'queued',
      } as never)
      .mockResolvedValueOnce({
        id: 'job-1',
        state: 'running',
      } as never);
    updateJobStateAndResultSpy.mockResolvedValue(null);

    const result = await cancelJob('job-1', makeAction());

    expect(result).toMatchObject({
      success: false,
      actionType: JobActionType.CANCEL,
      error: 'invalid_state',
    });
  });
});
