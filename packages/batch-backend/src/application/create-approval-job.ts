import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type { DraftRecord } from '../domain/draft-model.js';
import { publishJobEvent } from '../domain/job-events.js';
import type { JobRecord } from '../domain/job-model.js';
import { insertApprovalJob } from '../domain/job-repository.js';
import type { PromptPackageRecord } from '../domain/prompt-package-model.js';
import {
  createDefaultSettings,
  getSettingsByUserId,
} from '../domain/settings-repository.js';
import { getDefaultSettings } from '../domain/settings-model.js';

export interface CreateApprovalJobParams {
  draft: DraftRecord;
  promptPackage: PromptPackageRecord;
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

export async function createApprovalJobFromDraft(
  params: CreateApprovalJobParams,
  overrides?: Partial<CreateApprovalJobDependencies>,
): Promise<JobRecord> {
  const jobs = overrides?.jobs ?? { insertApprovalJob };
  const settings = overrides?.settings ?? {
    getByUserId: getSettingsByUserId,
    createDefault: createDefaultSettings,
  };
  const config = overrides?.config ?? loadConfig();
  const publishEvent = overrides?.publishEvent ?? publishJobEvent;
  const defaults = getDefaultSettings();

  const userId = params.draft.createdBy ?? undefined;
  let preset = defaults.defaultPreset;
  let voiceAccent = defaults.defaultVoiceAccent;
  let ttsStrategy = defaults.defaultTtsStrategy;
  let hasTtsKey = Boolean(config.orchestrator.elevenLabsApiKey);

  if (userId) {
    let resolved = await settings.getByUserId(userId);
    if (!resolved) {
      resolved = await settings.createDefault(userId);
    }
    preset = resolved.defaultPreset || preset;
    voiceAccent = resolved.defaultVoiceAccent || voiceAccent;
    ttsStrategy = resolved.defaultTtsStrategy || ttsStrategy;
    hasTtsKey = hasTtsKey || Boolean(resolved.elevenLabsKeyEncrypted);
  }

  const job = await jobs.insertApprovalJob({
    recordingId: params.promptPackage.recordingId,
    transcriptId: params.promptPackage.transcriptId,
    promptPackageId: params.promptPackage.id,
    draftId: params.draft.id,
    userId: params.draft.createdBy ?? undefined,
    preset,
    withTts: hasTtsKey,
    ttsStrategy,
    voiceAccent,
    upload: 'auto',
  });

  publishEvent({ type: 'job_created', job });

  return job;
}
