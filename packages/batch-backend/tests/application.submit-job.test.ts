import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We import from compiled paths relative to this test file.
// Vitest in this monorepo typically runs from package root,
// so we resolve via ../src/...
import { submitJob } from '../src/application/submit-job.js';
import * as jobEvents from '../src/domain/job-events.js';
import * as jobRepository from '../src/domain/job-repository.js';
import * as loggerModule from '../src/infrastructure/logger.js';
import * as queueBullmq from '../src/infrastructure/queue-bullmq.js';

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
      voiceId: null,
      voiceAccent: null,
      forceTts: null,
      ttsStrategy: null,
      htmlUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      startedAt: null,
      finishedAt: null,
      error: null,
      manifestPath: null,
    };

    insertJobSpy.mockResolvedValue(fakeJob as any);

    const enqueue = vi.fn().mockResolvedValue(void 0);
    createJobQueueSpy.mockReturnValue({
      queue: {} as any,
      queueEvents: {} as any,
      enqueue,
      reconcile: vi.fn(),
      cancelQueuedJob: vi.fn(),
    });

    const request: Parameters<typeof submitJob>[0] = { md: fakeJob.md };

    const result = await submitJob(request);

    expect(insertJobSpy).toHaveBeenCalledTimes(1);
    expect(insertJobSpy).toHaveBeenCalledWith({
      md: request.md,
      learningPresetId: null,
      learningPresetVersion: null,
      promptSnapshotVersion: null,
      promptAlias: null,
      withTts: request.withTts,
      upload: request.upload,
      voiceId: request.voiceId,
      voiceAccent: request.voiceAccent,
      forceTts: request.forceTts,
      publishTarget: 'html',
      ttsStrategy: request.ttsStrategy,
      ttsProvider: request.ttsProvider,
      ttsModel: request.ttsModel,
      autoPublish: undefined,
      userId: request.userId,
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
      voiceId: 'voice_amanda',
      voiceAccent: 'american_female',
      forceTts: true,
      ttsStrategy: 'dialogue',
      htmlUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    insertJobSpy.mockResolvedValue(fakeJob as any);

    const enqueue = vi.fn().mockResolvedValue(void 0);
    createJobQueueSpy.mockReturnValue({
      queue: {} as any,
      queueEvents: {} as any,
      enqueue,
      reconcile: vi.fn(),
      cancelQueuedJob: vi.fn(),
    });

    await submitJob({
      md: fakeJob.md,
      learningPresetId: 'general-english',
      withTts: fakeJob.withTts!,
      upload: fakeJob.upload as 's3',
      voiceId: fakeJob.voiceId,
      voiceAccent: fakeJob.voiceAccent,
      forceTts: fakeJob.forceTts,
      ttsStrategy: fakeJob.ttsStrategy as 'dialogue',
    });

    expect(insertJobSpy).toHaveBeenCalledWith({
      md: fakeJob.md,
      learningPresetId: 'general-english',
      learningPresetVersion: 'v2',
      promptSnapshotVersion: 'hw_prompt_definitive',
      promptAlias: 'current',
      withTts: fakeJob.withTts,
      upload: fakeJob.upload,
      voiceId: fakeJob.voiceId,
      voiceAccent: fakeJob.voiceAccent,
      forceTts: fakeJob.forceTts,
      ttsProvider: undefined,
      ttsModel: undefined,
      publishTarget: 'html',
      ttsStrategy: fakeJob.ttsStrategy,
      autoPublish: undefined,
      userId: undefined,
    });
    expect(enqueue).toHaveBeenCalledWith({ jobId: fakeJob.id });
  });

  it('accepts learningPresetId directly and persists provenance', async () => {
    const fakeJob = {
      id: 'job-789',
      state: 'queued',
      md: 'fixtures/ok.md',
      preset: undefined,
      withTts: false,
      upload: null,
      voiceId: null,
      voiceAccent: null,
      forceTts: null,
      ttsStrategy: null,
      htmlUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    insertJobSpy.mockResolvedValue(fakeJob as any);

    const enqueue = vi.fn().mockResolvedValue(void 0);
    createJobQueueSpy.mockReturnValue({
      queue: {} as any,
      queueEvents: {} as any,
      enqueue,
      reconcile: vi.fn(),
      cancelQueuedJob: vi.fn(),
    });

    await submitJob({
      md: fakeJob.md,
      learningPresetId: 'general-english',
    });

    expect(insertJobSpy).toHaveBeenCalledWith({
      md: fakeJob.md,
      learningPresetId: 'general-english',
      learningPresetVersion: 'v2',
      promptSnapshotVersion: 'hw_prompt_definitive',
      promptAlias: 'current',
      withTts: undefined,
      upload: undefined,
      voiceId: undefined,
      voiceAccent: undefined,
      forceTts: undefined,
      ttsProvider: undefined,
      ttsModel: undefined,
      publishTarget: 'html',
      ttsStrategy: undefined,
      autoPublish: undefined,
      userId: undefined,
    });
  });

  it('rejects when md is missing or not a string', async () => {
    insertJobSpy.mockResolvedValue(null as any);

    const enqueue = vi.fn().mockResolvedValue(void 0);
    createJobQueueSpy.mockReturnValue({
      queue: {} as any,
      queueEvents: {} as any,
      enqueue,
      reconcile: vi.fn(),
      cancelQueuedJob: vi.fn(),
    });

    await expect(submitJob({} as any)).rejects.toThrow('md is required');
    await expect(submitJob({ md: '' as any })).rejects.toThrow('md is required');
    await expect(submitJob({ md: 42 as any })).rejects.toThrow('md is required');

    expect(insertJobSpy).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(publishJobEventSpy).not.toHaveBeenCalled();
  });

  it('rejects invalid publish-side elevenlabs model combinations', async () => {
    const enqueue = vi.fn().mockResolvedValue(void 0);
    createJobQueueSpy.mockReturnValue({
      queue: {} as any,
      queueEvents: {} as any,
      enqueue,
      reconcile: vi.fn(),
      cancelQueuedJob: vi.fn(),
    });

    await expect(
      submitJob({
        md: 'fixtures/ok.md',
        ttsProvider: 'elevenlabs',
        ttsStrategy: 'auto',
        ttsModel: 'eleven_v3',
      }),
    ).rejects.toThrow(
      'Automatic ElevenLabs publish jobs must use strategy-default model selection.',
    );

    await expect(
      submitJob({
        md: 'fixtures/ok.md',
        ttsProvider: 'google',
        ttsModel: 'eleven_v3',
      }),
    ).rejects.toThrow('TTS model "eleven_v3" is not supported by provider "google".');

    expect(insertJobSpy).not.toHaveBeenCalled();
  });

  it('accepts inworld provider and model selections', async () => {
    const fakeJob = {
      id: 'job-inworld',
      state: 'queued',
      md: 'fixtures/ok.md',
      preset: null,
      withTts: true,
      upload: null,
      voiceId: null,
      voiceAccent: null,
      forceTts: null,
      ttsStrategy: 'tts',
      htmlUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    insertJobSpy.mockResolvedValue(fakeJob as any);
    createJobQueueSpy.mockReturnValue({
      queue: {} as any,
      queueEvents: {} as any,
      enqueue: vi.fn().mockResolvedValue(void 0),
      reconcile: vi.fn(),
      cancelQueuedJob: vi.fn(),
    });

    await submitJob({
      md: fakeJob.md,
      withTts: true,
      ttsProvider: 'inworld',
      ttsStrategy: 'tts',
      ttsModel: 'inworld-tts-1.5-max',
    });

    expect(insertJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ttsProvider: 'inworld',
        ttsModel: 'inworld-tts-1.5-max',
      }),
    );
  });

  it('rejects retired non-html publish targets', async () => {
    const enqueue = vi.fn().mockResolvedValue(void 0);
    createJobQueueSpy.mockReturnValue({
      queue: {} as any,
      queueEvents: {} as any,
      enqueue,
      reconcile: vi.fn(),
      cancelQueuedJob: vi.fn(),
    });

    await expect(
      submitJob({
        md: 'fixtures/ok.md',
        publishTarget: 'notion' as any,
      }),
    ).rejects.toThrow('publishTarget must be "html" when provided');

    await expect(
      submitJob({
        md: 'fixtures/ok.md',
        publishTarget: 'anytype' as any,
      }),
    ).rejects.toThrow('publishTarget must be "html" when provided');

    expect(insertJobSpy).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
