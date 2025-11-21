// packages/batch-backend/src/application/job-dto.ts
//
// Shared helpers for serializing JobRecord data into the public HTTP/SSE DTO.
import type { JobStatusDto } from '@esl-pipeline/contracts';

import type { JobRecord } from '../domain/job-model.js';

export function jobRecordToDto(job: JobRecord): JobStatusDto {
  return {
    jobId: job.id,
    md: job.md,
    preset: job.preset ?? null,
    withTts: job.withTts ?? null,
    voiceId: job.voiceId ?? null,
    upload: job.upload ?? null,
    voiceAccent: job.voiceAccent ?? null,
    forceTts: job.forceTts ?? null,
    notionDatabase: job.notionDatabase ?? null,
    mode: job.mode ?? null,
    notionUrl: job.notionUrl ?? null,
    state: job.state,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    error: job.error ?? null,
    manifestPath: job.manifestPath ?? null,
  };
}

export { type JobStatusDto } from '@esl-pipeline/contracts';
