import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processQueueJob } from '../src/application/process-queue-job.js';
import * as jobEvents from '../src/domain/job-events.js';
import * as jobRepository from '../src/domain/job-repository.js';
import * as settingsRepository from '../src/domain/settings-repository.js';
import * as loggerModule from '../src/infrastructure/logger.js';
import * as orchestratorService from '../src/infrastructure/orchestrator-service.js';

vi.mock('../src/infrastructure/logger', async () => {
  const actual = await vi.importActual<typeof loggerModule>('../src/infrastructure/logger');
  return {
    ...actual,
    createJobLogger: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

describe('application/process-queue-job', () => {
  /**
   * Intent:
   * - Validate guarded job processing semantics:
   *   - Only process when job exists and is non-terminal.
   *   - Respect optimistic-state update queued -> running.
   *   - Integrate with orchestrator via runAssignmentJob.
   *   - Map orchestrator success/failure into succeeded/failed states.
   * - Protects against races, double-processing, and lost failures.
   */

  const getJobByIdSpy = vi.spyOn(jobRepository, 'getJobById');
  const updateJobStateAndResultSpy = vi.spyOn(jobRepository, 'updateJobStateAndResult');
  const runAssignmentJobSpy = vi.spyOn(orchestratorService, 'runAssignmentJob');
  const publishJobEventSpy = vi.spyOn(jobEvents, 'publishJobEvent');
  const getSettingsByUserIdSpy = vi.spyOn(settingsRepository, 'getSettingsByUserId');
  const getDecryptedElevenLabsKeySpy = vi.spyOn(settingsRepository, 'getDecryptedElevenLabsKey');
  const getDecryptedNotionTokenSpy = vi.spyOn(settingsRepository, 'getDecryptedNotionToken');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeJob(
    overrides: Partial<
      ReturnType<(typeof jobRepository)['getJobById']> extends Promise<infer R>
        ? NonNullable<R>
        : never
    > = {},
  ): any {
    const now = new Date('2024-01-01T10:00:00Z');
    return {
      id: 'job-1',
      state: 'queued',
      md: path.resolve(import.meta.dirname, '../../../fixtures/ok.md'),
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
      voiceId: 'voice_amanda',
      voiceAccent: 'american_female',
      forceTts: false,
      notionDatabase: 'db-123',
      mode: 'auto',
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      error: null,
      manifestPath: null,
      ...overrides,
    } as any;
  }

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
      mode: initial.mode,
    });
    expect(path.isAbsolute(payload.md)).toBe(true);
    expect(payload.md.replaceAll('\\', '/').endsWith(initial.md)).toBe(true);
    expect(typeof runId).toBe('string');
    expect(runId.length).toBeGreaterThan(0);

    expect(updateJobStateAndResultSpy).toHaveBeenNthCalledWith(2, {
      id: 'job-1',
      expectedState: 'running',
      nextState: 'succeeded',
      manifestPath: '/manifests/job-1.json',
      notionUrl: 'https://notion.so/job-1',
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
  it('injects user settings when job is linked to a user', async () => {
    const initial = makeJob({ state: 'queued', userId: 'user-123' });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({
      state: 'running',
      userId: 'user-123',
      startedAt: new Date('2024-01-01T10:01:00Z'),
    });
    const succeeded = {
      ...running,
      state: 'succeeded',
      manifestPath: '/manifests/job-1.json',
      finishedAt: new Date('2024-01-01T10:02:00Z'),
    };

    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(succeeded as any);

    runAssignmentJobSpy.mockResolvedValue({ manifestPath: '/manifests/job-1.json' });

    // Mock settings repository
    getSettingsByUserIdSpy.mockResolvedValue({ id: 'settings-1', userId: 'user-123' } as any);
    getDecryptedElevenLabsKeySpy.mockResolvedValue('user-eleven-key');
    getDecryptedNotionTokenSpy.mockResolvedValue('user-notion-token');

    await processQueueJob({ jobId: 'job-1' });

    expect(getSettingsByUserIdSpy).toHaveBeenCalledWith('user-123');
    expect(getDecryptedElevenLabsKeySpy).toHaveBeenCalledWith('user-123');
    expect(getDecryptedNotionTokenSpy).toHaveBeenCalledWith('user-123');

    expect(runAssignmentJobSpy).toHaveBeenCalledTimes(1);
    const [payload] = runAssignmentJobSpy.mock.calls[0]!;
    expect(payload.settings).toEqual({
      elevenLabsApiKey: 'user-eleven-key',
      notionToken: 'user-notion-token',
    });
  });
});
