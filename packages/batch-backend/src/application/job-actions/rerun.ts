import { z } from 'zod';

import type { JobActionResult, RerunAction } from '../../domain/job-actions.js';
import { JobActionType } from '../../domain/job-actions.js';
import { publishJobEvent } from '../../domain/job-events.js';
import { getJobById, insertJob } from '../../domain/job-repository.js';
import { createJobQueue } from '../../infrastructure/queue-bullmq.js';

const elevenLabsModelSchema = z.enum([
  'eleven_v3',
  'eleven_multilingual_v2',
  'eleven_flash_v2_5',
  'eleven_flash_v2',
]);

const rerunSchema = z
  .object({
    republishOnly: z.boolean().optional(),
    regenerateStudyTextAudio: z.boolean().optional(),
    regeneratePronunciationMainAudio: z.boolean().optional(),
    regeneratePronunciationChunkAudio: z.boolean().optional(),
    studyTextTtsProvider: z.enum(['elevenlabs', 'google']).optional(),
    studyTextElevenlabsModel: elevenLabsModelSchema.optional(),
    studyTextGoogleTtsModel: z.enum(['chirp3_hd', 'studio', 'neural2', 'wavenet']).optional(),
    studyTextVoiceId: z.string().min(1).optional(),
    studyTextVoiceAccent: z.string().min(1).optional(),
    studyTextTtsStrategy: z.enum(['auto', 'dialogue', 'tts']).optional(),
    studyTextDialogueLanguage: z.string().min(1).optional(),
    studyTextDialogueStability: z.number().min(0).max(1).optional(),
    studyTextDialogueSeed: z.number().int().optional(),
    pronunciationMainTtsProvider: z.enum(['elevenlabs', 'google']).optional(),
    pronunciationMainElevenlabsModel: elevenLabsModelSchema.optional(),
    pronunciationMainGoogleTtsModel: z.enum(['chirp3_hd', 'studio', 'neural2', 'wavenet']).optional(),
    pronunciationMainVoiceId: z.string().min(1).optional(),
    pronunciationMainVoiceAccent: z.string().min(1).optional(),
    pronunciationChunkTtsProvider: z.enum(['edge-tts', 'elevenlabs', 'google']).optional(),
    pronunciationChunkElevenlabsModel: elevenLabsModelSchema.optional(),
    pronunciationChunkGoogleTtsModel: z.enum(['chirp3_hd', 'studio', 'neural2', 'wavenet']).optional(),
    pronunciationChunkVoiceId: z.string().min(1).optional(),
    pronunciationChunkVoiceAccent: z.string().min(1).optional(),
    pronunciationChunkEdgeVoice: z.string().min(1).optional(),
  })
  .superRefine((payload, ctx) => {
    const republishOnly = payload.republishOnly === true;
    const regenerateCount = [
      payload.regenerateStudyTextAudio,
      payload.regeneratePronunciationMainAudio,
      payload.regeneratePronunciationChunkAudio,
    ].filter(Boolean).length;

    if (republishOnly && regenerateCount > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Republish-only cannot be combined with regeneration targets.',
      });
    }

    if (!republishOnly && regenerateCount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Select republish-only or at least one of study-text, pronunciation main, or pronunciation chunk regeneration.',
      });
    }

    if (
      payload.studyTextTtsProvider === 'elevenlabs' &&
      payload.studyTextTtsStrategy === 'auto' &&
      payload.studyTextElevenlabsModel !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['studyTextElevenlabsModel'],
        message: 'Automatic ElevenLabs study-text reruns must use strategy-default model selection.',
      });
    }

    if (
      payload.studyTextTtsProvider === 'elevenlabs' &&
      payload.studyTextElevenlabsModel === 'eleven_v3' &&
      payload.studyTextTtsStrategy !== 'dialogue'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['studyTextElevenlabsModel'],
        message: 'eleven_v3 is only valid for ElevenLabs dialogue study-text reruns.',
      });
    }

    if (
      payload.studyTextTtsProvider === 'elevenlabs' &&
      payload.studyTextTtsStrategy === 'dialogue' &&
      payload.studyTextElevenlabsModel !== undefined &&
      payload.studyTextElevenlabsModel !== 'eleven_v3'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['studyTextElevenlabsModel'],
        message: 'Dialogue study-text reruns only support eleven_v3.',
      });
    }

    if (payload.pronunciationMainElevenlabsModel === 'eleven_v3') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pronunciationMainElevenlabsModel'],
        message: 'eleven_v3 cannot be used for pronunciation main synthesis.',
      });
    }

    if (payload.pronunciationChunkElevenlabsModel === 'eleven_v3') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pronunciationChunkElevenlabsModel'],
        message: 'eleven_v3 cannot be used for pronunciation chunk synthesis.',
      });
    }
  });

