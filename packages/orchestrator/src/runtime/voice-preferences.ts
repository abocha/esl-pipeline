import { loadVoicesCatalog, type TtsProviderId, type VoiceCatalog } from '@esl-pipeline/tts-core';

interface VoicePreferenceFlags {
  voiceId?: string;
  accentPreference?: string;
  provider?: TtsProviderId;
  ttsProvider?: TtsProviderId;
}

interface ApplyVoicePreferenceOptions {
  fallbackToFirstCatalogVoice?: boolean;
  resolveAccentToVoiceId?: boolean;
}

const cachedVoiceCatalogs = new Map<string, VoiceCatalog>();

async function getVoiceCatalog(provider?: TtsProviderId): Promise<VoiceCatalog> {
  const cacheKey = provider ?? 'all';
  const cachedCatalog = cachedVoiceCatalogs.get(cacheKey);
  if (cachedCatalog) return cachedCatalog;
  const catalog = await loadVoicesCatalog(provider).catch<VoiceCatalog>(() => ({ voices: [] }));
  cachedVoiceCatalogs.set(cacheKey, catalog);
  return catalog;
}

function findVoiceByToken(token: string, catalog: VoiceCatalog) {
  const normalized = token.trim().toLowerCase();
  return catalog.voices.find(
    (voice) =>
      voice.id === token ||
      (typeof voice.name === 'string' && voice.name.toLowerCase() === normalized),
  );
}

function normalizeAccentToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/g, '_');
}

function findVoiceByAccent(token: string, catalog: VoiceCatalog) {
  const normalized = normalizeAccentToken(token);
  return catalog.voices.find((voice) => {
    const accentLabel = voice.labels?.accent;
    if (typeof accentLabel === 'string') {
      return normalizeAccentToken(accentLabel) === normalized;
    }
    if (Array.isArray(accentLabel)) {
      return accentLabel.some(
        (value) => typeof value === 'string' && normalizeAccentToken(value) === normalized,
      );
    }
    return false;
  });
}

function applyResolvedVoice(
  flags: VoicePreferenceFlags,
  voice: VoiceCatalog['voices'][number] | undefined,
): boolean {
  if (!voice?.id) return false;
  flags.voiceId = voice.id;
  if (typeof voice.labels?.accent === 'string') {
    flags.accentPreference = voice.labels.accent;
  }
  return true;
}

export async function applyVoicePreferences(
  flags: VoicePreferenceFlags,
  options: ApplyVoicePreferenceOptions = {},
): Promise<void> {
  const needsResolution = Boolean(
    flags.voiceId ||
      (flags.accentPreference && options.resolveAccentToVoiceId !== false) ||
      options.fallbackToFirstCatalogVoice,
  );
  if (!needsResolution) return;

  const catalog = await getVoiceCatalog(flags.provider ?? flags.ttsProvider);
  if (flags.voiceId) {
    const match = findVoiceByToken(flags.voiceId, catalog);
    if (applyResolvedVoice(flags, match)) {
      return;
    }
  }

  if (flags.accentPreference && options.resolveAccentToVoiceId !== false) {
    const match =
      findVoiceByToken(flags.accentPreference, catalog) ??
      findVoiceByAccent(flags.accentPreference, catalog);
    if (applyResolvedVoice(flags, match)) {
      return;
    }
  }

  if (options.fallbackToFirstCatalogVoice) {
    applyResolvedVoice(
      flags,
      catalog.voices.find((voice) => typeof voice.id === 'string'),
    );
  }
}

export function resetVoiceCatalogCache(): void {
  cachedVoiceCatalogs.clear();
}
