// packages/batch-backend/src/application/get-job-options.ts
//
// Batch frontend metadata endpoint. Primarily proxies orchestrator config,
// with the static section below serving as a fallback when orchestration fails.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { logger } from '../infrastructure/logger';
import { getJobOptionsFromOrchestrator } from '../infrastructure/orchestrator-service';
import { getActionMetadata } from './job-actions/action-handler';

export type UploadOption = 'auto' | 's3' | 'none';
export type JobModeOption = 'auto' | 'dialogue' | 'monologue';

export interface NotionDatabaseOption {
  id: string;
  name: string;
}

export interface VoiceOption {
  id: string;
  name: string;
  accent?: string | null;
  gender?: string | null;
  category?: string | null;
}

export interface ActionCapability {
  type: string;
  label: string;
  description: string;
  implemented: boolean;
  requiresFields?: string[];
}

export interface JobOptionsResponse {
  presets: string[];
  voiceAccents: string[];
  voices: VoiceOption[];
  notionDatabases: NotionDatabaseOption[];
  uploadOptions: UploadOption[];
  modes: JobModeOption[];
  supportedActions: ActionCapability[];
}

// TODO: Replace these with data pulled from the orchestrator config provider or
// dedicated metadata service once available (tracked in backend/frontend Phase 5).
const STATIC_OPTIONS: Omit<JobOptionsResponse, 'supportedActions'> = {
  presets: ['b1-default'],
  voiceAccents: ['american_female', 'british_male'],
  voices: [],
  notionDatabases: [
    { id: 'notion-db-b1', name: 'B1 Lessons' },
    { id: 'notion-db-b2', name: 'B2 Lessons' },
  ],
  uploadOptions: ['auto', 's3', 'none'],
  modes: ['auto'],
};

export async function getJobOptions(): Promise<JobOptionsResponse> {
  try {
    const result = await getJobOptionsFromOrchestrator();
    // Add supported actions to orchestrator response
    const actionMetadata = getActionMetadata();
    const supportedActions: ActionCapability[] = Object.entries(actionMetadata).map(
      ([type, meta]) => ({ type, ...meta })
    );
    return {
      ...result,
      supportedActions,
    };
  } catch (error) {
    logger.warn('Failed to load job options from orchestrator. Falling back to static config.', {
      error: error instanceof Error ? error.message : String(error),
    });
    return loadStaticJobOptions();
  }
}

async function loadStaticJobOptions(): Promise<JobOptionsResponse> {
  const notionDatabases = resolveNotionDatabases();
  const voices = await loadVoiceOptions();
  const voiceAccents =
    voices.length > 0
      ? Array.from(
        new Set(
          voices
            .map(voice =>
              typeof voice.accent === 'string' ? voice.accent.trim() || undefined : undefined
            )
            .filter((accent): accent is string => Boolean(accent))
        )
      )
      : [...STATIC_OPTIONS.voiceAccents];

  const actionMetadata = getActionMetadata();
  const supportedActions: ActionCapability[] = Object.entries(actionMetadata).map(
    ([type, meta]) => ({ type, ...meta })
  );

  return {
    presets: [...STATIC_OPTIONS.presets],
    voiceAccents,
    voices,
    notionDatabases,
    uploadOptions: [...STATIC_OPTIONS.uploadOptions],
    modes: [...STATIC_OPTIONS.modes],
    supportedActions,
  };
}

function resolveNotionDatabases(): NotionDatabaseOption[] {
  const rawList = process.env.NOTION_DB_OPTIONS;
  if (rawList) {
    const parsed = rawList
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean)
      .map(entry => {
        const [idPart, ...nameParts] = entry.split(':');
        const id = idPart?.trim();
        if (!id) {
          return null;
        }
        const name = nameParts.length > 0 ? nameParts.join(':').trim() : undefined;
        return {
          id,
          name: name && name.length > 0 ? name : id,
        };
      })
      .filter((option): option is NotionDatabaseOption => option !== null);

    if (parsed.length > 0) {
      return parsed;
    }
  }

  const singleDbId = process.env.NOTION_DB_ID?.trim();
  if (singleDbId) {
    const singleName =
      process.env.NOTION_DB_NAME?.trim() || process.env.NOTION_DB_LABEL?.trim() || 'Primary database';
    return [{ id: singleDbId, name: singleName }];
  }

  return STATIC_OPTIONS.notionDatabases.map(db => ({ ...db }));
}

const VOICE_CATALOG_RELATIVE_PATH = 'configs/elevenlabs.voices.json';

async function loadVoiceOptions(): Promise<VoiceOption[]> {
  const candidates = getVoiceCatalogCandidates();
  for (const voiceFile of candidates) {
    try {
      const raw = await readFile(voiceFile, 'utf8');
      const parsed = JSON.parse(raw) as { voices?: Array<Record<string, any>> };
      if (!parsed?.voices || !Array.isArray(parsed.voices)) {
        continue;
      }

      return parsed.voices
        .map(voice => {
          const id = typeof voice.id === 'string' ? voice.id : undefined;
          const name = typeof voice.name === 'string' ? voice.name : undefined;
          if (!id || !name) {
            return null;
          }
          const labels = voice.labels ?? {};
          const normalizedAccent = normalizeLabel(labels.accent);
          const normalizedGender = normalizeLabel(labels.gender);
          const accentToken =
            normalizedAccent && normalizedGender
              ? `${normalizedAccent}_${normalizedGender}`
              : normalizedAccent ?? null;
          const option: VoiceOption = {
            id,
            name,
            category: typeof voice.category === 'string' ? voice.category : null,
            accent: accentToken,
            gender: normalizedGender,
          };
          return option;
        })
        .filter((voice): voice is VoiceOption => voice !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error: any) {
      if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
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
  const roots = [
    cwd,
    resolve(cwd, '..'),
    resolve(cwd, '..', '..'),
  ];
  const overridePath = process.env.ELEVENLABS_VOICES_PATH
    ? resolve(process.env.ELEVENLABS_VOICES_PATH)
    : null;
  const repoRootEnv = process.env.REPO_ROOT || process.env.APP_ROOT || process.env.PROJECT_ROOT;
  if (repoRootEnv) {
    roots.push(resolve(repoRootEnv));
  }
  const paths = [
    overridePath,
    ...roots.map(root => resolve(root, VOICE_CATALOG_RELATIVE_PATH)),
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(paths));
}

function normalizeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.replace(/\s+/g, '_');
}
