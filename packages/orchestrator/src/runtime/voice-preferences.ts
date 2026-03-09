import { loadVoicesCatalog, type VoiceCatalog } from '@esl-pipeline/tts-core';

interface VoicePreferenceFlags {
  voiceId?: string;
  accentPreference?: string;
}

let cachedVoiceCatalog: VoiceCatalog | null = null;

async function getVoiceCatalog(): Promise<VoiceCatalog> {
  if (cachedVoiceCatalog) return cachedVoiceCatalog;
  cachedVoiceCatalog = await loadVoicesCatalog().catch<VoiceCatalog>(() => ({ voices: [] }));
  return cachedVoiceCatalog;
}

function findVoiceByToken(token: string, catalog: VoiceCatalog) {
  const normalized = token.trim().toLowerCase();
  return catalog.voices.find(
    (voice) =>
      voice.id === token ||
      (typeof voice.name === 'string' && voice.name.toLowerCase() === normalized),
  );
}

export async function applyVoicePreferences(flags: VoicePreferenceFlags): Promise<void> {
  const needsResolution = Boolean(flags.voiceId || flags.accentPreference);
  if (!needsResolution) return;

  const catalog = await getVoiceCatalog();
  if (flags.voiceId) {
    const match = findVoiceByToken(flags.voiceId, catalog);
    if (match) {
      flags.voiceId = match.id;
      if (!flags.accentPreference && typeof match.labels?.accent === 'string') {
        flags.accentPreference = match.labels.accent;
      }
      return;
    }
  }

  if (flags.accentPreference) {
    const match = findVoiceByToken(flags.accentPreference, catalog);
    if (match) {
      flags.voiceId = match.id;
      if (typeof match.labels?.accent === 'string') {
        flags.accentPreference = match.labels.accent;
      }
    }
  }
}

export function resetVoiceCatalogCache(): void {
  cachedVoiceCatalog = null;
}
