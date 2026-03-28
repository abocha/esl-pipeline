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
      executionMode: 'rerun',
      sourceJobId: 'job-source',
      rerun: {
        regenerateStudyTextAudio: true,
        regeneratePronunciationMainAudio: true,
        regeneratePronunciationChunkAudio: true,
        manifestMd: '/tmp/source-assignment.md',
        upload: 's3',
        studyTextVoiceId: 'voice-new',
        studyTextVoiceAccent: 'british',
        studyTextTtsStrategy: 'dialogue',
        studyTextDialogueLanguage: 'es',
        studyTextDialogueStability: 0.42,
        studyTextDialogueSeed: 7,
      },
    });

    expect(runAssignmentJobSpy).not.toHaveBeenCalled();
    expect(runRerunAssignmentJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        manifestMd: '/tmp/source-assignment.md',
        regenerateStudyTextAudio: true,
        regeneratePronunciationMainAudio: true,
        regeneratePronunciationChunkAudio: true,
        upload: 's3',
        studyTextVoiceId: 'voice-new',
        studyTextVoiceAccent: 'british',
        studyTextTtsStrategy: 'dialogue',
        studyTextDialogueLanguage: 'es',
        studyTextDialogueStability: 0.42,
        studyTextDialogueSeed: 7,
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
      executionMode: 'rerun',
      sourceJobId: 'job-source',
      rerun: {
        regenerateStudyTextAudio: true,
        manifestMd: '/tmp/source-assignment.md',
        upload: 's3',
      },
    });

    expect(runRerunAssignmentJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        manifestMd: '/tmp/source-assignment.md',
        regenerateStudyTextAudio: true,
        upload: 's3',
        republishOnly: false,
      }),
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(requestHomeworkMemoryGenerationSpy).not.toHaveBeenCalled();
  });

  it('processes republish-only rerun jobs via rerunAssignment execution path', async () => {
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
      executionMode: 'rerun',
      sourceJobId: 'job-source',
      rerun: {
        republishOnly: true,
        manifestMd: '/tmp/source-assignment.md',
        upload: 's3',
      },
    });

    expect(runAssignmentJobSpy).not.toHaveBeenCalled();
    expect(withTtsCacheActivitySharedLockSpy).not.toHaveBeenCalled();
    expect(runRerunAssignmentJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        manifestMd: '/tmp/source-assignment.md',
        republishOnly: true,
        upload: 's3',
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
