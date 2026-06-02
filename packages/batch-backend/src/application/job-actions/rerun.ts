import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { type AssignmentManifest, manifestPathFor } from '@esl-pipeline/orchestrator';
import { isTtsModelForProvider } from '@esl-pipeline/tts-core';

import type { JobActionResult, RerunAction } from '../../domain/job-actions.js';
import { JobActionType } from '../../domain/job-actions.js';
import { publishJobEvent } from '../../domain/job-events.js';
import type { TtsModelId, TtsProviderId } from '../../domain/job-model.js';
import { getJobById, insertJob } from '../../domain/job-repository.js';
import { createJobQueue } from '../../infrastructure/queue-bullmq.js';
import {
  collectPublishStudyTextOverrideIssues,
  publishTtsModelSchema,
} from '../publish-study-text-overrides.js';

type PronunciationManifestArtifacts = NonNullable<
  NonNullable<AssignmentManifest['audioArtifacts']>['pronunciation']
>;

const rerunSchema = z
  .object({
    republishOnly: z.boolean().optional(),
    regenerateStudyTextAudio: z.boolean().optional(),
    regeneratePronunciationMainAudio: z.boolean().optional(),
    regeneratePronunciationChunkAudio: z.boolean().optional(),
    studyTextTtsProvider: z.enum(['elevenlabs', 'google', 'inworld']).optional(),
    studyTextTtsModel: publishTtsModelSchema.optional(),
    studyTextVoiceId: z.string().min(1).optional(),
    studyTextVoiceAccent: z.string().min(1).optional(),
    studyTextTtsStrategy: z.enum(['auto', 'dialogue', 'tts']).optional(),
    studyTextDialogueLanguage: z.string().min(1).optional(),
    studyTextDialogueStability: z.number().min(0).max(1).optional(),
    studyTextDialogueSeed: z.number().int().optional(),
    pronunciationMainTtsProvider: z.enum(['elevenlabs', 'google', 'inworld']).optional(),
    pronunciationMainTtsModel: publishTtsModelSchema.optional(),
    pronunciationMainVoiceId: z.string().min(1).optional(),
    pronunciationMainVoiceAccent: z.string().min(1).optional(),
    pronunciationChunkTtsProvider: z
      .enum(['edge-tts', 'elevenlabs', 'google', 'inworld'])
      .optional(),
    pronunciationChunkTtsModel: publishTtsModelSchema.optional(),
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

    for (const issue of collectPublishStudyTextOverrideIssues({
      ttsProvider: payload.studyTextTtsProvider,
      ttsStrategy: payload.studyTextTtsStrategy,
      ttsModel: payload.studyTextTtsModel,
    })) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: issue.path,
        message: issue.message.replace('publish jobs', 'study-text reruns'),
      });
    }

    if (payload.pronunciationMainTtsModel === 'eleven_v3') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pronunciationMainTtsModel'],
        message: 'eleven_v3 cannot be used for pronunciation main synthesis.',
      });
    }

    if (payload.pronunciationChunkTtsModel === 'eleven_v3') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pronunciationChunkTtsModel'],
        message: 'eleven_v3 cannot be used for pronunciation chunk synthesis.',
      });
    }

    if (
      payload.pronunciationMainTtsProvider &&
      payload.pronunciationMainTtsModel &&
      !isTtsModelForProvider(
        payload.pronunciationMainTtsProvider,
        payload.pronunciationMainTtsModel,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pronunciationMainTtsModel'],
        message: `TTS model ${payload.pronunciationMainTtsModel} is not supported by pronunciationMainTtsProvider=${payload.pronunciationMainTtsProvider}.`,
      });
    }

    if (
      payload.pronunciationChunkTtsProvider &&
      payload.pronunciationChunkTtsProvider !== 'edge-tts' &&
      payload.pronunciationChunkTtsModel &&
      !isTtsModelForProvider(
        payload.pronunciationChunkTtsProvider,
        payload.pronunciationChunkTtsModel,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pronunciationChunkTtsModel'],
        message: `TTS model ${payload.pronunciationChunkTtsModel} is not supported by pronunciationChunkTtsProvider=${payload.pronunciationChunkTtsProvider}.`,
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
): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  if (payload.regenerateStudyTextAudio !== true) {
    return issues;
  }

  const effectiveStudyTextProvider = payload.studyTextTtsProvider ?? job?.ttsProvider ?? undefined;
  const effectiveStudyTextStrategy = payload.studyTextTtsStrategy ?? job?.ttsStrategy ?? undefined;
  const effectiveStudyTextModel =
    payload.studyTextTtsModel ??
    (effectiveStudyTextStrategy === 'auto'
      ? undefined
      : resolveInheritedTtsModelForProviderChange({
          explicitProvider: effectiveStudyTextProvider,
          persistedProvider: job?.ttsProvider,
          persistedModel: job?.ttsModel,
        }));

  issues.push(
    ...collectPublishStudyTextOverrideIssues({
      ttsProvider: effectiveStudyTextProvider,
      ttsStrategy: effectiveStudyTextStrategy,
      ttsModel: effectiveStudyTextModel,
    }),
  );

  return issues;
}

