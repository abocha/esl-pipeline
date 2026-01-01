import type { DraftRecord } from '../domain/draft-model.js';
import { publishJobEvent } from '../domain/job-events.js';
import type { JobRecord } from '../domain/job-model.js';
import { insertApprovalJob } from '../domain/job-repository.js';
import type { PromptPackageRecord } from '../domain/prompt-package-model.js';

export interface CreateApprovalJobParams {
  draft: DraftRecord;
  promptPackage: PromptPackageRecord;
}

export interface CreateApprovalJobDependencies {
  jobs: {
    insertApprovalJob: typeof insertApprovalJob;
  };
  publishEvent: typeof publishJobEvent;
}

export async function createApprovalJobFromDraft(
  params: CreateApprovalJobParams,
  overrides?: Partial<CreateApprovalJobDependencies>,
): Promise<JobRecord> {
  const jobs = overrides?.jobs ?? { insertApprovalJob };
  const publishEvent = overrides?.publishEvent ?? publishJobEvent;

  const job = await jobs.insertApprovalJob({
    recordingId: params.promptPackage.recordingId,
    transcriptId: params.promptPackage.transcriptId,
    promptPackageId: params.promptPackage.id,
    draftId: params.draft.id,
    promptNotes: params.promptPackage.notes ?? null,
    profilePath: params.promptPackage.profilePath ?? null,
    userId: params.draft.createdBy ?? undefined,
  });

  publishEvent({ type: 'job_created', job });

  return job;
}
