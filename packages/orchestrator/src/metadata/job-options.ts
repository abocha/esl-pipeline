import type { OrchestratorPipeline, ResolvedConfigPaths } from '../pipeline.js';
import type { ConfigProvider, StudentProfile } from '../config.js';
import { loadVoicesCatalog, type VoiceCatalog } from '@esl-pipeline/tts-elevenlabs';

export type UploadOption = 'auto' | 's3' | 'none';
export type JobModeOption = 'auto' | 'dialogue' | 'monologue';

export type NotionDatabaseOption = {
  id: string;
  name: string;
};

export type VoiceOption = {
  id: string;
  name: string;
  accent?: string | null;
  gender?: string | null;
  category?: string | null;
};

export type JobOptionsPayload = {
  presets: string[];
  voiceAccents: string[];
  voices: VoiceOption[];
  notionDatabases: NotionDatabaseOption[];
  uploadOptions: UploadOption[];
  modes: JobModeOption[];
};

type ResolveJobOptionsSource = Pick<OrchestratorPipeline, 'configProvider' | 'configPaths'> | {
  configProvider: ConfigProvider;
  configPaths: ResolvedConfigPaths;
};

const DEFAULT_UPLOAD_OPTIONS: UploadOption[] = ['auto', 's3', 'none'];
const DEFAULT_JOB_MODES: JobModeOption[] = ['auto', 'dialogue', 'monologue'];

export async function resolveJobOptions(source: ResolveJobOptionsSource): Promise<JobOptionsPayload> {
  const { configProvider, configPaths } = source;

  const [presetsMap, studentProfiles, voiceCatalog] = await Promise.all([
    configProvider.loadPresets(configPaths.presetsPath),
    configProvider.loadStudentProfiles(configPaths.studentsDir),
    loadVoicesCatalog(),
  ]);

  const presets = Object.keys(presetsMap ?? {}).sort((a, b) => a.localeCompare(b));
  const notionDatabases = extractNotionDatabases(studentProfiles);
  const { voices, voiceAccents } = normalizeVoiceCatalog(voiceCatalog);

  return {
    presets,
    voiceAccents,
    voices,
    notionDatabases,
    uploadOptions: [...DEFAULT_UPLOAD_OPTIONS],
    modes: [...DEFAULT_JOB_MODES],
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
    const label = typeof profile.student === 'string' && profile.student.trim().length > 0
      ? profile.student.trim()
      : raw;
    options.push({ id: raw, name: label });
  }

  return options.sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeVoiceCatalog(catalog: VoiceCatalog | undefined): {
  voices: VoiceOption[];
  voiceAccents: string[];
} {
  const voices: VoiceOption[] = [];
  if (catalog?.voices && Array.isArray(catalog.voices)) {
    for (const voice of catalog.voices) {
      const id = typeof voice.id === 'string' ? voice.id : undefined;
      const name = typeof voice.name === 'string' ? voice.name : undefined;
      if (!id || !name) continue;
      const accent = normalizeToken(voice.labels?.accent);
      const gender = normalizeToken(voice.labels?.gender);
      const accentToken = accent && gender ? `${accent}_${gender}` : accent;
      voices.push({
        id,
        name,
        category: typeof voice.category === 'string' ? voice.category : null,
        accent: accentToken ?? null,
        gender: gender ?? null,
      });
    }
  }

  voices.sort((a, b) => a.name.localeCompare(b.name));
  const voiceAccents = Array.from(
    new Set(
      voices
        .map(voice => (voice.accent ? voice.accent.trim() : ''))
        .filter((value): value is string => Boolean(value))
    )
  );

  return { voices, voiceAccents };
}

function normalizeToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.toLowerCase().replace(/\s+/g, '_');
}
