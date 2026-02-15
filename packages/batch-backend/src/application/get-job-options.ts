// packages/batch-backend/src/application/get-job-options.ts
//
// Batch frontend metadata endpoint. Primarily proxies orchestrator config,
// with the static section below serving as a fallback when orchestration fails.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
  ActionCapability,
  CefrLevel,
  JobOptionsPayload,
  NotionDatabaseOption,
  VoiceOption,
} from '@esl-pipeline/contracts';
import {
  normalizeVoiceCatalogToOptions,
  resolveNotionDatabasesFromEnv,
} from '@esl-pipeline/shared-infrastructure';

import { logger } from '../infrastructure/logger.js';
import { getJobOptionsFromOrchestrator } from '../infrastructure/orchestrator-service.js';
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

// TODO: Replace these with data pulled from the orchestrator config provider or
// dedicated metadata service once available (tracked in backend/frontend Phase 5).
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

      return {
        ...result,
        cefrLevels: result.cefrLevels ?? [...DEFAULT_CEFR_LEVELS],
        cefrDefault: result.cefrDefault ?? DEFAULT_CEFR_DEFAULT,
        notionDatabases,
        learningPresets,
        supportedActions,
      };
    } catch (error) {
      logger.warn('Failed to load job options from orchestrator. Falling back to static config.', {
        error: error instanceof Error ? error.message : String(error),
      });
      return loadStaticJobOptions();
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

async function loadStaticJobOptions(): Promise<JobOptionsResponse> {
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
    notionDatabases,
    learningPresets: [...STATIC_OPTIONS.learningPresets],
    uploadOptions: [...STATIC_OPTIONS.uploadOptions],
    ttsStrategies: [...STATIC_OPTIONS.ttsStrategies],
    supportedActions,
  };
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
    cefrLevels: [...value.cefrLevels],
    notionDatabases: value.notionDatabases.map((option) => ({ ...option })),
    uploadOptions: [...value.uploadOptions],
    ttsStrategies: [...value.ttsStrategies],
    supportedActions: value.supportedActions.map((action) => ({ ...action })),
    learningPresets: value.learningPresets.map((preset) => ({ ...preset })),
  };
}
