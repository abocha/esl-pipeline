import type {
  JobOptionsPayload,
  NotionDatabaseOption,
  TtsStrategyOption,
  UploadOption,
  VoiceOption,
} from '@esl-pipeline/contracts';
import {
  normalizeVoiceCatalogToOptions,
  resolveNotionDatabasesFromEnv as resolveNotionDatabasesFromEnvShared,
} from '@esl-pipeline/shared-infrastructure';
import { loadVoicesCatalog } from '@esl-pipeline/tts-elevenlabs';

import type { ConfigProvider, StudentProfile } from '../config.js';
import type { OrchestratorPipeline, ResolvedConfigPaths } from '../pipeline.js';

export type {
  JobOptionsPayload,
  NotionDatabaseOption,
  TtsStrategyOption,
  UploadOption,
  VoiceOption,
};

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

  return {
    presets,
    voiceAccents,
    voices,
    notionDatabases,
    uploadOptions: [...DEFAULT_UPLOAD_OPTIONS],
    ttsStrategies: [...DEFAULT_TTS_STRATEGIES],
  };
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
