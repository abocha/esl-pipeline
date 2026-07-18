import type {
  ConfirmAssignmentSessionShareRequest,
  ConfirmAssignmentSessionShareResponse,
  JobConfigOverrides,
} from '@esl-pipeline/contracts';

import {
  AssignmentSessionRepositoryError,
  AssignmentSessionShareError,
  completeAssignmentShare,
  getAssignmentShareJob,
  getAssignmentSessionByIdForUser,
  reserveAssignmentShare,
} from '../domain/assignment-session-repository.js';
import { publishJobEvent } from '../domain/job-events.js';
import {
  approveAssignmentShareJob,
  resetFailedAssignmentShareJob,
} from '../domain/job-repository.js';
import { createJobQueue } from '../infrastructure/queue-bullmq.js';
import { toAssignmentSessionDto } from './assignment-sessions.js';
import { resolveApprovalJobConfig } from './create-approval-job.js';
import { jobRecordToDto } from './job-dto.js';
import { materializeDraft } from './materialize-draft.js';

type ShareCheckpoint = 'reservation' | 'materialization' | 'approval' | 'enqueue' | 'confirmation';

export interface ShareAssignmentSessionDependencies {
  sessions: {
    getByIdForUser: typeof getAssignmentSessionByIdForUser;
    getShareJob: typeof getAssignmentShareJob;
    reserveShare: typeof reserveAssignmentShare;
    completeShare: typeof completeAssignmentShare;
  };
  jobs: {
    approve: typeof approveAssignmentShareJob;
    resetFailedShare: typeof resetFailedAssignmentShareJob;
  };
  queue: { reconcile: ReturnType<typeof createJobQueue>['reconcile'] };
  resolveJobConfig: typeof resolveApprovalJobConfig;
  materialize: typeof materializeDraft;
  publishEvent: typeof publishJobEvent;
  checkpoint: (checkpoint: ShareCheckpoint) => void | Promise<void>;
}

export async function shareAssignmentSession(args: {
  userId: string;
  sessionId: string;
  request: ConfirmAssignmentSessionShareRequest;
  overrides?: Partial<ShareAssignmentSessionDependencies>;
}): Promise<ConfirmAssignmentSessionShareResponse> {
  const sessions = args.overrides?.sessions ?? {
    getByIdForUser: getAssignmentSessionByIdForUser,
    getShareJob: getAssignmentShareJob,
    reserveShare: reserveAssignmentShare,
    completeShare: completeAssignmentShare,
  };
  const jobs = args.overrides?.jobs ?? {
    approve: approveAssignmentShareJob,
    resetFailedShare: resetFailedAssignmentShareJob,
  };
  const queue = args.overrides?.queue ?? createJobQueue();
  const resolveJobConfig = args.overrides?.resolveJobConfig ?? resolveApprovalJobConfig;
  const materialize = args.overrides?.materialize ?? materializeDraft;
  const publishEvent = args.overrides?.publishEvent ?? publishJobEvent;
  const checkpoint = args.overrides?.checkpoint ?? (() => undefined);

  const before = await sessions.getByIdForUser(args.sessionId, args.userId);
  if (!before) throw new AssignmentSessionRepositoryError('ASSIGNMENT_SESSION_NOT_FOUND');
  const jobConfig = await resolveJobConfig({
    userId: args.userId,
    jobOverrides: sessionJobOverrides(before),
  });
  const reserved = await sessions.reserveShare({
    sessionId: args.sessionId,
    userId: args.userId,
    expectedRevision: args.request.expectedRevision,
    requestId: args.request.requestId,
    jobConfig,
  });
  if (reserved.created) publishEvent({ type: 'job_created', job: reserved.job });
  await checkpoint('reservation');

  const create = reserved.session.confirmed.create;
  if (!create) throw new AssignmentSessionShareError('ASSIGNMENT_SHARE_PREREQUISITE_MISSING');
  let job = reserved.job;

  if (job.state === 'awaiting_approval') {
    const materialized = await materialize({
      draftId: create.draftId,
      jobId: job.id,
      sourceStorageUri: create.draftStorageUri,
      expectedContentHash: create.draftHash,
      assignmentShare: { sessionId: args.sessionId, userId: args.userId },
    });
    if (!materialized) {
      const current = await sessions.getShareJob({
        sessionId: args.sessionId,
        userId: args.userId,
        jobId: job.id,
      });
      if (!current || current.state === 'awaiting_approval') {
        throw new AssignmentSessionShareError('ASSIGNMENT_SHARE_JOB_INTEGRITY_INVALID');
      }
      job = current;
    } else {
      job = await sessions.getShareJob({
        sessionId: args.sessionId,
        userId: args.userId,
        jobId: job.id,
      });
    }
    await checkpoint('materialization');
  }

  if (job.state === 'awaiting_approval') {
    const approved = await jobs.approve({
      id: job.id,
      sessionId: args.sessionId,
      userId: args.userId,
      expectedState: 'awaiting_approval',
      mdStorageUri: create.draftStorageUri,
    });
    if (approved) {
      job = approved;
      publishEvent({ type: 'job_state_changed', job });
    } else {
      const current = await sessions.getShareJob({
        sessionId: args.sessionId,
        userId: args.userId,
        jobId: job.id,
      });
      if (!current) {
        throw new AssignmentSessionShareError('ASSIGNMENT_SHARE_JOB_INTEGRITY_INVALID');
      }
      job = current;
    }
    await checkpoint('approval');
  }

  if (job.state === 'failed') {
    const reset = await jobs.resetFailedShare({
      sessionId: args.sessionId,
      userId: args.userId,
      jobId: job.id,
    });
    job =
      reset ??
      (await sessions.getShareJob({
        sessionId: args.sessionId,
        userId: args.userId,
        jobId: job.id,
      }));
  }

  job = await sessions.getShareJob({
    sessionId: args.sessionId,
    userId: args.userId,
    jobId: job.id,
  });
  let enqueueSatisfied = false;
  if (job.state === 'queued') {
    await queue.reconcile({ jobId: job.id });
    enqueueSatisfied = true;
    await checkpoint('enqueue');
  } else if (job.state === 'running' || job.state === 'succeeded') {
    enqueueSatisfied = true;
  } else {
    throw new AssignmentSessionShareError('ASSIGNMENT_SHARE_JOB_INTEGRITY_INVALID');
  }

  const session = await sessions.completeShare({
    sessionId: args.sessionId,
    userId: args.userId,
    jobId: job.id,
    enqueueSatisfied,
  });
  job = await sessions.getShareJob({
    sessionId: args.sessionId,
    userId: args.userId,
    jobId: job.id,
  });
  await checkpoint('confirmation');
  return { session: toAssignmentSessionDto(session), job: jobRecordToDto(job) };
}

function sessionJobOverrides(
  session: Awaited<ReturnType<typeof getAssignmentSessionByIdForUser>>,
): JobConfigOverrides {
  if (!session) return {};
  return {
    ...(session.selectedPreset ? { learningPresetId: session.selectedPreset } : {}),
    ...(session.publishTarget ? { publishTarget: session.publishTarget } : {}),
    ...(session.selectedTtsStrategy ? { ttsStrategy: session.selectedTtsStrategy } : {}),
    ...(session.selectedTtsProvider ? { ttsProvider: session.selectedTtsProvider } : {}),
    ...(session.selectedTtsModel ? { ttsModel: session.selectedTtsModel as never } : {}),
  };
}
