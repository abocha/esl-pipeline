import { describe, expect, it, vi } from 'vitest';

import { publishAssignmentCorrection } from '../src/application/publish-assignment-correction.js';
import type { JobRecord } from '../src/domain/job-model.js';

const request = {
  requestId: '11111111-1111-4111-8111-111111111111',
  draftId: '22222222-2222-4222-8222-222222222222',
  draftWorkingVersion: 3,
  draftHash: 'a'.repeat(64),
};

const childJob: JobRecord = {
  id: request.requestId,
  state: 'queued',
  md: null,
  mdStorageUri: `local://drafts/${request.draftId}/content/${request.draftHash}.md`,
  assignmentArtifact: {
    format: 'assignment_v1',
    schemaVersion: 1,
    serializationVersion: 1,
    workingVersion: 3,
    contentHash: request.draftHash,
    storageUri: `local://drafts/content/${request.draftHash}.json`,
  },
  draftId: request.draftId,
  sourceJobId: '33333333-3333-4333-8333-333333333333',
  createdAt: new Date('2026-08-14T00:00:00Z'),
  updatedAt: new Date('2026-08-14T00:00:00Z'),
};

describe('application/publish-assignment-correction', () => {
  it('commits the child reservation before reconciling its normal-pipeline queue payload', async () => {
    const sequence: string[] = [];
    const publish = vi.fn(async () => {
      sequence.push('reserved');
      return { job: childJob, created: true };
    });
    const reconcile = vi.fn(async () => {
      sequence.push('reconciled');
    });

    const result = await publishAssignmentCorrection({
      userId: '44444444-4444-4444-8444-444444444444',
      publishedJobId: childJob.sourceJobId!,
      request,
      overrides: {
        corrections: { publish },
        queue: { reconcile },
        publishEvent: vi.fn(),
      },
    });

    expect(sequence).toEqual(['reserved', 'reconciled']);
    expect(reconcile).toHaveBeenCalledWith({
      jobId: childJob.id,
      executionMode: 'correction',
      sourceJobId: childJob.sourceJobId,
      correction: {
        expectedAssignmentHash: request.draftHash,
        manifestMd: `corrections/${childJob.id}.md`,
      },
    });
    expect(result.job).toMatchObject({ jobId: childJob.id, state: 'queued' });
  });

  it('reconciles the original child on an idempotent replay without a duplicate creation event', async () => {
    const publishEvent = vi.fn();
    const reconcile = vi.fn();

    const result = await publishAssignmentCorrection({
      userId: '44444444-4444-4444-8444-444444444444',
      publishedJobId: childJob.sourceJobId!,
      request,
      overrides: {
        corrections: { publish: vi.fn().mockResolvedValue({ job: childJob, created: false }) },
        queue: { reconcile },
        publishEvent,
      },
    });

    expect(publishEvent).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(result.job.jobId).toBe(childJob.id);
  });

  it.each(['running', 'succeeded'] as const)(
    'does not reconcile an already %s correction replay',
    async (state) => {
      const reconcile = vi.fn();

      const result = await publishAssignmentCorrection({
        userId: '44444444-4444-4444-8444-444444444444',
        publishedJobId: childJob.sourceJobId!,
        request,
        overrides: {
          corrections: {
            publish: vi.fn().mockResolvedValue({
              job: { ...childJob, state },
              created: false,
            }),
          },
          queue: { reconcile },
          publishEvent: vi.fn(),
        },
      });

      expect(reconcile).not.toHaveBeenCalled();
      expect(result.job).toMatchObject({ jobId: childJob.id, state });
    },
  );
});
