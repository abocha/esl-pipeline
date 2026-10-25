import type { JobConfigOverrides } from '@esl-pipeline/contracts';
import { ASSIGNMENT_HTML_RENDERER_VERSION } from '@esl-pipeline/html-publisher';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type { DraftRecord } from '../domain/draft-model.js';
import { publishJobEvent } from '../domain/job-events.js';
import type { JobRecord } from '../domain/job-model.js';
import { type InsertJobParams, insertApprovalJob } from '../domain/job-repository.js';
import type { PromptPackageRecord } from '../domain/prompt-package-model.js';
import { getDefaultSettings } from '../domain/settings-model.js';
import { createDefaultSettings, getSettingsByUserId } from '../domain/settings-repository.js';
import { draftArtifact } from './assignment-artifact.js';
import { requireTypedAssignment } from './historical-assignment.js';
import {
  buildLearningPresetProvenance,
  DEFAULT_LEARNING_PRESET_ID,
  normalizeLearningPresetId,
} from './learning-preset.js';
import { collectPublishStudyTextOverrideIssues } from './publish-study-text-overrides.js';
import { ValidationError } from './submit-job.js';

export interface CreateApprovalJobParams {
  draft: DraftRecord;
  promptPackage: PromptPackageRecord;
  jobOverrides?: JobConfigOverrides;
}

export interface CreateApprovalJobDependencies {
  jobs: {
    insertApprovalJob: typeof insertApprovalJob;
  };
  settings: {
    getByUserId: typeof getSettingsByUserId;
    createDefault: typeof createDefaultSettings;
  };
  config: BatchBackendConfig;
  publishEvent: typeof publishJobEvent;
}

export type ResolvedApprovalJobConfig = Omit<
  InsertJobParams,
  | 'id'
  | 'recordingId'
  | 'transcriptId'
  | 'promptPackageId'
  | 'draftId'
  | 'studentId'
  | 'lessonId'
  | 'userId'
  | 'md'
  | 'mdStorageUri'
>;

export async function resolveApprovalJobConfig(
  params: { userId?: string | null; jobOverrides?: JobConfigOverrides },
  overrides?: Pick<Partial<CreateApprovalJobDependencies>, 'settings' | 'config'>,
): Promise<ResolvedApprovalJobConfig> {
  const settings = overrides?.settings ?? {
    getByUserId: getSettingsByUserId,
    createDefault: createDefaultSettings,
  };
  const config = overrides?.config ?? loadConfig();
  const defaults = getDefaultSettings();

  const userId = params.userId ?? undefined;
  let preset = defaults.defaultPreset;
  let voiceAccent = defaults.defaultVoiceAccent;
  let ttsStrategy = defaults.defaultTtsStrategy;
  let hasTtsKey = Boolean(config.orchestrator.elevenLabsApiKey);

  if (userId) {
    let resolved = await settings.getByUserId(userId);
    if (!resolved) resolved = await settings.createDefault(userId);
    preset = resolved.defaultPreset || preset;
    voiceAccent = resolved.defaultVoiceAccent || voiceAccent;
    ttsStrategy = resolved.defaultTtsStrategy || ttsStrategy;
    hasTtsKey = hasTtsKey || Boolean(resolved.elevenLabsKeyEncrypted);
  }

  const jobOverrides = params.jobOverrides ?? {};
  const publishStudyTextIssues = collectPublishStudyTextOverrideIssues({
    ttsStrategy: jobOverrides.ttsStrategy ?? ttsStrategy,
    ttsProvider: jobOverrides.ttsProvider,
    ttsModel: jobOverrides.ttsModel,
  });
  if (publishStudyTextIssues.length > 0) {
    const issue = publishStudyTextIssues[0];
    throw new ValidationError(
      issue?.message ?? 'Invalid study-text TTS override',
      issue?.code ?? 'validation_failed',
    );
  }
  const withTts =
    jobOverrides.withTts ??
    (jobOverrides.ttsProvider === 'google' ||
    jobOverrides.ttsProvider === 'inworld' ||
    jobOverrides.ttsProvider === 'gemini'
      ? true
      : hasTtsKey);
  const learningPresetId =
    normalizeLearningPresetId({ learningPresetId: jobOverrides.learningPresetId }) ??
    DEFAULT_LEARNING_PRESET_ID;
  const provenance = buildLearningPresetProvenance(learningPresetId);

  return {
    preset,
    learningPresetId: provenance.learningPresetId,
    learningPresetVersion: provenance.learningPresetVersion,
    promptSnapshotVersion: provenance.promptSnapshotVersion,
    promptAlias: provenance.promptAlias,
    withTts,
    ttsStrategy: jobOverrides.ttsStrategy ?? ttsStrategy,
    ttsProvider: jobOverrides.ttsProvider,
    ttsModel: jobOverrides.ttsModel,
    voiceAccent: jobOverrides.voiceAccent ?? voiceAccent,
    voiceId: jobOverrides.voiceId,
    forceTts: jobOverrides.forceTts,
    publishTarget: jobOverrides.publishTarget ?? 'html',
    upload: jobOverrides.upload ?? 'auto',
    autoPublish: jobOverrides.autoPublish,
  };
}

export async function createApprovalJobFromDraft(
  params: CreateApprovalJobParams,
  overrides?: Partial<CreateApprovalJobDependencies>,
): Promise<JobRecord> {
  requireTypedAssignment(draftArtifact(params.draft));
  const jobs = overrides?.jobs ?? { insertApprovalJob };
  const publishEvent = overrides?.publishEvent ?? publishJobEvent;
  const jobConfig = await resolveApprovalJobConfig(
    { userId: params.draft.createdBy, jobOverrides: params.jobOverrides },
    overrides,
  );

  const job = await jobs.insertApprovalJob({
    recordingId: params.promptPackage.recordingId,
    transcriptId: params.promptPackage.transcriptId,
    promptPackageId: params.promptPackage.id,
    draftId: params.draft.id,
    assignmentArtifact: draftArtifact(params.draft),
    assignmentRendererVersion: draftArtifact(params.draft)
      ? ASSIGNMENT_HTML_RENDERER_VERSION
      : undefined,
    studentId: params.draft.studentId ?? params.promptPackage.studentId ?? null,
    lessonId: params.draft.lessonId ?? params.promptPackage.lessonId ?? null,
    userId: params.draft.createdBy ?? undefined,
    ...jobConfig,
  });

  publishEvent({ type: 'job_created', job });

  return job;
}