function describeRerunMessage(payload: z.infer<typeof rerunSchema>): string {
  if (payload.republishOnly) {
    return 'Republish queued';
  }

  const labels: string[] = [];
  if (payload.regenerateStudyTextAudio) labels.push('study-text audio');
  if (payload.regeneratePronunciationMainAudio) labels.push('main pronunciation audio');
  if (payload.regeneratePronunciationChunkAudio) labels.push('pronunciation chunk audio');
  return `Rerun queued (${labels.join(', ')})`;
}

function collectEffectiveValidationErrors(
  payload: z.infer<typeof rerunSchema>,
  job: Awaited<ReturnType<typeof getJobById>>,
): Array<{ path: (string | number)[]; message: string }> {
  const issues: Array<{ path: (string | number)[]; message: string }> = [];
  const effectiveStudyTextProvider = payload.studyTextTtsProvider ?? job?.ttsProvider ?? undefined;
  const effectiveStudyTextStrategy = payload.studyTextTtsStrategy ?? job?.ttsStrategy ?? undefined;
  const explicitStudyTextModel = payload.studyTextElevenlabsModel;

  if (
    effectiveStudyTextProvider === 'elevenlabs' &&
    effectiveStudyTextStrategy === 'auto' &&
    explicitStudyTextModel !== undefined
  ) {
    issues.push({
      path: ['studyTextElevenlabsModel'],
      message: 'Automatic ElevenLabs study-text reruns must use strategy-default model selection.',
    });
  }

  if (
    effectiveStudyTextProvider === 'elevenlabs' &&
    explicitStudyTextModel === 'eleven_v3' &&
    effectiveStudyTextStrategy !== 'dialogue'
  ) {
    issues.push({
      path: ['studyTextElevenlabsModel'],
      message: 'eleven_v3 is only valid for ElevenLabs dialogue study-text reruns.',
    });
  }

  if (
    effectiveStudyTextProvider === 'elevenlabs' &&
    effectiveStudyTextStrategy === 'dialogue' &&
    explicitStudyTextModel !== undefined &&
    explicitStudyTextModel !== 'eleven_v3'
  ) {
    issues.push({
      path: ['studyTextElevenlabsModel'],
      message: 'Dialogue study-text reruns only support eleven_v3.',
    });
  }

  return issues;
}