function resolveInheritedTtsModelForProviderChange(args: {
  explicitModel?: TtsModelId;
  explicitProvider?: TtsProviderId;
  persistedProvider?: TtsProviderId | null;
  persistedModel?: TtsModelId | null;
}): TtsModelId | undefined {
  if (args.explicitModel !== undefined) {
    return args.explicitModel;
  }

  const provider = args.explicitProvider ?? args.persistedProvider ?? undefined;
  if (!provider || !args.persistedModel) {
    return undefined;
  }

  return isTtsModelForProvider(provider, args.persistedModel) ? args.persistedModel : undefined;
}

function resolveInheritedVoiceIdForProviderChange(args: {
  explicitVoiceId?: string;
  explicitProvider?: 'elevenlabs' | 'google' | 'inworld';
  persistedProvider?: string | null;
  persistedVoiceId?: string | null;
}): string | undefined {
  if (args.explicitVoiceId !== undefined) {
    return args.explicitVoiceId;
  }

  if (args.explicitProvider !== undefined && args.explicitProvider !== args.persistedProvider) {
    return undefined;
  }

  return args.persistedVoiceId ?? undefined;
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeRecoveredAudioArtifacts(
  pronunciation: PronunciationManifestArtifacts | undefined,
): PronunciationManifestArtifacts | undefined {
  if (!pronunciation) {
    return pronunciation;
  }

  return {
    ...pronunciation,
    primaryClip: pronunciation.primaryClip
      ? (() => {
          const { path: _path, ...clipWithoutPath } = pronunciation.primaryClip;
          return clipWithoutPath;
        })()
      : pronunciation.primaryClip,
    itemClips: pronunciation.itemClips?.map((clip) => {
      const { path: _path, ...clipWithoutPath } = clip;
      return clipWithoutPath;
    }),
  };
}

function extractStudyTextAudioUrl(html: string): string | undefined {
  const anchoredMatch = html.match(
    /<a[^>]+href="([^"]+)"[^>]*>\s*Audio recording:\s*Study Text\s*<\/a>/i,
  );
  if (anchoredMatch?.[1]) {
    return anchoredMatch[1].trim();
  }

  const figureMatch = html.match(/<figure class="audio-figure">[\s\S]*?<audio[^>]+src="([^"]+)"/i);
  return figureMatch?.[1]?.trim() || undefined;
}

