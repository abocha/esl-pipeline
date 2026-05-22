import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { manifestPathFor } from '@esl-pipeline/orchestrator';

import { JobActionType } from '../src/domain/job-actions.js';

vi.mock('../src/domain/job-repository.js', () => ({
  getJobById: vi.fn(),
  insertJob: vi.fn(),
}));

vi.mock('../src/infrastructure/queue-bullmq.js', () => ({
  createJobQueue: vi.fn(() => ({
    enqueue: vi.fn().mockImplementation(async () => {}),
  })),
}));

vi.mock('../src/domain/job-events.js', () => ({
  publishJobEvent: vi.fn(),
}));

import { rerun } from '../src/application/job-actions/rerun.js';
import { getJobById, insertJob } from '../src/domain/job-repository.js';
import { createJobQueue } from '../src/infrastructure/queue-bullmq.js';

describe('application/job-actions/rerun', () => {
  const requestedAt = new Date('2026-03-28T00:00:00.000Z');
  let jobDir: string;
  let jobMdPath: string;
  let durableManifestPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    jobDir = await mkdtemp(path.join(tmpdir(), 'batch-backend-rerun-job-'));
    jobMdPath = path.join(jobDir, 'job.md');
    durableManifestPath = manifestPathFor(jobMdPath);
    await writeFile(
      durableManifestPath,
      JSON.stringify({
        schemaVersion: 3,
        mdHash: 'existing-hash',
        publishTarget: 'html',
        audioArtifacts: {
          studyText: { url: 'https://example.com/study.mp3' },
        },
        timestamp: '2026-03-28T00:00:00.000Z',
      }),
      'utf8',
    );
    vi.mocked(getJobById).mockResolvedValue({
      id: 'job-1',
      state: 'succeeded',
      md: jobMdPath,
      mdStorageUri: 's3://drafts/job.md',
      withTts: true,
      ttsProvider: 'elevenlabs',
      ttsStrategy: 'auto',
      voiceId: 'voice-1',
      voiceAccent: 'american',
      googleTtsModel: 'chirp3_hd',
      publishTarget: 'html',
      htmlUrl: 'https://example.com/published.html',
      userId: 'user-1',
    } as never);
    vi.mocked(insertJob).mockResolvedValue({ id: 'job-rerun' } as never);
  });

  afterEach(async () => {
    await rm(jobDir, { recursive: true, force: true });
  });

  it('rejects eleven_v3 for pronunciation synthesis reruns', async () => {
    const result = await rerun('job-1', {
      type: JobActionType.RERUN,
      requestedAt,
      payload: {
        regeneratePronunciationMainAudio: true,
        pronunciationMainTtsProvider: 'elevenlabs',
        pronunciationMainElevenlabsModel: 'eleven_v3',
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('validation_failed');
    expect(vi.mocked(insertJob)).not.toHaveBeenCalled();
  });

  it('rejects explicit elevenlabs study-text models when strategy is auto', async () => {
    const result = await rerun('job-1', {
      type: JobActionType.RERUN,
      requestedAt,
      payload: {
        regenerateStudyTextAudio: true,
        studyTextTtsProvider: 'elevenlabs',
        studyTextTtsStrategy: 'auto',
        studyTextElevenlabsModel: 'eleven_multilingual_v2',
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('validation_failed');
    expect(vi.mocked(insertJob)).not.toHaveBeenCalled();
  });

  it('accepts eleven_v3 for explicit dialogue study-text reruns', async () => {
    const result = await rerun('job-1', {
      type: JobActionType.RERUN,
      requestedAt,
      payload: {
        regenerateStudyTextAudio: true,
        studyTextTtsProvider: 'elevenlabs',
        studyTextTtsStrategy: 'dialogue',
        studyTextElevenlabsModel: 'eleven_v3',
      },
    });

    expect(result.success).toBe(true);
    expect(vi.mocked(insertJob)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(insertJob)).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceId: 'voice-1',
        voiceAccent: 'american',
        ttsProvider: 'elevenlabs',
        ttsStrategy: 'dialogue',
        studyTextElevenlabsModel: 'eleven_v3',
        googleTtsModel: undefined,
      }),
    );
  });

  it('rejects inherited dialogue strategy when the explicit study-text model is not eleven_v3', async () => {
    vi.mocked(getJobById).mockResolvedValue({
      id: 'job-1',
      state: 'succeeded',
      md: '/tmp/job.md',
      mdStorageUri: 's3://drafts/job.md',
      withTts: true,
      ttsProvider: 'elevenlabs',
      ttsStrategy: 'dialogue',
      voiceId: 'voice-1',
      voiceAccent: 'american',
      googleTtsModel: 'chirp3_hd',
      publishTarget: 'html',
      userId: 'user-1',
    } as never);

    const result = await rerun('job-1', {
      type: JobActionType.RERUN,
      requestedAt,
      payload: {
        regenerateStudyTextAudio: true,
        studyTextElevenlabsModel: 'eleven_multilingual_v2',
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('validation_failed');
    expect(vi.mocked(insertJob)).not.toHaveBeenCalled();
  });

  it('rejects inherited auto strategy when an explicit study-text elevenlabs model is provided', async () => {
    vi.mocked(getJobById).mockResolvedValue({
      id: 'job-1',
      state: 'succeeded',
      md: '/tmp/job.md',
      mdStorageUri: 's3://drafts/job.md',
      withTts: true,
      ttsProvider: 'elevenlabs',
      ttsStrategy: 'auto',
      voiceId: 'voice-1',
      voiceAccent: 'american',
      googleTtsModel: 'chirp3_hd',
      publishTarget: 'html',
      userId: 'user-1',
    } as never);

    const result = await rerun('job-1', {
      type: JobActionType.RERUN,
      requestedAt,
      payload: {
        regenerateStudyTextAudio: true,
        studyTextElevenlabsModel: 'eleven_flash_v2_5',
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('validation_failed');
    expect(vi.mocked(insertJob)).not.toHaveBeenCalled();
  });

  it('preserves study-text job settings for pronunciation chunk-only reruns', async () => {
    const result = await rerun('job-1', {
      type: JobActionType.RERUN,
      requestedAt,
      payload: {
        regeneratePronunciationChunkAudio: true,
        pronunciationChunkTtsProvider: 'google',
        pronunciationChunkGoogleTtsModel: 'studio',
        pronunciationChunkVoiceId: 'chunk-voice',
        pronunciationChunkVoiceAccent: 'british',
      },
    });

    expect(result.success).toBe(true);
    expect(vi.mocked(insertJob)).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceId: 'voice-1',
        voiceAccent: 'american',
        ttsProvider: 'elevenlabs',
        ttsStrategy: 'auto',
        studyTextElevenlabsModel: undefined,
        googleTtsModel: 'chirp3_hd',
      }),
    );
  });

  it('queues audio reruns from the approved markdown path with the source student id', async () => {
    vi.mocked(getJobById).mockResolvedValue({
      id: 'job-1',
      state: 'succeeded',
      md: jobMdPath,
      mdStorageUri: 's3://drafts/raw-placeholder-student.md',
      studentId: 'student-1',
      studentName: 'Alice Nguyen',
      withTts: true,
      ttsProvider: 'elevenlabs',
      ttsStrategy: 'auto',
      voiceId: 'voice-1',
      voiceAccent: 'american',
      publishTarget: 'html',
      htmlUrl: 'https://example.com/published.html',
      userId: 'user-1',
    } as never);

    const result = await rerun('job-1', {
      type: JobActionType.RERUN,
      requestedAt,
      payload: {
        regeneratePronunciationChunkAudio: true,
      },
    });

    expect(result.success).toBe(true);
    const insertParams = vi.mocked(insertJob).mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(insertParams).toMatchObject({
      md: jobMdPath,
      studentId: 'student-1',
      sourceJobId: 'job-1',
    });
    expect(insertParams).not.toHaveProperty('mdStorageUri');
  });

  it('forwards inherited study-text model defaults into the rerun queue payload', async () => {
    vi.mocked(getJobById).mockResolvedValue({
      id: 'job-1',
      state: 'succeeded',
      md: jobMdPath,
      mdStorageUri: 's3://drafts/job.md',
      withTts: true,
      ttsProvider: 'elevenlabs',
      ttsStrategy: 'dialogue',
      studyTextElevenlabsModel: 'eleven_v3',
      voiceId: 'voice-1',
      voiceAccent: 'american',
      publishTarget: 'html',
      htmlUrl: 'https://example.com/published.html',
      userId: 'user-1',
    } as never);

    const result = await rerun('job-1', {
      type: JobActionType.RERUN,
      requestedAt,
      payload: {
        regenerateStudyTextAudio: true,
      },
    });

    expect(result.success).toBe(true);
    const enqueueSpy = vi.mocked(createJobQueue).mock.results[0]?.value.enqueue;
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        rerun: expect.objectContaining({
          regenerateStudyTextAudio: true,
          studyTextTtsProvider: 'elevenlabs',
          studyTextTtsStrategy: 'dialogue',
          studyTextElevenlabsModel: 'eleven_v3',
        }),
      }),
    );
  });

  it('does not inherit study-text voice ids across provider changes', async () => {
    const result = await rerun('job-1', {
      type: JobActionType.RERUN,
      requestedAt,
      payload: {
        regenerateStudyTextAudio: true,
        studyTextTtsProvider: 'google',
      },
    });

    expect(result.success).toBe(true);
    expect(vi.mocked(insertJob)).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceId: undefined,
        voiceAccent: 'american',
        ttsProvider: 'google',
        googleTtsModel: 'chirp3_hd',
      }),
    );

    const enqueueSpy = vi.mocked(createJobQueue).mock.results[0]?.value.enqueue;
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        rerun: expect.objectContaining({
          regenerateStudyTextAudio: true,
          studyTextTtsProvider: 'google',
          studyTextVoiceAccent: 'american',
          studyTextVoiceId: undefined,
        }),
      }),
    );
  });

  it('recovers a durable html manifest from the published artifact when the source manifest is missing', async () => {
    await rm(durableManifestPath, { force: true });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          [
            '<figure class="audio-figure"><audio controls src="https://example.com/study.mp3"></audio><figcaption><a href="https://example.com/study.mp3">Audio recording: Study Text</a></figcaption></figure>',
            '<script id="esl-pronunciation-audio" type="application/json">',
            JSON.stringify({
              mode: 'minimal_pair',
              primaryClip: null,
              itemClips: [
                {
                  id: 'clip-1',
                  itemIndex: 0,
                  kind: 'pair_left',
                  engine: 'provider',
                  text: 'pan',
                  path: '/tmp/stale.mp3',
                  url: 'https://example.com/pron-1.mp3',
                },
              ],
            }),
            '</script>',
          ].join(''),
      }),
    );

    try {
      const result = await rerun('job-1', {
        type: JobActionType.RERUN,
        requestedAt,
        payload: {
          regeneratePronunciationChunkAudio: true,
        },
      });

      expect(result.success).toBe(true);
      const recoveredManifest = JSON.parse(await readFile(durableManifestPath, 'utf8'));
      expect(recoveredManifest.publishTarget).toBe('html');
      expect(recoveredManifest.audioArtifacts.studyText.url).toBe('https://example.com/study.mp3');
      expect(recoveredManifest.audioArtifacts.pronunciation.itemClips[0].url).toBe(
        'https://example.com/pron-1.mp3',
      );
      expect(recoveredManifest.audioArtifacts.pronunciation.itemClips[0].path).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
