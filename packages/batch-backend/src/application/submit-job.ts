// packages/batch-backend/src/application/submit-job.ts
//
// Application service for submitting a new ESL pipeline job.
// - Validates input.
// - Persists a queued job via JobRepository.
// - Enqueues a BullMQ job via createJobQueue.
import { publishJobEvent } from '../domain/job-events.js';
import { loadConfig } from '../config/env.js';
import type { TtsStrategy as DomainTtsStrategy } from '../domain/job-model.js';
import { insertJob } from '../domain/job-repository.js';
import { logger } from '../infrastructure/logger.js';
import { createJobQueue } from '../infrastructure/queue-bullmq.js';
import { ProfilePathError, resolveProfileRoot, resolveUserProfilePath } from './profile-path.js';

export type UploadTarget = 'auto' | 's3' | 'none';
export type TtsStrategy = DomainTtsStrategy;

export interface SubmitJobRequest {
  md?: string | null;
  transcribeWorkdir?: string;
  promptNotes?: string;
  profilePath?: string;
  preset?: string;
  withTts?: boolean;
  upload?: UploadTarget;
  voiceId?: string;
  voiceAccent?: string;
  forceTts?: boolean;
  notionDatabase?: string;
  ttsStrategy?: TtsStrategy;
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

  const hasMd = typeof req.md === 'string' && req.md.trim().length > 0;
  const hasTranscribeWorkdir =
    typeof req.transcribeWorkdir === 'string' && req.transcribeWorkdir.trim().length > 0;

  if (!hasMd && !hasTranscribeWorkdir) {
    throw new ValidationError('md or transcribeWorkdir is required', 'md_or_transcribe_required');
  }

  if (hasMd && hasTranscribeWorkdir) {
    throw new ValidationError(
      'Provide either md or transcribeWorkdir, not both',
      'md_and_transcribe_conflict',
    );
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

  if (req.ttsStrategy && !['auto', 'dialogue', 'tts'].includes(req.ttsStrategy)) {
    throw new ValidationError(
      'ttsStrategy must be auto, dialogue, or tts when provided',
      'invalid_tts_strategy',
    );
  }

  if (req.transcribeWorkdir !== undefined && typeof req.transcribeWorkdir !== 'string') {
    throw new ValidationError(
      'transcribeWorkdir must be a string when provided',
      'invalid_transcribe_workdir',
    );
  }

  if (req.promptNotes !== undefined && typeof req.promptNotes !== 'string') {
    throw new ValidationError('promptNotes must be a string when provided', 'invalid_prompt_notes');
  }

  if (req.profilePath !== undefined && typeof req.profilePath !== 'string') {
    throw new ValidationError('profilePath must be a string when provided', 'invalid_profile_path');
  }
  if (typeof req.profilePath === 'string' && req.profilePath.trim().length === 0) {
    throw new ValidationError(
      'profilePath must be a non-empty string when provided',
      'invalid_profile_path',
    );
  }
}

// submitJob.declaration()
// Throws ValidationError for invalid input; other errors are operational.
export async function submitJob(req: SubmitJobRequest): Promise<SubmitJobResponse> {
  validateSubmitJobRequest(req);

  const profilePath = req.profilePath?.trim();
  if (profilePath) {
    const config = loadConfig();
    const profileRoot = await resolveProfileRoot(config.prompt.defaultProfilePath);
    try {
      await resolveUserProfilePath(profilePath, profileRoot);
    } catch (error) {
      if (error instanceof ProfilePathError) {
        throw new ValidationError(error.message, error.code);
      }
      throw error;
    }
  }

  const job = await insertJob({
    md: req.md ?? null,
    transcribeWorkdir: req.transcribeWorkdir ?? null,
    promptNotes: req.promptNotes ?? null,
    profilePath: profilePath ?? null,
    preset: req.preset,
    withTts: req.withTts,
    // Persist explicit upload choice for observability; downstream decides how to interpret.
    upload: req.upload,
    voiceId: req.voiceId,
    voiceAccent: req.voiceAccent,
    forceTts: req.forceTts,
    notionDatabase: req.notionDatabase,
    ttsStrategy: req.ttsStrategy,
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
