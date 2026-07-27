import { describe, expect, it, vi } from 'vitest';

import { retryStudentProfileCandidateRefreshForSnapshot } from '../src/application/retry-student-profile-candidate-refresh.js';

function eligibleSnapshot(candidateRefresh: Record<string, unknown>): {
  id: string;
  studentId: string;
  status: 'ready';
  generationNotes: Record<string, unknown>;
} {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    studentId: '22222222-2222-4222-8222-222222222222',
    status: 'ready',
    generationNotes: { candidateRefresh },
  };
}

function dependencies(snapshot: ReturnType<typeof eligibleSnapshot> | null) {
  return {
    snapshots: {
      getEligibleReadyById: vi.fn().mockResolvedValue(snapshot),
      updateGenerationNotes: vi.fn().mockImplementation(async ({ generationNotes }) => ({
        ...snapshot,
        generationNotes,
      })),
    },
    profileCandidates: {
      requestRefresh: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('application/retry-student-profile-candidate-refresh', () => {
  it.each(['pending', 'failed'] as const)(
    'enqueues an eligible requested snapshot from %s delivery state',
    async (enqueueStatus) => {
      const snapshot = eligibleSnapshot({ requested: true, enqueueStatus });
      const overrides = dependencies(snapshot);

      const result = await retryStudentProfileCandidateRefreshForSnapshot({
        snapshotId: snapshot.id,
        overrides: overrides as never,
      });

      expect(result).toEqual({ outcome: 'enqueued', snapshotId: snapshot.id });
      expect(overrides.profileCandidates.requestRefresh).toHaveBeenCalledWith({
        params: {
          studentId: snapshot.studentId,
          sourceSnapshotId: snapshot.id,
          trigger: 'manual-replay',
        },
      });
      expect(overrides.snapshots.updateGenerationNotes).toHaveBeenNthCalledWith(1, {
        id: snapshot.id,
        generationNotes: {
          candidateRefresh: { requested: true, enqueueStatus: 'pending' },
        },
      });
      expect(overrides.snapshots.updateGenerationNotes).toHaveBeenNthCalledWith(2, {
        id: snapshot.id,
        generationNotes: {
          candidateRefresh: { requested: true, enqueueStatus: 'enqueued' },
        },
      });
    },
  );

  it('treats legacy requested metadata without delivery state as pending', async () => {
    const snapshot = eligibleSnapshot({ requested: true });
    const overrides = dependencies(snapshot);

    await expect(
      retryStudentProfileCandidateRefreshForSnapshot({
        snapshotId: snapshot.id,
        overrides: overrides as never,
      }),
    ).resolves.toMatchObject({ outcome: 'enqueued' });

    expect(overrides.profileCandidates.requestRefresh).toHaveBeenCalledTimes(1);
  });

  it('returns already_enqueued without requesting a duplicate job', async () => {
    const snapshot = eligibleSnapshot({ requested: true, enqueueStatus: 'enqueued' });
    const overrides = dependencies(snapshot);

    await expect(
      retryStudentProfileCandidateRefreshForSnapshot({
        snapshotId: snapshot.id,
        overrides: overrides as never,
      }),
    ).resolves.toEqual({ outcome: 'already_enqueued', snapshotId: snapshot.id });

    expect(overrides.profileCandidates.requestRefresh).not.toHaveBeenCalled();
    expect(overrides.snapshots.updateGenerationNotes).not.toHaveBeenCalled();
  });

  it.each([
    { candidateRefresh: undefined, label: 'missing decision' },
    {
      candidateRefresh: { requested: false, enqueueStatus: 'not_requested' },
      label: 'not-requested decision',
    },
  ])('rejects a $label', async ({ candidateRefresh }) => {
    const snapshot = candidateRefresh
      ? eligibleSnapshot(candidateRefresh)
      : { ...eligibleSnapshot({}), generationNotes: {} };
    const overrides = dependencies(snapshot);

    await expect(
      retryStudentProfileCandidateRefreshForSnapshot({
        snapshotId: snapshot.id,
        overrides: overrides as never,
      }),
    ).rejects.toThrow('does not record a requested candidate refresh');

    expect(overrides.profileCandidates.requestRefresh).not.toHaveBeenCalled();
  });

  it('rejects a snapshot that is missing or not eligible and ready', async () => {
    const overrides = dependencies(null);

    await expect(
      retryStudentProfileCandidateRefreshForSnapshot({
        snapshotId: '11111111-1111-4111-8111-111111111111',
        overrides: overrides as never,
      }),
    ).rejects.toThrow('is not an eligible ready snapshot');

    expect(overrides.profileCandidates.requestRefresh).not.toHaveBeenCalled();
  });

  it('records failed delivery and rethrows an enqueue failure', async () => {
    const snapshot = eligibleSnapshot({ requested: true, enqueueStatus: 'failed' });
    const overrides = dependencies(snapshot);
    const enqueueError = new Error('Redis unavailable');
    overrides.profileCandidates.requestRefresh.mockRejectedValue(enqueueError);

    await expect(
      retryStudentProfileCandidateRefreshForSnapshot({
        snapshotId: snapshot.id,
        overrides: overrides as never,
      }),
    ).rejects.toBe(enqueueError);

    expect(overrides.snapshots.updateGenerationNotes).toHaveBeenLastCalledWith({
      id: snapshot.id,
      generationNotes: {
        candidateRefresh: { requested: true, enqueueStatus: 'failed' },
      },
    });
  });
});
