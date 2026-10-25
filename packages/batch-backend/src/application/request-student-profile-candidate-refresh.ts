import { getLatestReadyStudentMemorySnapshotByStudentId } from '../domain/student-memory-snapshot-repository.js';
import { logger } from '../infrastructure/logger.js';
import { createStudentMemoryQueue } from '../infrastructure/student-memory-queue.js';

export interface RequestStudentProfileCandidateRefreshParams {
  studentId: string;
  sourceSnapshotId?: string | null;
  trigger: 'student-memory-snapshot-ready' | 'manual-replay';
}

export interface RequestStudentProfileCandidateRefreshDependencies {
  snapshots: { getLatestReadyByStudentId: typeof getLatestReadyStudentMemorySnapshotByStudentId };
  queue: {
    enqueue: ReturnType<typeof createStudentMemoryQueue>['enqueue'];
  };
}

export interface ReconcileStudentProfileCandidateRefreshDependencies {
  snapshots: { getLatestReadyByStudentId: typeof getLatestReadyStudentMemorySnapshotByStudentId };
  queue: {
    reconcile: ReturnType<typeof createStudentMemoryQueue>['reconcile'];
  };
}

export async function requestStudentProfileCandidateRefresh(args: {
  params: RequestStudentProfileCandidateRefreshParams;
  overrides?: Partial<RequestStudentProfileCandidateRefreshDependencies>;
}): Promise<void> {
  const sourceSnapshotId = await resolveSourceSnapshotId(args.params, args.overrides?.snapshots);
  const queue = args.overrides?.queue ?? createStudentMemoryQueue();

  await queue.enqueue(
    {
      kind: 'student-profile-candidate-refresh',
      studentId: args.params.studentId,
      sourceSnapshotId,
      trigger: args.params.trigger,
    },
    {
      jobId: `student-profile-candidate-refresh:${args.params.studentId}:${sourceSnapshotId}`,
    },
  );

  logger.info('Student profile candidate refresh requested', {
    event: 'student_profile_candidate_refresh_requested',
    studentId: args.params.studentId,
    sourceSnapshotId,
    trigger: args.params.trigger,
  });
}

export async function reconcileStudentProfileCandidateRefresh(args: {
  params: RequestStudentProfileCandidateRefreshParams;
  overrides?: Partial<ReconcileStudentProfileCandidateRefreshDependencies>;
}): Promise<void> {
  const sourceSnapshotId = await resolveSourceSnapshotId(args.params, args.overrides?.snapshots);
  const queue = args.overrides?.queue ?? createStudentMemoryQueue();
  const jobId = `student-profile-candidate-refresh:${args.params.studentId}:${sourceSnapshotId}`;

  await queue.reconcile(
    {
      kind: 'student-profile-candidate-refresh',
      studentId: args.params.studentId,
      sourceSnapshotId,
      trigger: args.params.trigger,
    },
    { jobId },
  );

  logger.info('Student profile candidate refresh reconciled', {
    event: 'student_profile_candidate_refresh_reconciled',
    studentId: args.params.studentId,
    sourceSnapshotId,
    trigger: args.params.trigger,
  });
}

async function resolveSourceSnapshotId(
  params: RequestStudentProfileCandidateRefreshParams,
  snapshots?: RequestStudentProfileCandidateRefreshDependencies['snapshots'],
): Promise<string> {
  const pinned = params.sourceSnapshotId?.trim();
  if (pinned) return pinned;
  if (params.trigger !== 'manual-replay') {
    throw new Error('Automatic candidate refresh requires an explicit sourceSnapshotId');
  }
  const snapshot = await (
    snapshots?.getLatestReadyByStudentId ?? getLatestReadyStudentMemorySnapshotByStudentId
  )(params.studentId);
  if (!snapshot || snapshot.studentId !== params.studentId) {
    throw new Error('Manual candidate refresh requires an eligible same-student source snapshot');
  }
  return snapshot.id;
}
