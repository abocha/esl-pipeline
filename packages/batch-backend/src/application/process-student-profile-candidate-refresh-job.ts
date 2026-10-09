import { logger } from '../infrastructure/logger.js';
import { refreshStudentProfileCandidatesFromCanonicalMemory } from './student-profile-candidates.js';

export interface ProcessStudentProfileCandidateRefreshJobPayload {
  kind: 'student-profile-candidate-refresh';
  studentId: string;
  sourceSnapshotId?: string | null;
  trigger: 'student-memory-snapshot-ready' | 'manual-replay';
}

export async function processStudentProfileCandidateRefreshJob(args: {
  payload: ProcessStudentProfileCandidateRefreshJobPayload;
}): Promise<void> {
  const result = await refreshStudentProfileCandidatesFromCanonicalMemory({
    studentId: args.payload.studentId,
    sourceSnapshotId: args.payload.sourceSnapshotId ?? null,
  });

  if (result?.outcome === 'skipped') {
    logger.warn('Source-bound student profile candidate refresh skipped', {
      event: 'student_profile_candidate_refresh_skipped',
      studentId: args.payload.studentId,
      sourceSnapshotId: args.payload.sourceSnapshotId ?? null,
      trigger: args.payload.trigger,
      reason: result.skipReason,
      guidance:
        'Retry only an eligible snapshot with a recorded lesson source; do not replay source-less jobs against latest memory.',
    });
    return;
  }

  logger.info('Student profile candidate refresh processed', {
    event: 'student_profile_candidate_refresh_processed',
    studentId: args.payload.studentId,
    sourceSnapshotId: args.payload.sourceSnapshotId ?? null,
    trigger: args.payload.trigger,
    created: result?.created.length ?? 0,
    skipped: result?.skippedCandidateKeys.length ?? 0,
    skippedDuplicate: result?.skippedDuplicateCount ?? 0,
    skippedStale: result?.skippedStaleCount ?? 0,
    skippedNoProfileWorthyDelta: result?.skippedNoProfileWorthyDeltaCount ?? 0,
  });
}
