import type {
  PublishAssignmentCorrectionRequest,
  PublishAssignmentCorrectionResponse,
} from '@esl-pipeline/contracts';

import {
  type PublishAssignmentCorrectionJobResult,
  publishAssignmentCorrectionJob,
} from '../domain/assignment-session-repository.js';
import { publishJobEvent } from '../domain/job-events.js';
import { createJobQueue } from '../infrastructure/queue-bullmq.js';
import { jobRecordToDto } from './job-dto.js';

export interface PublishAssignmentCorrectionDependencies {
  corrections: {
    publish: typeof publishAssignmentCorrectionJob;
  };
  queue: { reconcile: ReturnType<typeof createJobQueue>['reconcile'] };
  publishEvent: typeof publishJobEvent;
}

export async function publishAssignmentCorrection(args: {
  userId: string;
  publishedJobId: string;
  request: PublishAssignmentCorrectionRequest;
  overrides?: Partial<PublishAssignmentCorrectionDependencies>;
}): Promise<PublishAssignmentCorrectionResponse> {
  const corrections = args.overrides?.corrections ?? {
    publish: publishAssignmentCorrectionJob,
  };
  const queue = args.overrides?.queue ?? createJobQueue();
  const publishEvent = args.overrides?.publishEvent ?? publishJobEvent;

  const reserved: PublishAssignmentCorrectionJobResult = await corrections.publish({
    userId: args.userId,
    publishedJobId: args.publishedJobId,
    request: args.request,
  });
  if (reserved.created) publishEvent({ type: 'job_created', job: reserved.job });

  if (reserved.job.state === 'queued') {
    await queue.reconcile({
      jobId: reserved.job.id,
      executionMode: 'correction',
      sourceJobId: args.publishedJobId,
      correction: {
        ...(reserved.job.assignmentArtifact
          ? { expectedAssignmentHash: reserved.job.assignmentArtifact.contentHash }
          : { expectedMarkdownHash: args.request.draftHash }),
        manifestMd: `corrections/${reserved.job.id}.md`,
      },
    });
  } else if (reserved.job.state !== 'running' && reserved.job.state !== 'succeeded') {
    throw new Error('Correction reservation did not produce a queueable job');
  }

  return { job: jobRecordToDto(reserved.job) };
}
