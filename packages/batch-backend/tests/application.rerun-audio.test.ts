import { beforeEach, describe, expect, it, vi } from 'vitest';

import { rerunAudio } from '../src/application/job-actions/rerun-audio.js';
import * as jobEvents from '../src/domain/job-events.js';
import { JobActionType } from '../src/domain/job-actions.js';
import * as jobRepository from '../src/domain/job-repository.js';
import * as queueModule from '../src/infrastructure/queue-bullmq.js';

describe('application/job-actions/rerun-audio', () => {
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
      type: JobActionType.RERUN_AUDIO,
      requestedAt: new Date('2026-02-06T00:00:00.000Z'),
      payload,
    }) as const;

  it('returns not_found when source job is missing', async () => {
    getJobByIdSpy.mockResolvedValue(null);

    const result = await rerunAudio('job-missing', makeAction());

    expect(result).toMatchObject({
      success: false,
      jobId: 'job-missing',
      actionType: JobActionType.RERUN_AUDIO,
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

    const result = await rerunAudio('job-1', makeAction());

    expect(result).toMatchObject({
      success: false,
      jobId: 'job-1',
      actionType: JobActionType.RERUN_AUDIO,
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

    const result = await rerunAudio('job-1', makeAction());

    expect(result).toMatchObject({
      success: false,
      jobId: 'job-1',
      actionType: JobActionType.RERUN_AUDIO,
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

    const result = await rerunAudio('job-1', makeAction({ dialogueStability: 2 }));

    expect(result).toMatchObject({
      success: false,
      jobId: 'job-1',
      actionType: JobActionType.RERUN_AUDIO,
      error: 'validation_failed',
    });
    expect(insertJobSpy).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('defaults rerun audio to cache reuse when forceTts is omitted', async () => {
    getJobByIdSpy.mockResolvedValue({
      id: 'job-source',
      state: 'succeeded',
      md: '/tmp/lesson.md',
      preset: 'b1-default',
      voiceId: 'voice-old',
      voiceAccent: 'american',
      notionDatabase: 'db-1',
      publishTarget: 'notion',
      ttsStrategy: 'auto',
      userId: 'user-1',
      autoPublish: false,
    } as never);
    insertJobSpy.mockResolvedValue({
      id: 'job-rerun',
      state: 'queued',
    } as never);

    const result = await rerunAudio('job-source', makeAction());

    expect(insertJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        md: '/tmp/lesson.md',
        withTts: true,
        upload: 's3',
        forceTts: false,
      }),
    );
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-rerun',
        executionMode: 'rerun_audio',
        rerun: expect.objectContaining({
          manifestMd: '/tmp/lesson.md',
          force: false,
        }),
      }),
    );
    expect(result).toMatchObject({
      success: true,
      message: 'Audio rerun queued (cache reuse allowed)',
      jobId: 'job-rerun',
      actionType: JobActionType.RERUN_AUDIO,
    });
  });

  it('creates and enqueues a rerun job for succeeded source jobs', async () => {
    getJobByIdSpy.mockResolvedValue({
      id: 'job-source',
      state: 'succeeded',
      md: '/tmp/lesson.md',
      preset: 'b1-default',
      voiceId: 'voice-old',
      voiceAccent: 'american',
      notionDatabase: 'db-1',
      publishTarget: 'notion',
      ttsStrategy: 'auto',
      userId: 'user-1',
      autoPublish: false,
    } as never);
    insertJobSpy.mockResolvedValue({
      id: 'job-rerun',
      state: 'queued',
    } as never);

    const result = await rerunAudio(
      'job-source',
      makeAction({
        forceTts: true,
        voiceId: 'voice-new',
        voiceAccent: 'british',
        ttsStrategy: 'dialogue',
        dialogueLanguage: 'es',
        dialogueStability: 0.42,
        dialogueSeed: 7,
      }),
    );

    expect(insertJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        md: '/tmp/lesson.md',
        withTts: true,
        upload: 's3',
        forceTts: true,
        voiceId: 'voice-new',
        voiceAccent: 'british',
        ttsStrategy: 'dialogue',
        userId: 'user-1',
        sourceJobId: 'job-source',
      }),
    );
    expect(publishJobEventSpy).toHaveBeenCalledWith({
      type: 'job_created',
      job: expect.objectContaining({ id: 'job-rerun' }),
    });
    expect(enqueueSpy).toHaveBeenCalledWith({
      jobId: 'job-rerun',
      executionMode: 'rerun_audio',
      sourceJobId: 'job-source',
      rerun: {
        steps: ['tts', 'upload', 'add-audio'],
        manifestMd: '/tmp/lesson.md',
        upload: 's3',
        force: true,
        voiceId: 'voice-new',
        accentPreference: 'british',
        ttsStrategy: 'dialogue',
        dialogueLanguage: 'es',
        dialogueStability: 0.42,
        dialogueSeed: 7,
      },
    });
    expect(result).toMatchObject({
      success: true,
      jobId: 'job-rerun',
      actionType: JobActionType.RERUN_AUDIO,
    });
  });
});
