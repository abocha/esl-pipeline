// packages/batch-backend/src/application/get-job-options.ts
//
// Batch frontend metadata endpoint. Primarily proxies orchestrator config.
// Static metadata fallback is available only when explicitly enabled via env.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
  ActionCapability,
  CefrLevel,
  GenerationOptionsPayload,
  GoogleTtsModel,
  JobOptionsPayload,
  NotionDatabaseOption,
  SttProviderId,
  TtsProviderId,
  VoiceOption,
} from '@esl-pipeline/contracts';
import {
  normalizeVoiceCatalogToOptions,
  resolveNotionDatabasesFromEnv,
} from '@esl-pipeline/shared-infrastructure';

import { loadConfig } from '../config/env.js';
import { logger } from '../infrastructure/logger.js';
import { getJobOptionsFromOrchestrator } from '../infrastructure/orchestrator-service.js';
import { resolveGenerationBudgetRepository } from './generation-budget-guard.js';
import { buildGenerationOptionsPayload, buildQuotaSnapshot } from './generation-policy.js';
import { getActionMetadata } from './job-actions/action-handler.js';
import { DEFAULT_LEARNING_PRESET, type LearningPresetOption } from './learning-preset.js';

export interface JobOptionsResponse extends JobOptionsPayload {
  supportedActions: ActionCapability[];
  learningPresets: LearningPresetOption[];
}

interface JobOptionsCacheEntry {
  expiresAt: number;
  value: JobOptionsResponse;
}

const DEFAULT_CEFR_LEVELS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const DEFAULT_CEFR_DEFAULT: CefrLevel = 'B1';
const JOB_OPTIONS_CACHE_TTL_MS = 60_000;
const DEFAULT_TTS_PROVIDERS: TtsProviderId[] = ['elevenlabs', 'google'];
const DEFAULT_STT_PROVIDERS: SttProviderId[] = ['deepgram', 'elevenlabs', 'google'];
const DEFAULT_GOOGLE_TTS_MODELS: GoogleTtsModel[] = ['chirp3_hd', 'studio', 'neural2', 'wavenet'];
const DEFAULT_ELEVENLABS_TTS_MODELS = [
  'eleven_v3',
  'eleven_multilingual_v2',
  'eleven_flash_v2_5',
  'eleven_flash_v2',
] as const;

// TODO: Remove static metadata fallback once orchestrator metadata reliability SLO is met.
// Kept behind an explicit env gate for emergency recovery only.
const STATIC_OPTIONS: Omit<JobOptionsResponse, 'supportedActions'> = {
  presets: ['b1-default'],
  learningPresets: [DEFAULT_LEARNING_PRESET],
  voiceAccents: ['american_female', 'british_male'],
  voices: [],
  cefrLevels: DEFAULT_CEFR_LEVELS,
  cefrDefault: DEFAULT_CEFR_DEFAULT,
  notionDatabases: [
    { id: 'notion-db-b1', name: 'B1 Lessons' },
    { id: 'notion-db-b2', name: 'B2 Lessons' },
  ],
  uploadOptions: ['auto', 's3', 'none'],
  ttsStrategies: ['auto'],
};

let jobOptionsCache: JobOptionsCacheEntry | null = null;
let inflightJobOptions: Promise<JobOptionsResponse> | null = null;

