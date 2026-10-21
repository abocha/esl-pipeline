import type {
  JobOptionsPayload,
  TtsProviderId,
  TtsStrategyOption,
  UploadOption,
} from '@esl-pipeline/contracts';
import { normalizeVoiceCatalogToOptions } from '@esl-pipeline/shared-infrastructure';
import {
  buildDefaultTtsModelByProvider,
  buildTtsModelOptionsByProvider,
  getRegisteredTtsProvider,
  loadVoicesCatalog,
  parseTtsProviderId,
} from '@esl-pipeline/tts-core';

import type { ConfigProvider } from '../config.js';
import type { OrchestratorPipeline, ResolvedConfigPaths } from '../pipeline.js';
import { ensureTtsProvidersRegistered } from '../tts-provider-registry.js';

export type {
  JobOptionsPayload,
  TtsStrategyOption,
  UploadOption,
  VoiceOption,
} from '@esl-pipeline/contracts';

type ResolveJobOptionsSource =
  | Pick<OrchestratorPipeline, 'configProvider' | 'configPaths'>
  | {
      configProvider: ConfigProvider;
      configPaths: ResolvedConfigPaths;
    };

const DEFAULT_UPLOAD_OPTIONS: UploadOption[] = ['auto', 's3', 'none'];
const DEFAULT_TTS_STRATEGIES: TtsStrategyOption[] = ['auto', 'dialogue', 'tts'];
export async function resolveJobOptions(
  source: ResolveJobOptionsSource,
): Promise<JobOptionsPayload> {
  ensureTtsProvidersRegistered();
  const { configProvider, configPaths } = source;

  const [presetsMap, voiceCatalog] = await Promise.all([
    configProvider.loadPresets(configPaths.presetsPath),
    loadVoicesCatalog(),
  ]);

  const presets = Object.keys(presetsMap ?? {}).sort((a, b) => a.localeCompare(b));
  const { voices, voiceAccents } = normalizeVoiceCatalogToOptions(voiceCatalog);
  const ttsProviders = resolveRegisteredTtsProviders();
  const defaultTtsProvider = resolveDefaultTtsProvider(ttsProviders);
  const { ttsModelOptionsByProvider, defaultTtsModelByProvider } =
    buildTtsModelMetadata(ttsProviders);

  return {
    presets,
    voiceAccents,
    voices,
    uploadOptions: [...DEFAULT_UPLOAD_OPTIONS],
    ttsStrategies: [...DEFAULT_TTS_STRATEGIES],
    ttsProviders,
    ttsModelOptionsByProvider,
    defaultTtsProvider,
    defaultTtsModelByProvider,
  };
}

function resolveRegisteredTtsProviders(): TtsProviderId[] {
  const ordered: TtsProviderId[] = ['elevenlabs', 'google', 'inworld', 'gemini'];
  return ordered.filter((providerId) => Boolean(getRegisteredTtsProvider(providerId)));
}

function resolveDefaultTtsProvider(availableProviders: TtsProviderId[]): TtsProviderId | undefined {
  if (availableProviders.length === 0) return undefined;
  const envProvider = parseTtsProviderId(process.env.ESL_TTS_DEFAULT_PROVIDER);
  if (envProvider && availableProviders.includes(envProvider)) {
    return envProvider;
  }
  return availableProviders[0];
}

function buildTtsModelMetadata(availableProviders: TtsProviderId[]): {
  ttsModelOptionsByProvider: Partial<Record<TtsProviderId, string[]>>;
  defaultTtsModelByProvider: Partial<Record<TtsProviderId, string>>;
} {
  return {
    ttsModelOptionsByProvider: buildTtsModelOptionsByProvider(availableProviders),
    defaultTtsModelByProvider: buildDefaultTtsModelByProvider(availableProviders),
  };
}
