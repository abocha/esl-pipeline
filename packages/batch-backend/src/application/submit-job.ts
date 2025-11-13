// packages/batch-backend/src/application/submit-job.ts
//
// Application service for submitting a new ESL pipeline job.
// - Validates input.
// - Persists a queued job via JobRepository.
// - Enqueues a BullMQ job via createJobQueue.

import { insertJob } from '../domain/job-repository';
import { createJobQueue } from '../infrastructure/queue-bullmq';
import { logger } from '../infrastructure/logger';

export type UploadTarget = 's3' | 'none';

export interface SubmitJobRequest {
  md: string;
  preset?: string;
  withTts?: boolean;
  upload?: UploadTarget;
}

export interface SubmitJobResponse {
  jobId: string;
}

export class ValidationError extends Error {
  readonly code: string;

  constructor(message: string, code = 'validation_failed') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

function validateSubmitJobRequest(req: SubmitJobRequest): void {
  if (!req || typeof req !== 'object') {
    throw new ValidationError('Body must be an object', 'invalid_body');
  }

  if (!req.md || typeof req.md !== 'string' || req.md.trim().length === 0) {
    throw new ValidationError('md is required', 'md_required');
  }

  if (
    req.preset !== undefined &&
    (typeof req.preset !== 'string' || req.preset.trim().length === 0)
  ) {
    throw new ValidationError('preset must be a non-empty string when provided', 'invalid_preset');
  }

  if (req.withTts !== undefined && typeof req.withTts !== 'boolean') {
    throw new ValidationError('withTts must be a boolean when provided', 'invalid_with_tts');
  }

  if (req.upload !== undefined && req.upload !== 's3' && req.upload !== 'none') {
    throw new ValidationError('upload must be "s3" or "none" when provided', 'invalid_upload');
  }
}

// submitJob.declaration()
// Throws ValidationError for invalid input; other errors are operational.
export async function submitJob(req: SubmitJobRequest): Promise<SubmitJobResponse> {
  validateSubmitJobRequest(req);

  const job = await insertJob({
    md: req.md,
    preset: req.preset,
    withTts: req.withTts,
    // Persist explicit upload choice for observability; downstream decides how to interpret.
    upload: req.upload,
  });

  const { enqueue } = createJobQueue();
  await enqueue({ jobId: job.id });

  logger.info('Job submitted and enqueued', {
    event: 'job_submitted',
    jobId: job.id,
  });

  return { jobId: job.id };
}
