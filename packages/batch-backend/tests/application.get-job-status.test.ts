import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getJobStatus } from '../src/application/get-job-status';
import * as jobRepository from '../src/domain/job-repository';

describe('application/get-job-status', () => {
  /**
   * Intent:
   * - Verify mapping from persisted JobRecord to the public status DTO.
   * - Ensure that missing/invalid IDs and unknown jobs are handled cleanly.
   * - Protects the GET /jobs/:jobId contract from accidental shape changes.
   */

  const getJobByIdSpy = vi.spyOn(jobRepository, 'getJobById');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for empty jobId', async () => {
    const res = await getJobStatus('');
    expect(res).toBeNull();
    expect(getJobByIdSpy).not.toHaveBeenCalled();
  });

  it('returns null for non-existent job', async () => {
    getJobByIdSpy.mockResolvedValue(null);

    const res = await getJobStatus('missing-id');

    expect(getJobByIdSpy).toHaveBeenCalledWith('missing-id');
    expect(res).toBeNull();
  });

  it('maps JobRecord fields to DTO correctly', async () => {
    const createdAt = new Date('2024-01-01T10:00:00Z');
    const updatedAt = new Date('2024-01-01T10:05:00Z');
    const startedAt = new Date('2024-01-01T10:01:00Z');
    const finishedAt = new Date('2024-01-01T10:04:00Z');

    getJobByIdSpy.mockResolvedValue({
      id: 'job-1',
      state: 'succeeded',
      md: 'fixtures/ok.md',
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
      createdAt,
      updatedAt,
      startedAt,
      finishedAt,
      error: null,
      manifestPath: '/manifests/job-1.json',
    } as any);

    const res = await getJobStatus('job-1');

    expect(res).toEqual({
      jobId: 'job-1',
      state: 'succeeded',
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      error: null,
      manifestPath: '/manifests/job-1.json',
    });
  });

  it('normalizes nullable fields to null in DTO', async () => {
    const now = new Date('2024-01-01T10:00:00Z');

    getJobByIdSpy.mockResolvedValue({
      id: 'job-2',
      state: 'queued',
      md: 'fixtures/ok.md',
      preset: null,
      withTts: null,
      upload: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      error: undefined,
      manifestPath: undefined,
    } as any);

    const res = await getJobStatus('job-2');

    expect(res).toEqual({
      jobId: 'job-2',
      state: 'queued',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      startedAt: null,
      finishedAt: null,
      error: null,
      manifestPath: null,
    });
  });
});
