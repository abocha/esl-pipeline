import { describe, expect, it } from 'vitest';

import * as h from './application.process-queue-job.test-harness.js';
import { processQueueJob } from '../src/application/process-queue-job.js';

const {
  makeJob,
  getJobByIdSpy,
  updateJobStateAndResultSpy,
  runAssignmentJobSpy,
  maybeRunTtsCacheMaintenanceWithPgLockSpy,
  getSettingsByUserIdSpy,
  getDecryptedElevenLabsKeySpy,
  getDecryptedNotionTokenSpy,
} = h;

describe('application/process-queue-job', () => {
  it('continues job processing when cache maintenance fails', async () => {
      const initial = makeJob({ state: 'queued' });
      getJobByIdSpy.mockResolvedValue(initial);
  
      const running = makeJob({ state: 'running', startedAt: new Date('2024-01-01T10:01:00Z') });
      const succeeded = {
        ...running,
        state: 'succeeded',
        manifestPath: '/manifests/job-maintenance-failure.json',
        finishedAt: new Date('2024-01-01T10:02:00Z'),
        notionUrl: 'https://notion.so/job-maintenance-failure',
        anytypeUrl: null,
      };
      updateJobStateAndResultSpy
        .mockResolvedValueOnce(running as any)
        .mockResolvedValueOnce(succeeded as any);
  
      maybeRunTtsCacheMaintenanceWithPgLockSpy.mockRejectedValueOnce(new Error('maintenance failed'));
      runAssignmentJobSpy.mockResolvedValue({
        manifestPath: '/manifests/job-maintenance-failure.json',
        notionUrl: 'https://notion.so/job-maintenance-failure',
      });
  
      await expect(processQueueJob({ jobId: 'job-1' })).resolves.toBeUndefined();
      expect(runAssignmentJobSpy).toHaveBeenCalledTimes(1);
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
