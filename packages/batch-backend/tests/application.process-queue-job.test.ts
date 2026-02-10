import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { processQueueJob } from '../src/application/process-queue-job.js';
import * as jobEvents from '../src/domain/job-events.js';
import * as jobRepository from '../src/domain/job-repository.js';
import * as settingsRepository from '../src/domain/settings-repository.js';
import * as loggerModule from '../src/infrastructure/logger.js';
import * as orchestratorService from '../src/infrastructure/orchestrator-service.js';
import * as transcriptionStorage from '../src/infrastructure/transcription-storage.js';

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
  const runRerunAssignmentJobSpy = vi.spyOn(orchestratorService, 'runRerunAssignmentJob');
  const publishJobEventSpy = vi.spyOn(jobEvents, 'publishJobEvent');
  const getSettingsByUserIdSpy = vi.spyOn(settingsRepository, 'getSettingsByUserId');
  const getDecryptedElevenLabsKeySpy = vi.spyOn(settingsRepository, 'getDecryptedElevenLabsKey');
  const getDecryptedNotionTokenSpy = vi.spyOn(settingsRepository, 'getDecryptedNotionToken');
  const createTranscriptionStorageForUriSpy = vi.spyOn(
    transcriptionStorage,
    'createTranscriptionStorageForUri',
  );

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
      mdStorageUri: null,
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
      voiceId: 'voice_amanda',
      voiceAccent: 'american_female',
      forceTts: false,
      notionDatabase: 'db-123',
      publishTarget: 'notion',
      ttsStrategy: 'auto',
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
    expect(payload.md.replaceAll('\\', '/').endsWith(initial.md)).toBe(true);
    expect(typeof runId).toBe('string');
    expect(runId.length).toBeGreaterThan(0);

    expect(updateJobStateAndResultSpy).toHaveBeenNthCalledWith(2, {
      id: 'job-1',
      expectedState: 'running',
      nextState: 'succeeded',
      manifestPath: '/manifests/job-1.json',
      notionUrl: 'https://notion.so/job-1',
      anytypeUrl: null,
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
    getJobByIdSpy
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({
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
      finishedAt: expect.any(Date),
    });
    expect(publishJobEventSpy).toHaveBeenCalledTimes(1);
  });

  it('suppresses retry throw when failure update loses race to cancel', async () => {
    const initial = makeJob({ state: 'queued' });
    getJobByIdSpy
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({
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

  it('processes rerun jobs via rerunAssignment execution path', async () => {
    const initial = makeJob({ state: 'queued' });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({ state: 'running', startedAt: new Date('2024-01-01T10:01:00Z') });
    const succeeded = {
      ...running,
      state: 'succeeded',
      manifestPath: '/manifests/job-rerun.json',
      finishedAt: new Date('2024-01-01T10:02:00Z'),
      notionUrl: 'https://notion.so/job-rerun',
      anytypeUrl: null,
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(succeeded as any);

    runRerunAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-rerun.json',
      notionUrl: 'https://notion.so/job-rerun',
    });

    await processQueueJob({
      jobId: 'job-1',
      executionMode: 'rerun_audio',
      sourceJobId: 'job-source',
      rerun: {
        steps: ['tts', 'upload', 'add-audio'],
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

    expect(runAssignmentJobSpy).not.toHaveBeenCalled();
    expect(runRerunAssignmentJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        steps: ['tts', 'upload', 'add-audio'],
        upload: 's3',
        force: true,
        voiceId: 'voice-new',
        accentPreference: 'british',
        ttsStrategy: 'dialogue',
        dialogueLanguage: 'es',
        dialogueStability: 0.42,
        dialogueSeed: 7,
      }),
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('processes rerun_publish jobs via rerunAssignment execution path', async () => {
    const initial = makeJob({ state: 'queued' });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({ state: 'running', startedAt: new Date('2024-01-01T10:01:00Z') });
    const succeeded = {
      ...running,
      state: 'succeeded',
      manifestPath: '/manifests/job-rerun-publish.json',
      finishedAt: new Date('2024-01-01T10:02:00Z'),
      notionUrl: null,
      anytypeUrl: 'https://anytype.io/page',
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(succeeded as any);

    runRerunAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-rerun-publish.json',
      anytypeUrl: 'https://anytype.io/page',
    });

    await processQueueJob({
      jobId: 'job-1',
      executionMode: 'rerun_publish',
      sourceJobId: 'job-source',
      rerun: {
        steps: ['add-audio'],
        upload: 's3',
        force: false,
      },
    });

    expect(runAssignmentJobSpy).not.toHaveBeenCalled();
    expect(runRerunAssignmentJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        steps: ['add-audio'],
        upload: 's3',
        force: false,
      }),
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('materializes markdown from storage URI when md path is missing', async () => {
    const initial = makeJob({
      state: 'queued',
      md: null,
      mdStorageUri: 's3://esl-notion-tts/drafts/draft-1.md',
    });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({
      state: 'running',
      md: null,
      mdStorageUri: 's3://esl-notion-tts/drafts/draft-1.md',
    });
    const succeeded = {
      ...running,
      state: 'succeeded',
      manifestPath: '/manifests/job-1.json',
      finishedAt: new Date('2024-01-01T10:02:00Z'),
      notionUrl: 'https://notion.so/job-1',
      anytypeUrl: null,
    };
    updateJobStateAndResultSpy.mockResolvedValueOnce(running as any).mockResolvedValueOnce(
      succeeded as any,
    );

    createTranscriptionStorageForUriSpy.mockReturnValue({
      getText: vi.fn().mockResolvedValue('# Draft from S3'),
    } as unknown as ReturnType<typeof transcriptionStorage.createTranscriptionStorageForUri>);

    runAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-1.json',
      notionUrl: 'https://notion.so/job-1',
    });

    await processQueueJob({ jobId: 'job-1' });

    expect(runAssignmentJobSpy).toHaveBeenCalledTimes(1);
    const [payload] = runAssignmentJobSpy.mock.calls[0]!;
    expect(path.isAbsolute(payload.md)).toBe(true);

    await expect(fs.access(payload.md)).rejects.toThrow();
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
