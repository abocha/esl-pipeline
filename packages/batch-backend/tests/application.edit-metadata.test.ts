import { beforeEach, describe, expect, it, vi } from 'vitest';

import { editMetadata } from '../src/application/job-actions/edit-metadata.js';
import { JobActionType } from '../src/domain/job-actions.js';
import * as jobEvents from '../src/domain/job-events.js';
import type { JobRecord } from '../src/domain/job-model.js';
import * as jobRepository from '../src/domain/job-repository.js';

describe('application/job-actions/edit-metadata', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const baseJob: JobRecord = {
    id: 'job-1',
    state: 'awaiting_approval',
    md: 'fixtures/ok.md',
    recordingId: null,
    transcriptId: null,
    promptPackageId: null,
    draftId: null,
    preset: null,
    withTts: null,
    upload: null,
    voiceId: null,
    voiceAccent: null,
    forceTts: null,
    notionDatabase: null,
    ttsStrategy: null,
    notionUrl: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    startedAt: null,
    finishedAt: null,
    error: null,
    manifestPath: null,
    userId: null,
  };

  it('returns not_found when job is missing', async () => {
    vi.spyOn(jobRepository, 'getJobById').mockResolvedValue(null);

    const result = await editMetadata('job-unknown', {
      type: JobActionType.EDIT_METADATA,
      requestedAt: new Date(),
      payload: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('not_found');
  });

  it('rejects edits when job is not awaiting approval', async () => {
    vi.spyOn(jobRepository, 'getJobById').mockResolvedValue({
      ...baseJob,
      state: 'running',
    });

    const result = await editMetadata('job-1', {
      type: JobActionType.EDIT_METADATA,
      requestedAt: new Date(),
      payload: { learningPresetId: 'general-english' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_state');
  });

  it('rejects invalid payloads', async () => {
    vi.spyOn(jobRepository, 'getJobById').mockResolvedValue(baseJob);

    const result = await editMetadata('job-1', {
      type: JobActionType.EDIT_METADATA,
      requestedAt: new Date(),
      payload: { learningPresetId: '' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('validation_failed');
  });

  it('updates metadata for awaiting approval jobs', async () => {
    vi.spyOn(jobRepository, 'getJobById').mockResolvedValue(baseJob);
    const publishSpy = vi.spyOn(jobEvents, 'publishJobEvent').mockImplementation(() => {});
    vi.spyOn(jobRepository, 'updateJobMetadata').mockResolvedValue({
      ...baseJob,
      learningPresetId: 'general-english',
    });

    const result = await editMetadata('job-1', {
      type: JobActionType.EDIT_METADATA,
      requestedAt: new Date(),
      payload: { learningPresetId: 'general-english' },
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.message).toBe('Job metadata updated');
    expect(jobRepository.updateJobMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'job-1',
        expectedState: 'awaiting_approval',
        learningPresetId: 'general-english',
      }),
    );
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'job_state_changed',
        job: expect.objectContaining({
          id: 'job-1',
          learningPresetId: 'general-english',
        }),
      }),
    );
  });

  it('returns no-op when metadata payload does not change effective values', async () => {
    vi.spyOn(jobRepository, 'getJobById').mockResolvedValue({
      ...baseJob,
      learningPresetId: 'general-english',
      withTts: true,
    });
    const updateSpy = vi.spyOn(jobRepository, 'updateJobMetadata');
    const publishSpy = vi.spyOn(jobEvents, 'publishJobEvent').mockImplementation(() => {});

    const result = await editMetadata('job-1', {
      type: JobActionType.EDIT_METADATA,
      requestedAt: new Date(),
      payload: { learningPresetId: 'general-english', withTts: true },
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe('No metadata changes detected');
    expect(updateSpy).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
  });
});
