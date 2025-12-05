// packages/batch-backend/src/application/submit-job.ts
//
// Application service for submitting a new ESL pipeline job.
// - Validates input.
// - Persists a queued job via JobRepository.
// - Enqueues a BullMQ job via createJobQueue.
import { publishJobEvent } from '../domain/job-events.js';
import type { JobMode as DomainJobMode } from '../domain/job-model.js';
import { insertJob } from '../domain/job-repository.js';
import { logger } from '../infrastructure/logger.js';
import { createJobQueue } from '../infrastructure/queue-bullmq.js';

export type UploadTarget = 'auto' | 's3' | 'none';
export type JobMode = DomainJobMode;

export interface SubmitJobRequest {
  md: string;
  preset?: string;
  withTts?: boolean;
  upload?: UploadTarget;
  voiceId?: string;
  voiceAccent?: string;
  forceTts?: boolean;
  notionDatabase?: string;
  mode?: JobMode;
  userId?: string;
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

  if (
    req.upload !== undefined &&
    req.upload !== 's3' &&
    req.upload !== 'none' &&
    req.upload !== 'auto'
  ) {
    throw new ValidationError(
      'upload must be "auto", "s3" or "none" when provided',
      'invalid_upload',
    );
  }

  if (
    req.voiceAccent !== undefined &&
    (typeof req.voiceAccent !== 'string' || req.voiceAccent.trim().length === 0)
  ) {
    throw new ValidationError(
      'voiceAccent must be a non-empty string when provided',
      'invalid_voice_accent',
    );
  }

  if (
    req.voiceId !== undefined &&
    (typeof req.voiceId !== 'string' || req.voiceId.trim().length === 0)
  ) {
    throw new ValidationError(
      'voiceId must be a non-empty string when provided',
      'invalid_voice_id',
    );
  }

  if (req.forceTts !== undefined && typeof req.forceTts !== 'boolean') {
    throw new ValidationError('forceTts must be a boolean when provided', 'invalid_force_tts');
  }

  if (
    req.notionDatabase !== undefined &&
    (typeof req.notionDatabase !== 'string' || req.notionDatabase.trim().length === 0)
  ) {
    throw new ValidationError(
      'notionDatabase must be a non-empty string when provided',
      'invalid_notion_database',
    );
  }

  if (req.mode && !['auto', 'dialogue', 'monologue'].includes(req.mode)) {
    throw new ValidationError(
      'mode must be auto, dialogue, or monologue when provided',
      'invalid_mode',
    );
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
    voiceId: req.voiceId,
    voiceAccent: req.voiceAccent,
    forceTts: req.forceTts,
    notionDatabase: req.notionDatabase,
    mode: req.mode,
    userId: req.userId,
  });

  publishJobEvent({ type: 'job_created', job });

  const { enqueue } = createJobQueue();
  await enqueue({ jobId: job.id });

  logger.info('Job submitted and enqueued', {
    event: 'job_submitted',
    jobId: job.id,
  });

  return { jobId: job.id };
}
