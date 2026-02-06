import type { NotionDatabaseOption, VoiceOption } from '@esl-pipeline/contracts';

export interface ResolveNotionDatabasesFromEnvOptions {
  rawList?: string | undefined;
  singleDbId?: string | undefined;
  singleDbName?: string | undefined;
  fallback?: NotionDatabaseOption[];
}

export function resolveNotionDatabasesFromEnv(
  options: ResolveNotionDatabasesFromEnvOptions = {},
): NotionDatabaseOption[] {
  const rawList = options.rawList ?? process.env.NOTION_DB_OPTIONS;
  if (rawList) {
    const parsed = rawList
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
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

  const singleDbId =
    options.singleDbId ??
    process.env.NOTION_DATABASE_ID?.trim() ??
    process.env.NOTION_DB_ID?.trim() ??
    undefined;
  if (singleDbId) {
    const singleName =
      options.singleDbName ??
      process.env.NOTION_DB_NAME?.trim() ??
      process.env.NOTION_DB_LABEL?.trim() ??
      'Primary database';
    return [{ id: singleDbId, name: singleName }];
  }

  return options.fallback ? options.fallback.map((entry) => ({ ...entry })) : [];
}

export interface VoiceCatalogLike {
  voices?: Array<{
    id?: unknown;
    name?: unknown;
    category?: unknown;
    labels?: Record<string, unknown> | null;
  }>;
}

export function normalizeVoiceCatalogToOptions(catalog: VoiceCatalogLike | undefined): {
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
  const voiceAccents = [
    ...new Set(voices.map((voice) => (voice.accent ? voice.accent.trim() : '')).filter(Boolean)),
  ];

  return { voices, voiceAccents };
}

function normalizeToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.toLowerCase().replaceAll(/\s+/g, '_');
}

