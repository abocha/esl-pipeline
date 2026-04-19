import type { VoiceOption } from '@esl-pipeline/contracts';

export interface VoiceCatalogLike {
  voices?: {
    id?: unknown;
    name?: unknown;
    category?: unknown;
    labels?: Record<string, unknown> | null;
  }[];
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