export async function rerun(jobId: string, action: RerunAction): Promise<JobActionResult> {
  const job = await getJobById(jobId);
  if (!job) {
    return {
      success: false,
      message: 'Job not found',
      jobId,
      actionType: JobActionType.RERUN,
      timestamp: new Date(),
      error: 'not_found',
    };
  }

  if (job.state !== 'succeeded') {
    return {
      success: false,
      message: 'Rerun is only available for succeeded jobs',
      jobId,
      actionType: JobActionType.RERUN,
      timestamp: new Date(),
      error: 'invalid_state',
    };
  }

  if (!job.md) {
    return {
      success: false,
      message: 'Job is missing markdown path; cannot rerun',
      jobId,
      actionType: JobActionType.RERUN,
      timestamp: new Date(),
      error: 'validation_failed',
    };
  }

  const parsed = rerunSchema.safeParse(action.payload ?? {});
  if (!parsed.success) {
    return {
      success: false,
      message: 'Invalid rerun payload',
      jobId,
      actionType: JobActionType.RERUN,
      timestamp: new Date(),
      error: 'validation_failed',
    };
  }

  const payload = parsed.data;
  const effectiveValidationErrors = collectEffectiveValidationErrors(payload, job);
  if (effectiveValidationErrors.length > 0) {
    return {
      success: false,
      message: effectiveValidationErrors[0]!.message,
      jobId,
      actionType: JobActionType.RERUN,
      timestamp: new Date(),
      error: 'validation_failed',
    };
  }

  const rerunJob = await insertJob({
    md: job.md,
    mdStorageUri: job.mdStorageUri ?? undefined,
    preset: job.preset ?? undefined,
    withTts: payload.republishOnly ? (job.withTts ?? true) : true,
    upload: 's3',
    voiceId:
      payload.studyTextVoiceId ??
      payload.pronunciationMainVoiceId ??
      payload.pronunciationChunkVoiceId ??
      job.voiceId ??
      undefined,
    voiceAccent:
      payload.studyTextVoiceAccent ??
      payload.pronunciationMainVoiceAccent ??
      payload.pronunciationChunkVoiceAccent ??
      job.voiceAccent ??
      undefined,
    forceTts: payload.republishOnly ? false : true,
    notionDatabase: job.notionDatabase ?? undefined,
    publishTarget: job.publishTarget ?? undefined,
    ttsStrategy: payload.studyTextTtsStrategy ?? job.ttsStrategy ?? undefined,
    ttsProvider:
      payload.studyTextTtsProvider ??
      payload.pronunciationMainTtsProvider ??
      (payload.pronunciationChunkTtsProvider === 'elevenlabs' ||
      payload.pronunciationChunkTtsProvider === 'google'
        ? payload.pronunciationChunkTtsProvider
        : undefined) ??
      job.ttsProvider ??
      undefined,
    googleTtsModel:
      payload.studyTextGoogleTtsModel ??
      payload.pronunciationMainGoogleTtsModel ??
      payload.pronunciationChunkGoogleTtsModel ??
      job.googleTtsModel ??
      undefined,
    userId: job.userId ?? undefined,
    autoPublish: job.autoPublish ?? undefined,
    sourceJobId: jobId,
  });

  publishJobEvent({ type: 'job_created', job: rerunJob });

  const { enqueue } = createJobQueue();
  await enqueue({
    jobId: rerunJob.id,
    executionMode: 'rerun',
    sourceJobId: jobId,
    rerun: {
      manifestMd: job.md,
      republishOnly: payload.republishOnly ?? false,
      regenerateStudyTextAudio: payload.regenerateStudyTextAudio ?? false,
      regeneratePronunciationMainAudio: payload.regeneratePronunciationMainAudio ?? false,
      regeneratePronunciationChunkAudio: payload.regeneratePronunciationChunkAudio ?? false,
      studyTextVoiceAccent: payload.studyTextVoiceAccent ?? job.voiceAccent ?? undefined,
      studyTextVoiceId: payload.studyTextVoiceId ?? job.voiceId ?? undefined,
      studyTextTtsProvider: payload.studyTextTtsProvider ?? job.ttsProvider ?? undefined,
      studyTextElevenlabsModel: payload.studyTextElevenlabsModel,
      studyTextGoogleTtsModel: payload.studyTextGoogleTtsModel ?? job.googleTtsModel ?? undefined,
      studyTextTtsStrategy: payload.studyTextTtsStrategy ?? job.ttsStrategy ?? undefined,
      studyTextDialogueLanguage: payload.studyTextDialogueLanguage,
      studyTextDialogueStability: payload.studyTextDialogueStability,
      studyTextDialogueSeed: payload.studyTextDialogueSeed,
      pronunciationMainVoiceAccent: payload.pronunciationMainVoiceAccent ?? undefined,
      pronunciationMainVoiceId: payload.pronunciationMainVoiceId ?? undefined,
      pronunciationMainTtsProvider: payload.pronunciationMainTtsProvider ?? undefined,
      pronunciationMainElevenlabsModel: payload.pronunciationMainElevenlabsModel,
      pronunciationMainGoogleTtsModel: payload.pronunciationMainGoogleTtsModel,
      pronunciationChunkVoiceAccent: payload.pronunciationChunkVoiceAccent ?? undefined,
      pronunciationChunkVoiceId: payload.pronunciationChunkVoiceId ?? undefined,
      pronunciationChunkTtsProvider: payload.pronunciationChunkTtsProvider ?? undefined,
      pronunciationChunkElevenlabsModel: payload.pronunciationChunkElevenlabsModel,
      pronunciationChunkGoogleTtsModel: payload.pronunciationChunkGoogleTtsModel,
      pronunciationChunkEdgeVoice: payload.pronunciationChunkEdgeVoice,
    },
  });

  return {
    success: true,
    message: describeRerunMessage(payload),
    jobId: rerunJob.id,
    actionType: JobActionType.RERUN,
    timestamp: new Date(),
  };
}
