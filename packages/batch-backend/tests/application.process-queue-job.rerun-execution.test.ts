import { describe, expect, it } from 'vitest';

import { processQueueJob } from '../src/application/process-queue-job.js';
import * as h from './application.process-queue-job.test-harness.js';

const {
  makeJob,
  getJobByIdSpy,
  updateJobStateAndResultSpy,
  runAssignmentJobSpy,
  runRerunAssignmentJobSpy,
  requestHomeworkMemoryGenerationSpy,
  withTtsCacheActivitySharedLockSpy,
} = h;

describe('application/process-queue-job', () => {
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
        manifestMd: '/tmp/source-assignment.md',
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
        manifestMd: '/tmp/source-assignment.md',
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
    expect(requestHomeworkMemoryGenerationSpy).not.toHaveBeenCalled();
  });

  it('defaults rerun force=false when payload and job force settings are omitted', async () => {
    const initial = makeJob({ state: 'queued', forceTts: null });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({
      state: 'running',
      forceTts: null,
      startedAt: new Date('2024-01-01T10:01:00Z'),
    });
    const succeeded = {
      ...running,
      state: 'succeeded',
      manifestPath: '/manifests/job-rerun-default-force.json',
      finishedAt: new Date('2024-01-01T10:02:00Z'),
      notionUrl: 'https://notion.so/job-rerun-default-force',
      anytypeUrl: null,
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(succeeded as any);

    runRerunAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-rerun-default-force.json',
      notionUrl: 'https://notion.so/job-rerun-default-force',
    });

    await processQueueJob({
      jobId: 'job-1',
      executionMode: 'rerun_audio',
      sourceJobId: 'job-source',
      rerun: {
        steps: ['tts', 'upload', 'add-audio'],
        manifestMd: '/tmp/source-assignment.md',
        upload: 's3',
      },
    });

    expect(runRerunAssignmentJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        manifestMd: '/tmp/source-assignment.md',
        steps: ['tts', 'upload', 'add-audio'],
        upload: 's3',
        force: false,
      }),
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(requestHomeworkMemoryGenerationSpy).not.toHaveBeenCalled();
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
        manifestMd: '/tmp/source-assignment.md',
        upload: 's3',
        force: false,
      },
    });

    expect(runAssignmentJobSpy).not.toHaveBeenCalled();
    expect(withTtsCacheActivitySharedLockSpy).not.toHaveBeenCalled();
    expect(runRerunAssignmentJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        manifestMd: '/tmp/source-assignment.md',
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

  it('skips shared cache-activity lock when queued job does not request TTS', async () => {
    const initial = makeJob({ state: 'queued', withTts: false });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({
      state: 'running',
      withTts: false,
      startedAt: new Date('2024-01-01T10:01:00Z'),
    });
    const succeeded = {
      ...running,
      state: 'succeeded',
      manifestPath: '/manifests/job-no-tts.json',
      finishedAt: new Date('2024-01-01T10:02:00Z'),
      notionUrl: 'https://notion.so/job-no-tts',
      anytypeUrl: null,
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(succeeded as any);

    runAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-no-tts.json',
      notionUrl: 'https://notion.so/job-no-tts',
    });

    await processQueueJob({ jobId: 'job-1' });

    expect(runAssignmentJobSpy).toHaveBeenCalledTimes(1);
    expect(withTtsCacheActivitySharedLockSpy).not.toHaveBeenCalled();
  });
});
