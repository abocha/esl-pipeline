// packages/batch-backend/src/application/get-job-status.ts
// Application service for fetching job status by ID.
import { getJobById } from '../domain/job-repository.js';
import { detectJobPronunciationMode } from './job-pronunciation-mode.js';
import { type JobStatusDto, jobRecordToDto } from './job-dto.js';

export type GetJobStatusResponse = JobStatusDto;

// getJobStatus.declaration()
export async function getJobStatus(jobId: string): Promise<GetJobStatusResponse | null> {
  if (!jobId) return null;

  const job = await getJobById(jobId);
  if (!job) return null;

  const dto = jobRecordToDto(job);
  const pronunciationMode = await detectJobPronunciationMode({
    md: job.md,
    mdStorageUri: job.mdStorageUri ?? null,
  });
  return {
    ...dto,
    pronunciationMode,
  };
}
