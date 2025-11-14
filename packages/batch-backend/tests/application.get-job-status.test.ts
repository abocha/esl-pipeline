import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getJobStatus } from '../src/application/get-job-status';
import * as jobRepository from '../src/domain/job-repository';
import * as jobDto from '../src/application/job-dto';

describe('application/get-job-status', () => {
  /**
   * Intent:
   * - Verify mapping from persisted JobRecord to the public status DTO.
   * - Ensure that missing/invalid IDs and unknown jobs are handled cleanly.
   * - Protects the GET /jobs/:jobId contract from accidental shape changes.
   */

  const getJobByIdSpy = vi.spyOn(jobRepository, 'getJobById');
  const jobRecordToDtoSpy = vi.spyOn(jobDto, 'jobRecordToDto');

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
    expect(jobRecordToDtoSpy).not.toHaveBeenCalled();
  });

  it('delegates serialization to jobRecordToDto', async () => {
    const jobRecord = {
      id: 'job-1',
      state: 'queued',
      md: 'fixtures/ok.md',
    } as any;
    const dto = { jobId: 'job-1', state: 'queued' } as any;

    getJobByIdSpy.mockResolvedValue(jobRecord);
    jobRecordToDtoSpy.mockReturnValue(dto);

    const res = await getJobStatus('job-1');

    expect(getJobByIdSpy).toHaveBeenCalledWith('job-1');
    expect(jobRecordToDtoSpy).toHaveBeenCalledWith(jobRecord);
    expect(res).toBe(dto);
  });
});
