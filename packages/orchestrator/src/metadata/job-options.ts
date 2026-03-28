import type {
  ElevenLabsTtsModelId,
  GoogleTtsModel,
  JobOptionsPayload,
  NotionDatabaseOption,
  TtsProviderId,
  TtsStrategyOption,
  UploadOption,
} from '@esl-pipeline/contracts';
import {
  normalizeVoiceCatalogToOptions,
  resolveNotionDatabasesFromEnv as resolveNotionDatabasesFromEnvShared,
} from '@esl-pipeline/shared-infrastructure';
import { getRegisteredTtsProvider, loadVoicesCatalog } from '@esl-pipeline/tts-core';

import type { ConfigProvider, StudentProfile } from '../config.js';
import type { OrchestratorPipeline, ResolvedConfigPaths } from '../pipeline.js';
import { ensureTtsProvidersRegistered } from '../tts-provider-registry.js';

export type {
  JobOptionsPayload,
  NotionDatabaseOption,
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
const GOOGLE_TTS_MODELS: GoogleTtsModel[] = ['chirp3_hd', 'studio', 'neural2', 'wavenet'];
const ELEVENLABS_TTS_MODELS: ElevenLabsTtsModelId[] = [
  'eleven_v3',
  'eleven_multilingual_v2',
  'eleven_flash_v2_5',
  'eleven_flash_v2',
];

export async function resolveJobOptions(
  source: ResolveJobOptionsSource,
): Promise<JobOptionsPayload> {
  ensureTtsProvidersRegistered();
  const { configProvider, configPaths } = source;

  const [presetsMap, studentProfiles, voiceCatalog] = await Promise.all([
    configProvider.loadPresets(configPaths.presetsPath),
    configProvider.loadStudentProfiles(configPaths.studentsDir),
    loadVoicesCatalog(),
  ]);

  const presets = Object.keys(presetsMap ?? {}).sort((a, b) => a.localeCompare(b));
  const notionDatabasesFromProfiles = extractNotionDatabases(studentProfiles);
  const notionDatabases =
    notionDatabasesFromProfiles.length > 0
      ? notionDatabasesFromProfiles
      : resolveNotionDatabasesFromEnvShared({
          singleDbId: process.env.NOTION_DATABASE_ID?.trim() || process.env.NOTION_DB_ID?.trim(),
        });
  const { voices, voiceAccents } = normalizeVoiceCatalogToOptions(voiceCatalog);
  const ttsProviders = resolveRegisteredTtsProviders();
  const defaultTtsProvider = resolveDefaultTtsProvider(ttsProviders);
  const { ttsModelOptionsByProvider, defaultTtsModelByProvider } =
    buildTtsModelMetadata(ttsProviders);

  return {
    presets,
    voiceAccents,
    voices,
    notionDatabases,
    uploadOptions: [...DEFAULT_UPLOAD_OPTIONS],
    ttsStrategies: [...DEFAULT_TTS_STRATEGIES],
    ttsProviders,
    ttsModelOptionsByProvider,
    defaultTtsProvider,
    defaultTtsModelByProvider,
  };
}

function resolveRegisteredTtsProviders(): TtsProviderId[] {
  const ordered: TtsProviderId[] = ['elevenlabs', 'google'];
  return ordered.filter((providerId) => Boolean(getRegisteredTtsProvider(providerId)));
}

function resolveDefaultTtsProvider(availableProviders: TtsProviderId[]): TtsProviderId | undefined {
  if (availableProviders.length === 0) return undefined;
  const envProvider = process.env.ESL_TTS_DEFAULT_PROVIDER?.trim().toLowerCase();
  if (
    (envProvider === 'elevenlabs' || envProvider === 'google') &&
    availableProviders.includes(envProvider)
  ) {
    return envProvider;
  }
  return availableProviders[0];
}

function buildTtsModelMetadata(availableProviders: TtsProviderId[]): {
  ttsModelOptionsByProvider: Partial<Record<TtsProviderId, string[]>>;
  defaultTtsModelByProvider: Partial<Record<TtsProviderId, string>>;
} {
  const ttsModelOptionsByProvider: Partial<Record<TtsProviderId, string[]>> = {};
  const defaultTtsModelByProvider: Partial<Record<TtsProviderId, string>> = {};

  for (const providerId of availableProviders) {
    if (providerId === 'google') {
      ttsModelOptionsByProvider.google = [...GOOGLE_TTS_MODELS];
      const metadataModel = getRegisteredTtsProvider('google')
        ?.providerMetadata({})
        .modelFamily?.trim();
      const defaultModel =
        metadataModel && GOOGLE_TTS_MODELS.includes(metadataModel as GoogleTtsModel)
          ? metadataModel
          : 'chirp3_hd';
      defaultTtsModelByProvider.google = defaultModel;
      continue;
    }

    const modelFamily =
      getRegisteredTtsProvider('elevenlabs')?.providerMetadata({}).modelFamily?.trim() ||
      'eleven_multilingual_v2';
    ttsModelOptionsByProvider.elevenlabs = [...ELEVENLABS_TTS_MODELS];
    defaultTtsModelByProvider.elevenlabs = ELEVENLABS_TTS_MODELS.includes(
      modelFamily as ElevenLabsTtsModelId,
    )
      ? modelFamily
      : 'eleven_multilingual_v2';
  }

  return { ttsModelOptionsByProvider, defaultTtsModelByProvider };
}

function extractNotionDatabases(profiles: StudentProfile[]): NotionDatabaseOption[] {
  const seen = new Set<string>();
  const options: NotionDatabaseOption[] = [];

  for (const profile of profiles ?? []) {
    const raw = typeof profile.dbId === 'string' ? profile.dbId.trim() : '';
    if (!raw) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    const label =
      typeof profile.student === 'string' && profile.student.trim().length > 0
        ? profile.student.trim()
        : raw;
    options.push({ id: raw, name: label });
  }

  return options.sort((a, b) => a.name.localeCompare(b.name));
}
