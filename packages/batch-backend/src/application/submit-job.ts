// packages/batch-backend/src/application/submit-job.ts
//
// Application service for submitting a new ESL pipeline job.
// - Validates input.
// - Persists a queued job via JobRepository.
// - Enqueues a BullMQ job via createJobQueue.
import { publishJobEvent } from '../domain/job-events.js';
import type { TtsStrategy as DomainTtsStrategy } from '../domain/job-model.js';
import { insertJob } from '../domain/job-repository.js';
import { logger } from '../infrastructure/logger.js';
import { createJobQueue } from '../infrastructure/queue-bullmq.js';
import { buildLearningPresetProvenance, normalizeLearningPresetId } from './learning-preset.js';
import { collectPublishStudyTextOverrideIssues } from './publish-study-text-overrides.js';

export type UploadTarget = 'auto' | 's3' | 'none';
export type TtsStrategy = DomainTtsStrategy;
export type TtsProvider = 'elevenlabs' | 'google';
export type GoogleTtsModel = 'chirp3_hd' | 'studio' | 'neural2' | 'wavenet';
export type ElevenLabsTtsModelId =
  | 'eleven_v3'
  | 'eleven_multilingual_v2'
  | 'eleven_flash_v2_5'
  | 'eleven_flash_v2';

export interface SubmitJobRequest {
  md: string;
  learningPresetId?: string;
  withTts?: boolean;
  upload?: UploadTarget;
  voiceId?: string;
  voiceAccent?: string;
  forceTts?: boolean;
  publishTarget?: 'html';
  ttsStrategy?: TtsStrategy;
  ttsProvider?: TtsProvider;
  studyTextElevenlabsModel?: ElevenLabsTtsModelId;
  googleTtsModel?: GoogleTtsModel;
  userId?: string;
  autoPublish?: boolean;
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
  if (!hasMd) {
    throw new ValidationError('md is required', 'md_required');
  }

  if (
    req.learningPresetId !== undefined &&
    (typeof req.learningPresetId !== 'string' || req.learningPresetId.trim().length === 0)
  ) {
    throw new ValidationError(
      'learningPresetId must be a non-empty string when provided',
      'invalid_learning_preset',
    );
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

  if (req.publishTarget !== undefined && req.publishTarget !== 'html') {
    throw new ValidationError(
      'publishTarget must be "html" when provided',
      'invalid_publish_target',
    );
  }

  if (req.ttsStrategy && !['auto', 'dialogue', 'tts'].includes(req.ttsStrategy)) {
    throw new ValidationError(
      'ttsStrategy must be auto, dialogue, or tts when provided',
      'invalid_tts_strategy',
    );
  }

  if (req.ttsProvider && !['elevenlabs', 'google'].includes(req.ttsProvider)) {
    throw new ValidationError(
      'ttsProvider must be elevenlabs or google when provided',
      'invalid_tts_provider',
    );
  }

  if (
    req.googleTtsModel &&
    !['chirp3_hd', 'studio', 'neural2', 'wavenet'].includes(req.googleTtsModel)
  ) {
    throw new ValidationError(
      'googleTtsModel must be chirp3_hd, studio, neural2, or wavenet when provided',
      'invalid_google_tts_model',
    );
  }

  if (
    req.studyTextElevenlabsModel &&
    !['eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_flash_v2'].includes(
      req.studyTextElevenlabsModel,
    )
  ) {
    throw new ValidationError(
      'studyTextElevenlabsModel must be eleven_v3, eleven_multilingual_v2, eleven_flash_v2_5, or eleven_flash_v2 when provided',
      'invalid_study_text_elevenlabs_model',
    );
  }

  const publishStudyTextIssues = collectPublishStudyTextOverrideIssues({
    ttsStrategy: req.ttsStrategy,
    ttsProvider: req.ttsProvider,
    studyTextElevenlabsModel: req.studyTextElevenlabsModel,
    googleTtsModel: req.googleTtsModel,
  });
  if (publishStudyTextIssues.length > 0) {
    const issue = publishStudyTextIssues[0];
    if (issue) {
      throw new ValidationError(issue.message, issue.code);
    }
  }
}

// submitJob.declaration()
// Throws ValidationError for invalid input; other errors are operational.
export async function submitJob(req: SubmitJobRequest): Promise<SubmitJobResponse> {
  validateSubmitJobRequest(req);
  const learningPresetId = normalizeLearningPresetId({
    learningPresetId: req.learningPresetId,
  });
  const provenance = buildLearningPresetProvenance(learningPresetId);

  const job = await insertJob({
    md: req.md,
    learningPresetId: provenance.learningPresetId,
    learningPresetVersion: provenance.learningPresetVersion,
    promptSnapshotVersion: provenance.promptSnapshotVersion,
    promptAlias: provenance.promptAlias,
    withTts: req.withTts,
    // Persist explicit upload choice for observability; downstream decides how to interpret.
    upload: req.upload,
    voiceId: req.voiceId,
    voiceAccent: req.voiceAccent,
    forceTts: req.forceTts,
    publishTarget: req.publishTarget ?? 'html',
    ttsStrategy: req.ttsStrategy,
    ttsProvider: req.ttsProvider,
    studyTextElevenlabsModel: req.studyTextElevenlabsModel,
    googleTtsModel: req.googleTtsModel,
    userId: req.userId,
    autoPublish: req.autoPublish,
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
