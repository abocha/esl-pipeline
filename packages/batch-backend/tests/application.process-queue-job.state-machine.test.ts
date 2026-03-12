import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { processQueueJob } from '../src/application/process-queue-job.js';
import * as h from './application.process-queue-job.test-harness.js';

const {
  makeJob,
  getJobByIdSpy,
  updateJobStateAndResultSpy,
  runAssignmentJobSpy,
  publishJobEventSpy,
  withTtsCacheActivitySharedLockSpy,
} = h;

describe('application/process-queue-job', () => {
  it('no-ops when job is missing', async () => {
    getJobByIdSpy.mockResolvedValue(null);

    await processQueueJob({ jobId: 'missing' });

    expect(getJobByIdSpy).toHaveBeenCalledWith('missing');
    expect(updateJobStateAndResultSpy).not.toHaveBeenCalled();
    expect(runAssignmentJobSpy).not.toHaveBeenCalled();
    expect(publishJobEventSpy).not.toHaveBeenCalled();
  });

  it('skips processing if job is already terminal', async () => {
    getJobByIdSpy.mockResolvedValue(makeJob({ state: 'succeeded' }));

    await processQueueJob({ jobId: 'job-1' });

    expect(updateJobStateAndResultSpy).not.toHaveBeenCalled();
    expect(runAssignmentJobSpy).not.toHaveBeenCalled();
    expect(publishJobEventSpy).not.toHaveBeenCalled();
  });

  it('processes queued job: queued -> running -> succeeded on orchestrator success', async () => {
    const initial = makeJob({ state: 'queued' });
    getJobByIdSpy.mockResolvedValue(initial);

    // First optimistic update: queued -> running
    const running = makeJob({ state: 'running', startedAt: new Date('2024-01-01T10:01:00Z') });
    const succeeded = {
      ...running,
      state: 'succeeded',
      manifestPath: '/manifests/job-1.json',
      finishedAt: new Date('2024-01-01T10:02:00Z'),
      notionUrl: 'https://notion.so/job-1',
      anytypeUrl: null,
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any) // queued -> running
      .mockResolvedValueOnce(succeeded as any); // running -> succeeded

    runAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-1.json',
      notionUrl: 'https://notion.so/job-1',
    });

    await processQueueJob({ jobId: 'job-1' });

    expect(getJobByIdSpy).toHaveBeenCalledWith('job-1');

    expect(updateJobStateAndResultSpy).toHaveBeenNthCalledWith(1, {
      id: 'job-1',
      expectedState: 'queued',
      nextState: 'running',
      startedAt: expect.any(Date),
    });

    expect(runAssignmentJobSpy).toHaveBeenCalledTimes(1);
    const callArgs = runAssignmentJobSpy.mock.calls[0];
    expect(callArgs).toBeDefined();
    const [payload, runId] = callArgs!;
    expect(payload).toMatchObject({
      jobId: 'job-1',
      preset: initial.preset!,
      withTts: initial.withTts!,
      upload: 's3',
      forceTts: initial.forceTts,
      notionDatabase: initial.notionDatabase,
      publishTarget: initial.publishTarget,
      ttsStrategy: initial.ttsStrategy,
    });
    expect(path.isAbsolute(payload.md)).toBe(true);
    if (initial.md == null) {
      throw new Error('expected fixture job md path');
    }
    expect(payload.md.replaceAll('\\', '/').endsWith(initial.md)).toBe(true);
    expect(typeof runId).toBe('string');
    expect(runId.length).toBeGreaterThan(0);
    expect(withTtsCacheActivitySharedLockSpy).toHaveBeenCalledTimes(1);
    expect(withTtsCacheActivitySharedLockSpy).toHaveBeenCalledWith(
      expect.objectContaining({ lockKey: expect.any(String) }),
      expect.any(Function),
    );

    expect(updateJobStateAndResultSpy).toHaveBeenNthCalledWith(2, {
      id: 'job-1',
      expectedState: 'running',
      nextState: 'succeeded',
      manifestPath: '/manifests/job-1.json',
      notionUrl: 'https://notion.so/job-1',
      anytypeUrl: null,
      htmlUrl: null,
      finishedAt: expect.any(Date),
    });

    expect(publishJobEventSpy).toHaveBeenCalledTimes(2);
    expect(publishJobEventSpy).toHaveBeenNthCalledWith(1, {
      type: 'job_state_changed',
      job: running,
    });
    expect(publishJobEventSpy).toHaveBeenNthCalledWith(2, {
      type: 'job_state_changed',
      job: succeeded,
    });
  });

  it('does not process when queued -> running optimistic update fails (state race)', async () => {
    const initial = makeJob({ state: 'queued' });
    getJobByIdSpy.mockResolvedValue(initial);

    // Simulate no row updated due to concurrent worker or manual change.
    updateJobStateAndResultSpy.mockResolvedValueOnce(null);

    await processQueueJob({ jobId: 'job-1' });

    expect(updateJobStateAndResultSpy).toHaveBeenCalledWith({
      id: 'job-1',
      expectedState: 'queued',
      nextState: 'running',
      startedAt: expect.any(Date),
    });

    expect(runAssignmentJobSpy).not.toHaveBeenCalled();
    expect(publishJobEventSpy).not.toHaveBeenCalled();
  });

  it('marks job failed and rethrows when orchestrator fails', async () => {
    const initial = makeJob({ state: 'queued' });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({ state: 'running' });
    const failed = { ...running, state: 'failed', error: 'orchestrator boom' };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any) // queued -> running
      .mockResolvedValueOnce(failed as any); // running -> failed

    const err = new Error('orchestrator boom');
    runAssignmentJobSpy.mockRejectedValue(err);

    await expect(processQueueJob({ jobId: 'job-1' })).rejects.toBe(err);

    expect(runAssignmentJobSpy).toHaveBeenCalledTimes(1);

    expect(updateJobStateAndResultSpy).toHaveBeenNthCalledWith(2, {
      id: 'job-1',
      expectedState: 'running',
      nextState: 'failed',
      error: 'orchestrator boom',
      finishedAt: expect.any(Date),
    });

    expect(publishJobEventSpy).toHaveBeenCalledTimes(2);
    expect(publishJobEventSpy).toHaveBeenNthCalledWith(1, {
      type: 'job_state_changed',
      job: running,
    });
    expect(publishJobEventSpy).toHaveBeenNthCalledWith(2, {
      type: 'job_state_changed',
      job: failed,
    });
  });

  it('does not overwrite cancelled jobs with succeeded on state race', async () => {
    const initial = makeJob({ state: 'queued' });
    getJobByIdSpy.mockResolvedValueOnce(initial).mockResolvedValueOnce({
      ...initial,
      state: 'failed',
      error: 'cancelled: user requested stop',
    } as any);

    const running = makeJob({ state: 'running', startedAt: new Date('2024-01-01T10:01:00Z') });
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any) // queued -> running
      .mockResolvedValueOnce(null); // running -> succeeded (lost race to cancel)

    runAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-1.json',
      notionUrl: 'https://notion.so/job-1',
    });

    await expect(processQueueJob({ jobId: 'job-1' })).resolves.toBeUndefined();

    expect(runAssignmentJobSpy).toHaveBeenCalledTimes(1);
    expect(updateJobStateAndResultSpy).toHaveBeenNthCalledWith(2, {
      id: 'job-1',
      expectedState: 'running',
      nextState: 'succeeded',
      manifestPath: '/manifests/job-1.json',
      notionUrl: 'https://notion.so/job-1',
      anytypeUrl: null,
      htmlUrl: null,
      finishedAt: expect.any(Date),
    });
    expect(publishJobEventSpy).toHaveBeenCalledTimes(1);
  });

  it('suppresses retry throw when failure update loses race to cancel', async () => {
    const initial = makeJob({ state: 'queued' });
    getJobByIdSpy.mockResolvedValueOnce(initial).mockResolvedValueOnce({
      ...initial,
      state: 'failed',
      error: 'cancelled',
    } as any);

    const running = makeJob({ state: 'running' });
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any) // queued -> running
      .mockResolvedValueOnce(null); // running -> failed (lost race)

    runAssignmentJobSpy.mockRejectedValue(new Error('orchestrator boom'));

    await expect(processQueueJob({ jobId: 'job-1' })).resolves.toBeUndefined();

    expect(updateJobStateAndResultSpy).toHaveBeenNthCalledWith(2, {
      id: 'job-1',
      expectedState: 'running',
      nextState: 'failed',
      error: 'orchestrator boom',
      finishedAt: expect.any(Date),
    });
    expect(publishJobEventSpy).toHaveBeenCalledTimes(1);
  });
});
