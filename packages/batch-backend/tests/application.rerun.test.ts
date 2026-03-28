import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('application/job-actions/rerun', () => {
  const requestedAt = new Date('2026-03-28T00:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.mocked(insertJob).mockResolvedValue({ id: 'job-rerun' } as never);
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
});
