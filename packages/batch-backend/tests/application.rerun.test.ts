import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { manifestPathFor } from '@esl-pipeline/orchestrator';

import { JobActionType } from '../src/domain/job-actions.js';
import { assignmentArtifactFixture } from './assignment-v1.test-harness.js';

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
        schemaVersion: 6,
        assignmentHash: 'a'.repeat(64),
        assignmentRendererVersion: 2,
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
      assignmentArtifact: assignmentArtifactFixture(),
      assignmentRendererVersion: 2,
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      id: 'job-1',
      state: 'succeeded',
      md: jobMdPath,
      mdStorageUri: 's3://drafts/job.md',
      withTts: true,
      ttsProvider: 'elevenlabs',
      ttsStrategy: 'auto',
      voiceId: 'voice-1',
      voiceAccent: 'american',
      ttsModel: 'eleven_multilingual_v2',
      publishTarget: 'html',
      htmlUrl: 'https://example.com/published.html',
      userId: 'user-1',
    } as never);
    vi.mocked(insertJob).mockResolvedValue({ id: 'job-rerun' } as never);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(jobDir, { recursive: true, force: true });
  });

  it('does not scrape published HTML to recover a missing native manifest', async () => {
    await rm(durableManifestPath);
    const legacyJob = await getJobById('job-1');
    vi.mocked(getJobById).mockResolvedValue({
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      ...legacyJob,
      assignmentArtifact: { contentHash: 'a'.repeat(64) },
      assignmentRendererVersion: 2,
    } as never);
    const fetchSpy = vi.fn(() => {
      throw new Error('native recovery scraped HTML');
    });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await rerun('job-1', {
        type: JobActionType.RERUN,
        requestedAt,
        payload: { republishOnly: true },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reruns typed publications without a local Markdown source and preserves the frozen reference', async () => {
    vi.stubEnv('FILESYSTEM_UPLOAD_DIR', jobDir);
    const artifact = {
      format: 'assignment_v1',
      schemaVersion: 1,
      serializationVersion: 1,
      workingVersion: 2,
      contentHash: 'a'.repeat(64),
      storageUri: `local://drafts/draft-1/content/${'a'.repeat(64)}.json`,
    };
    vi.mocked(getJobById).mockResolvedValue({
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      id: 'job-1',
      state: 'succeeded',
      md: null,
      assignmentArtifact: artifact,
      assignmentRendererVersion: 1,
      publishTarget: 'html',
      manifestPath: durableManifestPath,
    } as never);
    const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(createJobQueue).mockReturnValue(queue as never);
    const result = await rerun('job-1', {
      type: JobActionType.RERUN,
      requestedAt,
      payload: { republishOnly: true },
    });
    expect(result.success).toBe(true);
    expect(insertJob).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentArtifact: artifact,
        assignmentRendererVersion: 2,
        md: path.join(jobDir, 'assignments', 'job-1.md'),
      }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        rerun: expect.objectContaining({
          manifestMd: path.join(jobDir, 'assignments', 'job-1.md'),
        }),
      }),
    );
  });

  it('rejects eleven_v3 for pronunciation synthesis reruns', async () => {
    const result = await rerun('job-1', {
      type: JobActionType.RERUN,
      requestedAt,
      payload: {
        regeneratePronunciationMainAudio: true,
        pronunciationMainTtsProvider: 'elevenlabs',
        pronunciationMainTtsModel: 'eleven_v3',
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
        studyTextTtsModel: 'eleven_multilingual_v2',
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
        studyTextTtsModel: 'eleven_v3',
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
        ttsModel: 'eleven_v3',
      }),
    );
  });

  it('rejects inherited dialogue strategy when the explicit study-text model is not eleven_v3', async () => {
    vi.mocked(getJobById).mockResolvedValue({
      assignmentArtifact: assignmentArtifactFixture(),
      assignmentRendererVersion: 2,
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      id: 'job-1',
      state: 'succeeded',
      md: '/tmp/job.md',
      mdStorageUri: 's3://drafts/job.md',
      withTts: true,
      ttsProvider: 'elevenlabs',
      ttsStrategy: 'dialogue',
      voiceId: 'voice-1',
      voiceAccent: 'american',
      ttsModel: 'eleven_multilingual_v2',
      publishTarget: 'html',
      userId: 'user-1',
    } as never);

    const result = await rerun('job-1', {
      type: JobActionType.RERUN,
      requestedAt,
      payload: {
        regenerateStudyTextAudio: true,
        studyTextTtsModel: 'eleven_multilingual_v2',
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('validation_failed');
    expect(vi.mocked(insertJob)).not.toHaveBeenCalled();
  });

  it('rejects inherited auto strategy when an explicit study-text elevenlabs model is provided', async () => {
    vi.mocked(getJobById).mockResolvedValue({
      assignmentArtifact: assignmentArtifactFixture(),
      assignmentRendererVersion: 2,
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      id: 'job-1',
      state: 'succeeded',
      md: '/tmp/job.md',
      mdStorageUri: 's3://drafts/job.md',
      withTts: true,
      ttsProvider: 'elevenlabs',
      ttsStrategy: 'auto',
      voiceId: 'voice-1',
      voiceAccent: 'american',
      ttsModel: 'eleven_multilingual_v2',
      publishTarget: 'html',
      userId: 'user-1',
    } as never);

    const result = await rerun('job-1', {
      type: JobActionType.RERUN,
      requestedAt,
      payload: {
        regenerateStudyTextAudio: true,
        studyTextTtsModel: 'eleven_flash_v2_5',
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
        pronunciationChunkTtsModel: 'studio',
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
        ttsModel: 'eleven_multilingual_v2',
      }),
    );
  });

  it('queues native audio reruns from the frozen assignment with the source student id', async () => {
    vi.mocked(getJobById).mockResolvedValue({
      assignmentArtifact: assignmentArtifactFixture(),
      assignmentRendererVersion: 2,
      id: 'job-1',
      state: 'succeeded',
      md: jobMdPath,
      mdStorageUri: 's3://drafts/raw-placeholder-student.md',
      studentId: 'student-1',
      studentName: 'Alice Nguyen',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
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
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      sourceJobId: 'job-1',
    });
    expect(insertParams).not.toHaveProperty('mdStorageUri');
  });

  it('preserves absent immutable lineage as null instead of manufacturing identifiers', async () => {
    const result = await rerun('job-1', {
      type: JobActionType.RERUN,
      requestedAt,
      payload: { republishOnly: true },
    });

    expect(result.success).toBe(true);
    expect(vi.mocked(insertJob)).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: null,
        transcriptId: null,
        promptPackageId: 'prompt-1',
        draftId: 'draft-1',
        sourceJobId: 'job-1',
      }),
    );
  });

  it('forwards inherited study-text model defaults into the rerun queue payload', async () => {
    vi.mocked(getJobById).mockResolvedValue({
      assignmentArtifact: assignmentArtifactFixture(),
      assignmentRendererVersion: 2,
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      id: 'job-1',
      state: 'succeeded',
      md: jobMdPath,
      mdStorageUri: 's3://drafts/job.md',
      withTts: true,
      ttsProvider: 'elevenlabs',
      ttsStrategy: 'dialogue',
      ttsModel: 'eleven_v3',
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
          studyTextTtsModel: 'eleven_v3',
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
        ttsModel: undefined,
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
});
