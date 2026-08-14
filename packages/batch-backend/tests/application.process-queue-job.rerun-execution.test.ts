import { describe, expect, it } from 'vitest';

import { processQueueJob } from '../src/application/process-queue-job.js';
import * as h from './application.process-queue-job.test-harness.js';

const {
  makeJob,
  getJobByIdSpy,
  resetFailedAssignmentCorrectionJobSpy,
  updateJobStateAndResultSpy,
  runAssignmentJobSpy,
  runRerunAssignmentJobSpy,
  requestHomeworkMemoryGenerationSpy,
  withTtsCacheActivitySharedLockSpy,
} = h;

describe('application/process-queue-job', () => {
  it('re-enters a failed correction child on its automatic BullMQ retry', async () => {
    const failed = makeJob({
      state: 'failed',
      sourceJobId: 'job-published-parent',
      mdStorageUri: null,
    });
    const running = makeJob({ ...failed, state: 'running', startedAt: new Date() });
    const succeeded = makeJob({ ...running, state: 'succeeded', finishedAt: new Date() });
    getJobByIdSpy.mockResolvedValueOnce(failed);
    resetFailedAssignmentCorrectionJobSpy.mockResolvedValue({
      ...failed,
      state: 'queued',
      error: null,
      startedAt: null,
      finishedAt: null,
    });
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as never)
      .mockResolvedValueOnce(succeeded as never);
    runAssignmentJobSpy.mockResolvedValue({ manifestPath: '/manifests/job-correction.json' });

    await processQueueJob({
      jobId: failed.id,
      sourceJobId: failed.sourceJobId!,
      executionMode: 'correction',
      correction: {
        expectedMarkdownHash: 'a'.repeat(64),
        manifestMd: `corrections/${failed.id}.md`,
      },
    });

    expect(resetFailedAssignmentCorrectionJobSpy).toHaveBeenCalledWith({
      jobId: failed.id,
      sourceJobId: failed.sourceJobId,
      expectedMarkdownHash: 'a'.repeat(64),
    });
    expect(runAssignmentJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: failed.id }),
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(runRerunAssignmentJobSpy).not.toHaveBeenCalled();
  });

  it('processes correction children through the normal new-assignment path', async () => {
    const initial = makeJob({
      state: 'queued',
      sourceJobId: 'job-published-parent',
      studentId: 'student-1',
    });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({
      state: 'running',
      sourceJobId: 'job-published-parent',
      studentId: 'student-1',
      startedAt: new Date('2024-01-01T10:01:00Z'),
    });
    const succeeded = {
      ...running,
      state: 'succeeded',
      manifestPath: '/manifests/job-correction.json',
      finishedAt: new Date('2024-01-01T10:02:00Z'),
      htmlUrl: 'https://example.com/job-correction',
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(succeeded as any);
    runAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-correction.json',
      htmlUrl: 'https://example.com/job-correction',
    });

    await processQueueJob({
      jobId: 'job-1',
      sourceJobId: 'job-published-parent',
      executionMode: 'correction',
      correction: {
        expectedMarkdownHash: 'a'.repeat(64),
        manifestMd: 'corrections/job-1.md',
      },
    });

    expect(runRerunAssignmentJobSpy).not.toHaveBeenCalled();
    expect(runAssignmentJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1' }),
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(requestHomeworkMemoryGenerationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          jobId: 'job-1',
          publishKind: 'correction',
        }),
      }),
    );
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
      htmlUrl: 'https://example.com/job-rerun',
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(succeeded as any);

    runRerunAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-rerun.json',
      htmlUrl: 'https://example.com/job-rerun',
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
      htmlUrl: 'https://example.com/job-rerun-default-force',
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(succeeded as any);

    runRerunAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-rerun-default-force.json',
      htmlUrl: 'https://example.com/job-rerun-default-force',
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
      htmlUrl: 'https://example.com/job-rerun-publish',
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(succeeded as any);

    runRerunAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-rerun-publish.json',
      htmlUrl: 'https://example.com/job-rerun-publish',
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

  it('defaults pronunciation rerun voice settings to the persisted job voice preferences when the provider stays compatible', async () => {
    const initial = makeJob({
      state: 'queued',
      voiceId: 'voice_job_default',
      voiceAccent: 'british',
    });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({
      state: 'running',
      voiceId: 'voice_job_default',
      voiceAccent: 'british',
      startedAt: new Date('2024-01-01T10:01:00Z'),
    });
    const succeeded = {
      ...running,
      state: 'succeeded',
      manifestPath: '/manifests/job-rerun-pronunciation-voice-defaults.json',
      finishedAt: new Date('2024-01-01T10:02:00Z'),
      htmlUrl: 'https://example.com/job-rerun-pronunciation-voice-defaults',
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(succeeded as any);

    runRerunAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-rerun-pronunciation-voice-defaults.json',
      htmlUrl: 'https://example.com/job-rerun-pronunciation-voice-defaults',
    });

    await processQueueJob({
      jobId: 'job-1',
      executionMode: 'rerun',
      sourceJobId: 'job-source',
      rerun: {
        regeneratePronunciationChunkAudio: true,
        manifestMd: '/tmp/source-assignment.md',
        upload: 's3',
        pronunciationChunkTtsProvider: 'elevenlabs',
        pronunciationChunkTtsModel: 'eleven_multilingual_v2',
      },
    });

    expect(runRerunAssignmentJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        regeneratePronunciationChunkAudio: true,
        pronunciationMainVoiceId: 'voice_job_default',
        pronunciationMainVoiceAccent: 'british',
        pronunciationChunkVoiceId: 'voice_job_default',
        pronunciationChunkVoiceAccent: 'british',
        pronunciationChunkTtsProvider: 'elevenlabs',
        pronunciationChunkTtsModel: 'eleven_multilingual_v2',
      }),
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('does not inherit provider-specific pronunciation voice ids when the rerun provider changes', async () => {
    const initial = makeJob({
      state: 'queued',
      ttsProvider: 'elevenlabs',
      voiceId: 'pNInz6obpgDQGcFmaJgB',
      voiceAccent: 'american',
    });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({
      state: 'running',
      ttsProvider: 'elevenlabs',
      voiceId: 'pNInz6obpgDQGcFmaJgB',
      voiceAccent: 'american',
      startedAt: new Date('2024-01-01T10:01:00Z'),
    });
    const succeeded = {
      ...running,
      state: 'succeeded',
      manifestPath: '/manifests/job-rerun-provider-switch.json',
      finishedAt: new Date('2024-01-01T10:02:00Z'),
      htmlUrl: 'https://example.com/job-rerun-provider-switch',
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(succeeded as any);

    runRerunAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-rerun-provider-switch.json',
      htmlUrl: 'https://example.com/job-rerun-provider-switch',
    });

    await processQueueJob({
      jobId: 'job-1',
      executionMode: 'rerun',
      sourceJobId: 'job-source',
      rerun: {
        regeneratePronunciationChunkAudio: true,
        manifestMd: '/tmp/source-assignment.md',
        upload: 's3',
        pronunciationChunkTtsProvider: 'google',
        pronunciationChunkTtsModel: 'chirp3_hd',
      },
    });

    expect(runRerunAssignmentJobSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        regeneratePronunciationChunkAudio: true,
        pronunciationChunkTtsProvider: 'google',
        pronunciationChunkTtsModel: 'chirp3_hd',
        pronunciationChunkVoiceAccent: 'american',
        pronunciationChunkVoiceId: undefined,
      }),
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('defaults study-text rerun model settings to the persisted job values when the payload omits them', async () => {
    const initial = makeJob({
      state: 'queued',
      ttsProvider: 'elevenlabs',
      ttsStrategy: 'dialogue',
      ttsModel: 'eleven_v3',
    });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({
      state: 'running',
      ttsProvider: 'elevenlabs',
      ttsStrategy: 'dialogue',
      ttsModel: 'eleven_v3',
      startedAt: new Date('2024-01-01T10:01:00Z'),
    });
    const succeeded = {
      ...running,
      state: 'succeeded',
      manifestPath: '/manifests/job-rerun-study-text-defaults.json',
      finishedAt: new Date('2024-01-01T10:02:00Z'),
      htmlUrl: 'https://example.com/job-rerun-study-text-defaults',
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(succeeded as any);

    runRerunAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-rerun-study-text-defaults.json',
      htmlUrl: 'https://example.com/job-rerun-study-text-defaults',
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
        regenerateStudyTextAudio: true,
        studyTextTtsProvider: 'elevenlabs',
        studyTextTtsStrategy: 'dialogue',
        studyTextTtsModel: 'eleven_v3',
      }),
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('fails loudly when a rerun descendant job loses rerun queue metadata', async () => {
    const initial = makeJob({ state: 'queued', sourceJobId: 'job-source' });
    getJobByIdSpy.mockResolvedValue(initial);

    const running = makeJob({
      state: 'running',
      sourceJobId: 'job-source',
      startedAt: new Date('2024-01-01T10:01:00Z'),
    });
    const failed = {
      ...running,
      state: 'failed',
      error:
        'Corrupted rerun queue payload: rerun jobs must include executionMode="rerun" and rerun metadata.',
      finishedAt: new Date('2024-01-01T10:02:00Z'),
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(failed as any);

    await expect(processQueueJob({ jobId: 'job-1' })).rejects.toThrow(
      'Corrupted rerun queue payload: rerun jobs must include executionMode="rerun" and rerun metadata.',
    );

    expect(runAssignmentJobSpy).not.toHaveBeenCalled();
    expect(runRerunAssignmentJobSpy).not.toHaveBeenCalled();
    expect(updateJobStateAndResultSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'job-1',
        expectedState: 'running',
        nextState: 'failed',
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
      htmlUrl: 'https://example.com/job-no-tts',
    };
    updateJobStateAndResultSpy
      .mockResolvedValueOnce(running as any)
      .mockResolvedValueOnce(succeeded as any);

    runAssignmentJobSpy.mockResolvedValue({
      manifestPath: '/manifests/job-no-tts.json',
      htmlUrl: 'https://example.com/job-no-tts',
    });

    await processQueueJob({ jobId: 'job-1' });

    expect(runAssignmentJobSpy).toHaveBeenCalledTimes(1);
    expect(withTtsCacheActivitySharedLockSpy).not.toHaveBeenCalled();
  });
});