export async function getJobOptions(): Promise<JobOptionsResponse> {
  const now = Date.now();
  if (jobOptionsCache && jobOptionsCache.expiresAt > now) {
    return cloneJobOptions(jobOptionsCache.value);
  }

  if (inflightJobOptions) {
    const value = await inflightJobOptions;
    return cloneJobOptions(value);
  }

  inflightJobOptions = (async () => {
    const runtimeConfig = loadConfig();
    try {
      const result = await getJobOptionsFromOrchestrator();
      const notionDatabases =
        result.notionDatabases && result.notionDatabases.length > 0
          ? result.notionDatabases
          : resolveNotionDatabases();

      // Add supported actions to orchestrator response
      const actionMetadata = getActionMetadata();
      const supportedActions: ActionCapability[] = Object.entries(actionMetadata).map(
        ([type, meta]) => ({ type, ...(meta as object) }) as ActionCapability,
      );
      const orchestratorLearningPresets = (
        result as JobOptionsPayload & { learningPresets?: LearningPresetOption[] }
      ).learningPresets;
      const learningPresets =
        orchestratorLearningPresets && orchestratorLearningPresets.length > 0
          ? orchestratorLearningPresets
          : [DEFAULT_LEARNING_PRESET];
      const generation = await withQuotaUsage(
        result.generation ?? buildGenerationOptionsPayload({ config: runtimeConfig.generation }),
        runtimeConfig,
      );
      const ttsMetadata = resolveTtsMetadata({
        ttsProviders: result.ttsProviders,
        ttsModelOptionsByProvider: result.ttsModelOptionsByProvider,
        defaultTtsProvider: result.defaultTtsProvider,
        defaultTtsModelByProvider: result.defaultTtsModelByProvider,
      });
      const sttMetadata = resolveSttMetadata(
        {
          sttProviders: result.sttProviders,
          defaultSttProvider: result.defaultSttProvider,
          sttModelOptionsByProvider: result.sttModelOptionsByProvider,
          defaultSttModelByProvider: result.defaultSttModelByProvider,
        },
        runtimeConfig,
      );

      return {
        ...result,
        cefrLevels: result.cefrLevels ?? [...DEFAULT_CEFR_LEVELS],
        cefrDefault: result.cefrDefault ?? DEFAULT_CEFR_DEFAULT,
        generation,
        notionDatabases,
        learningPresets,
        ...sttMetadata,
        ...ttsMetadata,
        supportedActions,
      };
    } catch (error) {
      if (!runtimeConfig.jobOptions.allowStaticFallback) {
        logger.error(
          'Failed to load job options from orchestrator and static fallback is disabled.',
          {
            event: 'job_options_orchestrator_unavailable',
            staticFallbackEnabled: false,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        throw error;
      }

      logger.warn('Failed to load job options from orchestrator. Using static fallback config.', {
        event: 'job_options_static_fallback',
        staticFallbackEnabled: true,
        error: error instanceof Error ? error.message : String(error),
      });
      return loadStaticJobOptions(runtimeConfig);
    }
  })();

  try {
    const resolved = await inflightJobOptions;
    jobOptionsCache = {
      expiresAt: Date.now() + JOB_OPTIONS_CACHE_TTL_MS,
      value: resolved,
    };
    return cloneJobOptions(resolved);
  } finally {
    inflightJobOptions = null;
  }
}

async function loadStaticJobOptions(
  runtimeConfig: ReturnType<typeof loadConfig>,
): Promise<JobOptionsResponse> {
  const notionDatabases = resolveNotionDatabases();
  const voices = await loadVoiceOptions();
  const voiceAccents =
    voices.length > 0
      ? ([
          ...new Set(
            voices
              .map((voice) =>
                typeof voice.accent === 'string' ? voice.accent.trim() || undefined : undefined,
              )
              .filter(Boolean),
          ),
        ] as string[])
      : [...STATIC_OPTIONS.voiceAccents];

  const actionMetadata = getActionMetadata();
  const supportedActions: ActionCapability[] = Object.entries(actionMetadata).map(
    ([type, meta]) => ({ type, ...(meta as object) }) as ActionCapability,
  );

  return {
    presets: [...STATIC_OPTIONS.presets],
    voiceAccents,
    voices,
    cefrLevels: [...DEFAULT_CEFR_LEVELS],
    cefrDefault: DEFAULT_CEFR_DEFAULT,
    generation: await withQuotaUsage(
      buildGenerationOptionsPayload({ config: runtimeConfig.generation }),
      runtimeConfig,
    ),
    notionDatabases,
    learningPresets: [...STATIC_OPTIONS.learningPresets],
    uploadOptions: [...STATIC_OPTIONS.uploadOptions],
    ttsStrategies: [...STATIC_OPTIONS.ttsStrategies],
    ...resolveSttMetadata({}, runtimeConfig),
    ...resolveTtsMetadata(),
    supportedActions,
  };
}

function resolveSttMetadata(
  input: {
    sttProviders?: SttProviderId[];
    defaultSttProvider?: SttProviderId;
    sttModelOptionsByProvider?: Partial<Record<SttProviderId, string[]>>;
    defaultSttModelByProvider?: Partial<Record<SttProviderId, string>>;
  },
  runtimeConfig: ReturnType<typeof loadConfig>,
): {
  sttProviders: SttProviderId[];
  defaultSttProvider: SttProviderId;
  sttModelOptionsByProvider: Partial<Record<SttProviderId, string[]>>;
  defaultSttModelByProvider: Partial<Record<SttProviderId, string>>;
} {
  const candidates =
    input.sttProviders?.length && input.sttProviders.length > 0
      ? input.sttProviders
      : runtimeConfig.transcription.sttProviders.length > 0
        ? runtimeConfig.transcription.sttProviders
        : DEFAULT_STT_PROVIDERS;
  const sttProviders = [...new Set(candidates)].filter(
    (provider): provider is SttProviderId =>
      provider === 'deepgram' || provider === 'elevenlabs' || provider === 'google',
  );

  const sttModelOptionsByProvider: Partial<Record<SttProviderId, string[]>> = {
    ...input.sttModelOptionsByProvider,
  };
  if (!sttModelOptionsByProvider.deepgram || sttModelOptionsByProvider.deepgram.length === 0) {
    sttModelOptionsByProvider.deepgram = [runtimeConfig.stt.providers.deepgram.model];
  }
  if (!sttModelOptionsByProvider.elevenlabs || sttModelOptionsByProvider.elevenlabs.length === 0) {
    sttModelOptionsByProvider.elevenlabs = [runtimeConfig.stt.providers.elevenlabs.model];
  }
  if (!sttModelOptionsByProvider.google || sttModelOptionsByProvider.google.length === 0) {
    sttModelOptionsByProvider.google = [runtimeConfig.stt.providers.google.model];
  }

  const defaultSttModelByProvider: Partial<Record<SttProviderId, string>> = {
    ...input.defaultSttModelByProvider,
  };
  if (!defaultSttModelByProvider.deepgram) {
    defaultSttModelByProvider.deepgram = sttModelOptionsByProvider.deepgram[0];
  }
  if (!defaultSttModelByProvider.elevenlabs) {
    defaultSttModelByProvider.elevenlabs = sttModelOptionsByProvider.elevenlabs[0];
  }
  if (!defaultSttModelByProvider.google) {
    defaultSttModelByProvider.google = sttModelOptionsByProvider.google[0];
  }

  const defaultSttProviderCandidate =
    input.defaultSttProvider ?? runtimeConfig.transcription.sttProvider ?? 'deepgram';
  const defaultSttProvider = sttProviders.includes(defaultSttProviderCandidate)
    ? defaultSttProviderCandidate
    : (sttProviders[0] ?? 'deepgram');

  return {
    sttProviders,
    defaultSttProvider,
    sttModelOptionsByProvider,
    defaultSttModelByProvider,
  };
}

function resolveTtsMetadata(
  input: {
    ttsProviders?: TtsProviderId[];
    ttsModelOptionsByProvider?: Partial<Record<TtsProviderId, string[]>>;
    defaultTtsProvider?: TtsProviderId;
    defaultTtsModelByProvider?: Partial<Record<TtsProviderId, string>>;
  } = {},
): {
  ttsProviders: TtsProviderId[];
  ttsModelOptionsByProvider: Partial<Record<TtsProviderId, string[]>>;
  defaultTtsProvider: TtsProviderId;
  defaultTtsModelByProvider: Partial<Record<TtsProviderId, string>>;
} {
  const ttsProviders = (
    input.ttsProviders?.length ? input.ttsProviders : DEFAULT_TTS_PROVIDERS
  ).filter(
    (provider): provider is TtsProviderId => provider === 'elevenlabs' || provider === 'google',
  );
  const uniqueProviders = [...new Set(ttsProviders)];
  const modelOptionsByProvider: Partial<Record<TtsProviderId, string[]>> = {
    ...input.ttsModelOptionsByProvider,
  };
  const defaultModelByProvider: Partial<Record<TtsProviderId, string>> = {
    ...input.defaultTtsModelByProvider,
  };

  if (!modelOptionsByProvider.elevenlabs || modelOptionsByProvider.elevenlabs.length === 0) {
    modelOptionsByProvider.elevenlabs = [...DEFAULT_ELEVENLABS_TTS_MODELS];
  }
  if (!defaultModelByProvider.elevenlabs) {
    defaultModelByProvider.elevenlabs =
      process.env.ESL_TTS_PROVIDER_ELEVENLABS_MODEL_ID?.trim() || 'eleven_multilingual_v2';
  }

  if (!modelOptionsByProvider.google || modelOptionsByProvider.google.length === 0) {
    modelOptionsByProvider.google = [...DEFAULT_GOOGLE_TTS_MODELS];
  }
  if (
    !defaultModelByProvider.google ||
    !modelOptionsByProvider.google.includes(defaultModelByProvider.google)
  ) {
    defaultModelByProvider.google =
      process.env.ESL_TTS_PROVIDER_GOOGLE_MODEL?.trim() ||
      modelOptionsByProvider.google[0] ||
      'chirp3_hd';
  }

  const defaultProviderRaw = input.defaultTtsProvider ?? process.env.ESL_TTS_DEFAULT_PROVIDER;
  const normalizedDefaultProvider =
    defaultProviderRaw === 'elevenlabs' || defaultProviderRaw === 'google'
      ? defaultProviderRaw
      : undefined;
  const defaultProvider =
    normalizedDefaultProvider && uniqueProviders.includes(normalizedDefaultProvider)
      ? normalizedDefaultProvider
      : (uniqueProviders[0] ?? 'elevenlabs');

  return {
    ttsProviders: uniqueProviders,
    ttsModelOptionsByProvider: modelOptionsByProvider,
    defaultTtsProvider: defaultProvider,
    defaultTtsModelByProvider: defaultModelByProvider,
  };
}

async function withQuotaUsage(
  generation: GenerationOptionsPayload,
  runtimeConfig: ReturnType<typeof loadConfig>,
): Promise<GenerationOptionsPayload> {
  const provider = generation.defaultProvider;
  const model =
    generation.defaultModelByProvider?.[provider] ??
    generation.modelOptions.find((option) => option.provider === provider)?.id;

  if (!provider || !model) {
    return generation;
  }

  try {
    const repository = resolveGenerationBudgetRepository({ config: runtimeConfig });
    const usage = await repository.getUsage({
      provider,
      model,
      now: new Date(),
    });
    return {
      ...generation,
      quota: {
        ...buildQuotaSnapshot({
          config: runtimeConfig.generation,
          provider,
          model,
          usage,
          now: new Date(),
        }),
        ...generation.quota,
        usedRequestsToday: usage.requestsToday,
        usedTokensToday: Math.max(usage.reservedTokensToday, usage.actualTokensToday),
        dailyRequestUsed: usage.requestsToday,
        dailyRequestRemaining:
          (generation.quota.dailyRequestBudget ?? generation.quota.requestsPerDay ?? null) === null
            ? null
            : Math.max(
                0,
                (generation.quota.dailyRequestBudget ?? generation.quota.requestsPerDay ?? 0) -
                  usage.requestsToday,
              ),
        dailyTokenUsed: Math.max(usage.reservedTokensToday, usage.actualTokensToday),
        dailyTokenRemaining:
          generation.quota.dailyTokenBudget === undefined ||
          generation.quota.dailyTokenBudget === null
            ? null
            : Math.max(
                0,
                generation.quota.dailyTokenBudget -
                  Math.max(usage.reservedTokensToday, usage.actualTokensToday),
              ),
        rpmUsed: usage.requestsPerMinuteUsed,
        rpmRemaining:
          (generation.quota.rpmBudget ?? generation.quota.requestsPerMinute ?? null) === null
            ? null
            : Math.max(
                0,
                (generation.quota.rpmBudget ?? generation.quota.requestsPerMinute ?? 0) -
                  usage.requestsPerMinuteUsed,
              ),
      },
    };
  } catch (error) {
    logger.warn(
      'Failed to resolve generation quota usage snapshot; using baseline quota metadata.',
      {
        error: error instanceof Error ? error.message : String(error),
        provider,
        model,
      },
    );
    return generation;
  }
}

function resolveNotionDatabases(): NotionDatabaseOption[] {
  return resolveNotionDatabasesFromEnv({
    singleDbId: process.env.NOTION_DB_ID?.trim(),
    fallback: STATIC_OPTIONS.notionDatabases,
  });
}

const VOICE_CATALOG_RELATIVE_PATH = 'packages/orchestrator/configs/elevenlabs.voices.json';

async function loadVoiceOptions(): Promise<VoiceOption[]> {
  const candidates = getVoiceCatalogCandidates();
  for (const voiceFile of candidates) {
    try {
      const raw = await readFile(voiceFile, 'utf8');
      const parsed = JSON.parse(raw) as { voices?: Record<string, unknown>[] };
      if (!parsed?.voices || !Array.isArray(parsed.voices)) {
        continue;
      }

      return normalizeVoiceCatalogToOptions(parsed).voices;
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'EISDIR')
      ) {
        continue;
      }
      // Swallow other errors so the API can continue serving fallback options.
      continue;
    }
  }
  return [];
}

