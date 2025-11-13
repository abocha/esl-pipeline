// packages/batch-backend/src/application/get-job-status.ts

// Application service for fetching job status by ID.

import { getJobById } from '../domain/job-repository';

export interface GetJobStatusResponse {
  jobId: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
  manifestPath?: string | null;
}

// getJobStatus.declaration()
export async function getJobStatus(jobId: string): Promise<GetJobStatusResponse | null> {
  if (!jobId) return null;

  const job = await getJobById(jobId);
  if (!job) return null;

  return {
    jobId: job.id,
    state: job.state,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    error: job.error ?? null,
    manifestPath: job.manifestPath ?? null,
  };
}
