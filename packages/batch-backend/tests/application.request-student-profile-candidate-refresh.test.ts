import { describe, expect, it, vi } from 'vitest';

import {
  reconcileStudentProfileCandidateRefresh,
  requestStudentProfileCandidateRefresh,
} from '../src/application/request-student-profile-candidate-refresh.js';

const params = {
  studentId: '22222222-2222-4222-8222-222222222222',
  sourceSnapshotId: '11111111-1111-4111-8111-111111111111',
  trigger: 'manual-replay' as const,
};

describe('application/request-student-profile-candidate-refresh', () => {
  it('pins an unpinned manual request once before queue delivery', async () => {
    const enqueue = vi.fn();
    const getLatestReadyByStudentId = vi
      .fn()
      .mockResolvedValue({ id: 'snapshot-a', studentId: params.studentId });
    await requestStudentProfileCandidateRefresh({
      params: { ...params, sourceSnapshotId: null },
      overrides: { queue: { enqueue }, snapshots: { getLatestReadyByStudentId } },
    });
    expect(getLatestReadyByStudentId).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ sourceSnapshotId: 'snapshot-a' }),
      { jobId: 'student-profile-candidate-refresh:' + params.studentId + ':snapshot-a' },
    );
  });

  it('rejects an automatic request without a source snapshot before enqueue', async () => {
    const enqueue = vi.fn();
    await expect(
      requestStudentProfileCandidateRefresh({
        params: { ...params, sourceSnapshotId: null, trigger: 'student-memory-snapshot-ready' },
        overrides: { queue: { enqueue } },
      }),
    ).rejects.toThrow('explicit sourceSnapshotId');
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('uses enqueue for the normal publication path', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);

    await requestStudentProfileCandidateRefresh({
      params,
      overrides: { queue: { enqueue } },
    });

    expect(enqueue).toHaveBeenCalledWith(
      {
        kind: 'student-profile-candidate-refresh',
        ...params,
      },
      {
        jobId:
          'student-profile-candidate-refresh:22222222-2222-4222-8222-222222222222:11111111-1111-4111-8111-111111111111',
      },
    );
  });

  it('uses failed-job-aware reconciliation for the recovery path', async () => {
    const reconcile = vi.fn().mockResolvedValue(undefined);

    await reconcileStudentProfileCandidateRefresh({
      params,
      overrides: { queue: { reconcile } },
    });

    expect(reconcile).toHaveBeenCalledWith(
      {
        kind: 'student-profile-candidate-refresh',
        ...params,
      },
      {
        jobId:
          'student-profile-candidate-refresh:22222222-2222-4222-8222-222222222222:11111111-1111-4111-8111-111111111111',
      },
    );
  });
});
