import { logger } from '../infrastructure/logger.js';
import { createStudentMemoryQueue } from '../infrastructure/student-memory-queue.js';

export interface RequestStudentProfileCandidateRefreshParams {
  studentId: string;
  sourceSnapshotId?: string | null;
  trigger: 'student-memory-snapshot-ready' | 'manual-replay';
}

export interface RequestStudentProfileCandidateRefreshDependencies {
  queue: {
    enqueue: ReturnType<typeof createStudentMemoryQueue>['enqueue'];
  };
}

export interface ReconcileStudentProfileCandidateRefreshDependencies {
  queue: {
    reconcile: ReturnType<typeof createStudentMemoryQueue>['reconcile'];
  };
}

export async function requestStudentProfileCandidateRefresh(args: {
  params: RequestStudentProfileCandidateRefreshParams;
  overrides?: Partial<RequestStudentProfileCandidateRefreshDependencies>;
}): Promise<void> {
  const queue = args.overrides?.queue ?? createStudentMemoryQueue();

  await queue.enqueue(
    {
      kind: 'student-profile-candidate-refresh',
      studentId: args.params.studentId,
      sourceSnapshotId: args.params.sourceSnapshotId ?? null,
      trigger: args.params.trigger,
    },
    {
      jobId: `student-profile-candidate-refresh:${args.params.studentId}:${args.params.sourceSnapshotId ?? 'latest'}`,
    },
  );

  logger.info('Student profile candidate refresh requested', {
    event: 'student_profile_candidate_refresh_requested',
    studentId: args.params.studentId,
    sourceSnapshotId: args.params.sourceSnapshotId ?? null,
    trigger: args.params.trigger,
  });
}

export async function reconcileStudentProfileCandidateRefresh(args: {
  params: RequestStudentProfileCandidateRefreshParams;
  overrides?: Partial<ReconcileStudentProfileCandidateRefreshDependencies>;
}): Promise<void> {
  const queue = args.overrides?.queue ?? createStudentMemoryQueue();
  const jobId = `student-profile-candidate-refresh:${args.params.studentId}:${args.params.sourceSnapshotId ?? 'latest'}`;

  await queue.reconcile(
    {
      kind: 'student-profile-candidate-refresh',
      studentId: args.params.studentId,
      sourceSnapshotId: args.params.sourceSnapshotId ?? null,
      trigger: args.params.trigger,
    },
    { jobId },
  );

  logger.info('Student profile candidate refresh reconciled', {
    event: 'student_profile_candidate_refresh_reconciled',
    studentId: args.params.studentId,
    sourceSnapshotId: args.params.sourceSnapshotId ?? null,
    trigger: args.params.trigger,
  });
}
