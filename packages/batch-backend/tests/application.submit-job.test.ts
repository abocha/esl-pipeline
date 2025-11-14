import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We import from compiled paths relative to this test file.
// Vitest in this monorepo typically runs from package root,
// so we resolve via ../src/...
import { submitJob } from '../src/application/submit-job';
import * as jobRepository from '../src/domain/job-repository';
import * as queueBullmq from '../src/infrastructure/queue-bullmq';
import * as loggerModule from '../src/infrastructure/logger';
import * as jobEvents from '../src/domain/job-events';

vi.mock('../src/infrastructure/logger', async () => {
  const actual = await vi.importActual<typeof loggerModule>('../src/infrastructure/logger');
  return {
    ...actual,
    logger: {
      ...('logger' in actual ? (actual as any).logger : {}),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
  };
});

describe('application/submit-job', () => {
  /**
   * Intent:
   * - Validate that submitJob enforces minimal input validation,
   *   persists a queued Job via JobRepository, enqueues it exactly once,
   *   and returns the public jobId shape used by HTTP.
   * - Defends against regressions where jobs are not enqueued, are enqueued with wrong payloads,
   *   or invalid input slips through and later breaks workers.
   */

  const insertJobSpy = vi.spyOn(jobRepository, 'insertJob');
  const createJobQueueSpy = vi.spyOn(queueBullmq, 'createJobQueue');
  const publishJobEventSpy = vi.spyOn(jobEvents, 'publishJobEvent');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('submits a valid job: inserts and enqueues, returns jobId', async () => {
    const fakeJob = {
      id: 'job-123',
      state: 'queued',
      md: 'fixtures/ok.md',
      preset: null,
      withTts: false,
      upload: null,
      voiceAccent: null,
      forceTts: null,
      notionDatabase: null,
      mode: null,
      notionUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      startedAt: null,
      finishedAt: null,
      error: null,
      manifestPath: null,
    };

    insertJobSpy.mockResolvedValue(fakeJob as any);

    const enqueue = vi.fn().mockResolvedValue(undefined);
    createJobQueueSpy.mockReturnValue({
      queue: {} as any,
      queueEvents: {} as any,
      enqueue,
    });

    const result = await submitJob({ md: fakeJob.md });

    expect(insertJobSpy).toHaveBeenCalledTimes(1);
    expect(insertJobSpy).toHaveBeenCalledWith({
      md: fakeJob.md,
      preset: undefined,
      withTts: undefined,
      upload: undefined,
      voiceAccent: undefined,
      forceTts: undefined,
      notionDatabase: undefined,
      mode: undefined,
    });

    expect(createJobQueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({ jobId: fakeJob.id });

    expect(publishJobEventSpy).toHaveBeenCalledTimes(1);
    expect(publishJobEventSpy).toHaveBeenCalledWith({
      type: 'job_created',
      job: fakeJob,
    });

    expect(result).toEqual({ jobId: fakeJob.id });
  });

  it('passes through optional parameters to insertJob', async () => {
    const fakeJob = {
      id: 'job-456',
      state: 'queued',
      md: 'fixtures/ok.md',
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
      voiceAccent: 'american_female',
      forceTts: true,
      notionDatabase: 'db-123',
      mode: 'dialogue',
      notionUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    insertJobSpy.mockResolvedValue(fakeJob as any);

    const enqueue = vi.fn().mockResolvedValue(undefined);
    createJobQueueSpy.mockReturnValue({
      queue: {} as any,
      queueEvents: {} as any,
      enqueue,
    });

    await submitJob({
      md: fakeJob.md,
      preset: fakeJob.preset!,
      withTts: fakeJob.withTts!,
      upload: fakeJob.upload as 's3',
      voiceAccent: fakeJob.voiceAccent,
      forceTts: fakeJob.forceTts,
      notionDatabase: fakeJob.notionDatabase,
      mode: fakeJob.mode as 'dialogue',
    });

    expect(insertJobSpy).toHaveBeenCalledWith({
      md: fakeJob.md,
      preset: fakeJob.preset,
      withTts: fakeJob.withTts,
      upload: fakeJob.upload,
      voiceAccent: fakeJob.voiceAccent,
      forceTts: fakeJob.forceTts,
      notionDatabase: fakeJob.notionDatabase,
      mode: fakeJob.mode,
    });
    expect(enqueue).toHaveBeenCalledWith({ jobId: fakeJob.id });
  });

  it('rejects when md is missing or not a string', async () => {
    insertJobSpy.mockResolvedValue(null as any);

    const enqueue = vi.fn().mockResolvedValue(undefined);
    createJobQueueSpy.mockReturnValue({
      queue: {} as any,
      queueEvents: {} as any,
      enqueue,
    });

    await expect(submitJob({} as any)).rejects.toThrow('md is required');
    await expect(submitJob({ md: '' as any })).rejects.toThrow('md is required');
    await expect(submitJob({ md: 42 as any })).rejects.toThrow('md is required');

    expect(insertJobSpy).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(publishJobEventSpy).not.toHaveBeenCalled();
  });
});
