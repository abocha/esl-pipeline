import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeJobAction } from '../src/application/job-actions/action-handler.js';
import { JobActionType } from '../src/domain/job-actions.js';
import * as historyRepository from '../src/domain/job-action-history-repository.js';
import * as cancelModule from '../src/application/job-actions/cancel-job.js';
import * as editModule from '../src/application/job-actions/edit-metadata.js';
import * as rerunModule from '../src/application/job-actions/rerun-audio.js';
import * as rerunPublishModule from '../src/application/job-actions/rerun-publish.js';

describe('application/job-actions/action-handler', () => {
  const rerunSpy = vi.spyOn(rerunModule, 'rerunAudio');
  const rerunPublishSpy = vi.spyOn(rerunPublishModule, 'rerunPublish');
  const cancelSpy = vi.spyOn(cancelModule, 'cancelJob');
  const editSpy = vi.spyOn(editModule, 'editMetadata');
  const insertHistorySpy = vi.spyOn(historyRepository, 'insertJobActionHistory');

  beforeEach(() => {
    vi.clearAllMocks();
    insertHistorySpy.mockResolvedValue({
      id: 'history-1',
      jobId: 'job-1',
      actionType: JobActionType.RERUN_AUDIO,
      payload: {},
      requestedAt: new Date('2026-02-07T00:00:00.000Z'),
      requestedBy: 'user-1',
      outcome: 'succeeded',
      message: 'ok',
      errorCode: null,
      createdJobId: 'job-rerun',
      createdAt: new Date('2026-02-07T00:00:00.000Z'),
    });
  });

  it('persists action history for successful rerun actions', async () => {
    rerunSpy.mockResolvedValue({
      success: true,
      message: 'Audio rerun queued',
      jobId: 'job-rerun',
      actionType: JobActionType.RERUN_AUDIO,
      timestamp: new Date('2026-02-07T00:00:00.000Z'),
    });

    const requestedAt = new Date('2026-02-07T00:00:00.000Z');
    await executeJobAction('job-source', {
      type: JobActionType.RERUN_AUDIO,
      requestedAt,
      requestedBy: 'user-1',
      payload: { forceTts: true },
    });

    expect(insertHistorySpy).toHaveBeenCalledWith({
      jobId: 'job-source',
      actionType: JobActionType.RERUN_AUDIO,
      payload: { forceTts: true },
      requestedAt,
      requestedBy: 'user-1',
      outcome: 'succeeded',
      message: 'Audio rerun queued',
      errorCode: null,
      createdJobId: 'job-rerun',
    });
  });

  it('persists failed action outcomes', async () => {
    cancelSpy.mockResolvedValue({
      success: false,
      message: 'Only queued or running jobs can be cancelled',
      jobId: 'job-1',
      actionType: JobActionType.CANCEL,
      timestamp: new Date('2026-02-07T00:00:00.000Z'),
      error: 'invalid_state',
    });

    await executeJobAction('job-1', {
      type: JobActionType.CANCEL,
      requestedAt: new Date('2026-02-07T00:00:00.000Z'),
      payload: {},
    });

    expect(insertHistorySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        actionType: JobActionType.CANCEL,
        outcome: 'failed',
        errorCode: 'invalid_state',
        createdJobId: null,
      }),
    );
  });

  it('persists createdJobId for successful rerun_publish actions', async () => {
    rerunPublishSpy.mockResolvedValue({
      success: true,
      message: 'Publish rerun queued',
      jobId: 'job-publish-rerun',
      actionType: JobActionType.RERUN_PUBLISH,
      timestamp: new Date('2026-02-07T00:00:00.000Z'),
    });

    const requestedAt = new Date('2026-02-07T00:00:00.000Z');
    await executeJobAction('job-source', {
      type: JobActionType.RERUN_PUBLISH,
      requestedAt,
      requestedBy: 'user-1',
      payload: {},
    });

    expect(insertHistorySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-source',
        actionType: JobActionType.RERUN_PUBLISH,
        outcome: 'succeeded',
        errorCode: null,
        createdJobId: 'job-publish-rerun',
      }),
    );
  });

  it('skips history persistence for not_found actions', async () => {
    editSpy.mockResolvedValue({
      success: false,
      message: 'Job not found',
      jobId: 'job-missing',
      actionType: JobActionType.EDIT_METADATA,
      timestamp: new Date('2026-02-07T00:00:00.000Z'),
      error: 'not_found',
    });

    await executeJobAction('job-missing', {
      type: JobActionType.EDIT_METADATA,
      requestedAt: new Date('2026-02-07T00:00:00.000Z'),
      payload: { learningPresetId: 'general-english' },
    });

    expect(insertHistorySpy).not.toHaveBeenCalled();
  });
});
