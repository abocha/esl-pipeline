// packages/batch-backend/src/application/get-job-status.ts
// Application service for fetching job status by ID.
import { getJobById } from '../domain/job-repository.js';
import { type JobStatusDto, jobRecordToDto } from './job-dto.js';
import { detectJobPronunciationMode } from './job-pronunciation-mode.js';
import { getTypedJobPublication } from './job-publication.js';

export type GetJobStatusResponse = JobStatusDto;

// getJobStatus.declaration()
export async function getJobStatus(jobId: string): Promise<GetJobStatusResponse | null> {
  if (!jobId) return null;

  const job = await getJobById(jobId);
  if (!job) return null;

  const dto = jobRecordToDto(job);
  const typed = await getTypedJobPublication(job);
  if (typed) return { ...dto, ...typed };
  const pronunciationMode = await detectJobPronunciationMode({
    md: job.md,
    mdStorageUri: job.mdStorageUri ?? null,
  });
  return {
    ...dto,
    pronunciationMode,
  };
}