function extractPronunciationAudioPayload(
  html: string,
): PronunciationManifestArtifacts | undefined {
  const match = html.match(
    /<script[^>]+id=["']esl-pronunciation-audio["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match?.[1]) {
    return undefined;
  }

  try {
    return sanitizeRecoveredAudioArtifacts(JSON.parse(match[1]) as never);
  } catch {
    return undefined;
  }
}

async function recoverDurableHtmlManifest(
  job: Awaited<ReturnType<typeof getJobById>>,
): Promise<void> {
  if (!job?.md || job.publishTarget !== 'html' || !job.htmlUrl) {
    return;
  }

  const durableManifestPath = manifestPathFor(job.md);
  if (await fileExists(durableManifestPath)) {
    return;
  }

  if (
    job.manifestPath &&
    !job.manifestPath.startsWith('s3://') &&
    (await fileExists(job.manifestPath))
  ) {
    await mkdir(path.dirname(durableManifestPath), { recursive: true });
    await copyFile(job.manifestPath, durableManifestPath);
    return;
  }

  const response = await fetch(job.htmlUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to recover durable manifest from published HTML (${response.status} ${response.statusText}).`,
    );
  }

  const html = await response.text();
  const studyTextUrl = extractStudyTextAudioUrl(html);
  const pronunciation = extractPronunciationAudioPayload(html);
  const recoveredManifest: AssignmentManifest = {
    schemaVersion: 5,
    mdHash: `recovered:${job.id}`,
    publishTarget: 'html',
    htmlUrl: job.htmlUrl,
    preset: job.preset ?? undefined,
    audioArtifacts: {
      studyText: studyTextUrl ? { url: studyTextUrl } : undefined,
      pronunciation,
    },
    timestamp: new Date().toISOString(),
  };

  await mkdir(path.dirname(durableManifestPath), { recursive: true });
  await writeFile(durableManifestPath, JSON.stringify(recoveredManifest, null, 2), 'utf8');
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

  await recoverDurableHtmlManifest(job);

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

  const persistStudyTextSettings = payload.regenerateStudyTextAudio === true;
  const studyTextVoiceId = resolveInheritedVoiceIdForProviderChange({
    explicitVoiceId: payload.studyTextVoiceId,
    explicitProvider: payload.studyTextTtsProvider,
    persistedProvider: job.ttsProvider,
    persistedVoiceId: job.voiceId,
  });
  const persistedVoiceId = persistStudyTextSettings ? studyTextVoiceId : (job.voiceId ?? undefined);
  const persistedVoiceAccent = persistStudyTextSettings
    ? (payload.studyTextVoiceAccent ?? job.voiceAccent ?? undefined)
    : (job.voiceAccent ?? undefined);
  const persistedTtsStrategy = persistStudyTextSettings
    ? (payload.studyTextTtsStrategy ?? job.ttsStrategy ?? undefined)
    : (job.ttsStrategy ?? undefined);
  const persistedTtsProvider = persistStudyTextSettings
    ? (payload.studyTextTtsProvider ?? job.ttsProvider ?? undefined)
    : (job.ttsProvider ?? undefined);
  const persistedTtsModel = persistStudyTextSettings
    ? resolveInheritedTtsModelForProviderChange({
        explicitModel: payload.studyTextTtsModel,
        explicitProvider: persistedTtsProvider,
        persistedProvider: job.ttsProvider,
        persistedModel: job.ttsModel,
      })
    : (job.ttsModel ?? undefined);

  const rerunJob = await insertJob({
    md: job.md,
    studentId: job.studentId ?? null,
    lessonId: job.lessonId ?? null,
    preset: job.preset ?? undefined,
    withTts: payload.republishOnly ? (job.withTts ?? true) : true,
    upload: 's3',
    voiceId: persistedVoiceId,
    voiceAccent: persistedVoiceAccent,
    forceTts: payload.republishOnly ? false : true,
    publishTarget: job.publishTarget ?? undefined,
    ttsStrategy: persistedTtsStrategy,
    ttsProvider: persistedTtsProvider,
    ttsModel: persistedTtsModel,
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
      studyTextVoiceId,
      studyTextTtsProvider: payload.studyTextTtsProvider ?? job.ttsProvider ?? undefined,
      studyTextTtsModel: resolveInheritedTtsModelForProviderChange({
        explicitModel: payload.studyTextTtsModel,
        explicitProvider: payload.studyTextTtsProvider ?? job.ttsProvider ?? undefined,
        persistedProvider: job.ttsProvider,
        persistedModel: job.ttsModel,
      }),
      studyTextTtsStrategy: payload.studyTextTtsStrategy ?? job.ttsStrategy ?? undefined,
      studyTextDialogueLanguage: payload.studyTextDialogueLanguage,
      studyTextDialogueStability: payload.studyTextDialogueStability,
      studyTextDialogueSeed: payload.studyTextDialogueSeed,
      pronunciationMainVoiceAccent: payload.pronunciationMainVoiceAccent ?? undefined,
      pronunciationMainVoiceId: payload.pronunciationMainVoiceId ?? undefined,
      pronunciationMainTtsProvider: payload.pronunciationMainTtsProvider ?? undefined,
      pronunciationMainTtsModel: payload.pronunciationMainTtsModel,
      pronunciationChunkVoiceAccent: payload.pronunciationChunkVoiceAccent ?? undefined,
      pronunciationChunkVoiceId: payload.pronunciationChunkVoiceId ?? undefined,
      pronunciationChunkTtsProvider: payload.pronunciationChunkTtsProvider ?? undefined,
      pronunciationChunkTtsModel: payload.pronunciationChunkTtsModel,
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
