// packages/batch-backend/src/application/job-dto.ts
//
// Shared helpers for serializing JobRecord data into the public HTTP/SSE DTO.

import type { JobRecord } from '../domain/job-model';

export interface JobStatusDto {
  jobId: string;
  md: string;
  preset: string | null;
  withTts: boolean | null;
  upload: string | null;
  state: JobRecord['state'];
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  manifestPath: string | null;
}

export function jobRecordToDto(job: JobRecord): JobStatusDto {
  return {
    jobId: job.id,
    md: job.md,
    preset: job.preset ?? null,
    withTts: job.withTts ?? null,
    upload: job.upload ?? null,
    state: job.state,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    error: job.error ?? null,
    manifestPath: job.manifestPath ?? null,
  };
}
