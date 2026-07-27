import type { StudentMemorySnapshotGenerationNotes } from '../domain/student-memory-snapshot-model.js';
import {
  getEligibleReadyStudentMemorySnapshotById,
  updateStudentMemorySnapshotGenerationNotes,
} from '../domain/student-memory-snapshot-repository.js';
import { requestStudentProfileCandidateRefresh } from './request-student-profile-candidate-refresh.js';
import type { StudentMemorySnapshotCandidateRefreshEnqueueStatus } from './student-memory-snapshot-generation-notes.js';

interface RetryStudentProfileCandidateRefreshDependencies {
  snapshots: {
    getEligibleReadyById: typeof getEligibleReadyStudentMemorySnapshotById;
    updateGenerationNotes: typeof updateStudentMemorySnapshotGenerationNotes;
  };
  profileCandidates: {
    requestRefresh: typeof requestStudentProfileCandidateRefresh;
  };
}

export interface RetryStudentProfileCandidateRefreshResult {
  outcome: 'enqueued' | 'already_enqueued';
  snapshotId: string;
}

export async function retryStudentProfileCandidateRefreshForSnapshot(args: {
  snapshotId: string;
  overrides?: Partial<RetryStudentProfileCandidateRefreshDependencies>;
}): Promise<RetryStudentProfileCandidateRefreshResult> {
  const snapshots = args.overrides?.snapshots ?? {
    getEligibleReadyById: getEligibleReadyStudentMemorySnapshotById,
    updateGenerationNotes: updateStudentMemorySnapshotGenerationNotes,
  };
  const profileCandidates = args.overrides?.profileCandidates ?? {
    requestRefresh: requestStudentProfileCandidateRefresh,
  };
  const snapshot = await snapshots.getEligibleReadyById(args.snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot ${args.snapshotId} is not an eligible ready snapshot`);
  }

  const candidateRefresh = readCandidateRefreshDecision(snapshot.generationNotes ?? null);
  if (!candidateRefresh || candidateRefresh.requested !== true) {
    throw new Error(`Snapshot ${args.snapshotId} does not record a requested candidate refresh`);
  }

  const enqueueStatus = readEnqueueStatus(candidateRefresh.enqueueStatus);
  if (enqueueStatus === 'enqueued') {
    return { outcome: 'already_enqueued', snapshotId: snapshot.id };
  }
  if (enqueueStatus === 'not_requested') {
    throw new Error(`Snapshot ${args.snapshotId} does not record a requested candidate refresh`);
  }
  if (candidateRefresh.enqueueStatus !== undefined && enqueueStatus === null) {
    throw new Error(`Snapshot ${args.snapshotId} has an invalid candidate refresh enqueue status`);
  }

  const persistStatus = async (status: StudentMemorySnapshotCandidateRefreshEnqueueStatus) => {
    const generationNotes: StudentMemorySnapshotGenerationNotes = {
      ...(snapshot.generationNotes ?? {}),
      candidateRefresh: {
        ...candidateRefresh,
        enqueueStatus: status,
      },
    };
    const updated = await snapshots.updateGenerationNotes({
      id: snapshot.id,
      generationNotes,
    });
    if (!updated) {
      throw new Error(`Snapshot ${snapshot.id} disappeared while recording candidate refresh`);
    }
  };

  await persistStatus('pending');
  try {
    await profileCandidates.requestRefresh({
      params: {
        studentId: snapshot.studentId,
        sourceSnapshotId: snapshot.id,
        trigger: 'manual-replay',
      },
    });
  } catch (error) {
    await persistStatus('failed');
    throw error;
  }
  await persistStatus('enqueued');

  return { outcome: 'enqueued', snapshotId: snapshot.id };
}

function readCandidateRefreshDecision(
  generationNotes: StudentMemorySnapshotGenerationNotes | null,
): Record<string, unknown> | null {
  const candidateRefresh = generationNotes?.candidateRefresh;
  return candidateRefresh !== null &&
    typeof candidateRefresh === 'object' &&
    !Array.isArray(candidateRefresh)
    ? (candidateRefresh as Record<string, unknown>)
    : null;
}

function readEnqueueStatus(
  value: unknown,
): StudentMemorySnapshotCandidateRefreshEnqueueStatus | null {
  return value === 'not_requested' ||
    value === 'pending' ||
    value === 'enqueued' ||
    value === 'failed'
    ? value
    : null;
}