function getVoiceCatalogCandidates(): string[] {
  const cwd = process.cwd();
  const roots = [cwd, resolve(cwd, '..'), resolve(cwd, '..', '..')];
  const overridePath = process.env.ELEVENLABS_VOICES_PATH
    ? resolve(process.env.ELEVENLABS_VOICES_PATH)
    : null;
  const repoRootEnv = process.env.REPO_ROOT || process.env.APP_ROOT || process.env.PROJECT_ROOT;
  if (repoRootEnv) {
    roots.push(resolve(repoRootEnv));
  }
  const paths = [
    overridePath,
    ...roots.map((root) => resolve(root, VOICE_CATALOG_RELATIVE_PATH)),
  ].filter(Boolean);

  return [...new Set(paths)] as string[];
}

function cloneJobOptions(value: JobOptionsResponse): JobOptionsResponse {
  return {
    ...value,
    presets: [...value.presets],
    voiceAccents: [...value.voiceAccents],
    voices: value.voices.map((voice) => ({ ...voice })),
    cefrLevels: value.cefrLevels ? [...value.cefrLevels] : [...DEFAULT_CEFR_LEVELS],
    cefrDefault: value.cefrDefault ?? DEFAULT_CEFR_DEFAULT,
    notionDatabases: value.notionDatabases.map((option) => ({ ...option })),
    uploadOptions: [...value.uploadOptions],
    ttsStrategies: [...value.ttsStrategies],
    ...(value.ttsProviders ? { ttsProviders: [...value.ttsProviders] } : {}),
    ...(value.ttsModelOptionsByProvider
      ? {
          ttsModelOptionsByProvider: Object.fromEntries(
            Object.entries(value.ttsModelOptionsByProvider).map(([provider, models]) => [
              provider,
              [...(models ?? [])],
            ]),
          ) as Partial<Record<TtsProviderId, string[]>>,
        }
      : {}),
    ...(value.defaultTtsProvider ? { defaultTtsProvider: value.defaultTtsProvider } : {}),
    ...(value.defaultTtsModelByProvider
      ? {
          defaultTtsModelByProvider: { ...value.defaultTtsModelByProvider },
        }
      : {}),
    generation: cloneGenerationOptions(value.generation),
    supportedActions: value.supportedActions.map((action) => ({ ...action })),
    learningPresets: value.learningPresets.map((preset) => ({ ...preset })),
  };
}

function cloneGenerationOptions(
  value: GenerationOptionsPayload | undefined,
): GenerationOptionsPayload | undefined {
  if (!value) return undefined;
  return {
    ...value,
    providers: [...value.providers],
    modelOptions: value.modelOptions.map((option) => ({ ...option })),
    defaultModelByProvider: value.defaultModelByProvider
      ? { ...value.defaultModelByProvider }
      : undefined,
    quota: {
      ...value.quota,
    },
  };
}
