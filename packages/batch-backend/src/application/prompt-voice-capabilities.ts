import { createHash } from 'node:crypto';

import type { VoiceCapabilitiesSnapshot } from '@esl-pipeline/contracts';
import { loadVoicesCatalog as loadElevenLabsVoicesCatalog } from '@esl-pipeline/tts-provider-elevenlabs';
import { loadGoogleVoicesCatalog } from '@esl-pipeline/tts-provider-google';

const CANONICAL_ROLE: VoiceCapabilitiesSnapshot['role'] = [
  'narrator',
  'teacher',
  'student',
  'system',
];
const CANONICAL_GENDER: VoiceCapabilitiesSnapshot['gender'] = [
  'male',
  'female',
  'neutral',
  'child',
];
const CANONICAL_AGE: VoiceCapabilitiesSnapshot['age'] = [
  'child',
  'teen',
  'young',
  'adult',
  'middle_aged',
  'senior',
  'universal',
];
const GOOGLE_TTS_MODEL_STYLE_DENY_LIST = new Set(['chirp3_hd', 'studio', 'wavenet', 'neural2']);

interface VoiceCatalogLike {
  generatedAt?: unknown;
  capabilities?: unknown;
  voices?: {
    labels?: Record<string, unknown>;
    useCase?: unknown;
  }[];
}

export interface PromptVoiceCapabilitiesResolution {
  blockText: string;
  capabilitiesSnapshot: VoiceCapabilitiesSnapshot;
  capabilitiesHash: string;
  capabilitiesGeneratedAt: Date;
}

export async function resolvePromptVoiceCapabilities(params: {
  templateId: string;
}): Promise<PromptVoiceCapabilitiesResolution> {
  const snapshot = await loadMergedVoiceCapabilitiesSnapshot();
  if (!snapshot) {
    throw new Error(
      `Voice-aligned prompt packages require a voice capabilities snapshot for "${params.templateId}". ` +
        'Sync ElevenLabs voices or configure Google TTS credentials.',
    );
  }

  const capabilitiesHash = createHash('sha256')
    .update(JSON.stringify(snapshot), 'utf8')
    .digest('hex');
  const generatedAt = new Date(snapshot.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error(
      `Voice capabilities snapshot for "${params.templateId}" has an invalid generatedAt value.`,
    );
  }

  return {
    blockText: formatVoiceCapabilitiesBlock(snapshot),
    capabilitiesSnapshot: snapshot,
    capabilitiesHash,
    capabilitiesGeneratedAt: generatedAt,
  };
}

async function loadElevenLabsVoiceCapabilitiesSnapshot(): Promise<VoiceCapabilitiesSnapshot | null> {
  try {
    const catalog = await loadElevenLabsVoicesCatalog();
    return parseCapabilitiesSnapshot(catalog as VoiceCatalogLike);
  } catch {
    return null;
  }
}

async function loadGoogleVoiceCapabilitiesSnapshot(): Promise<VoiceCapabilitiesSnapshot | null> {
  try {
    const catalog = await loadGoogleVoicesCatalog();
    return parseCapabilitiesSnapshot(catalog as VoiceCatalogLike);
  } catch {
    return null;
  }
}

async function loadMergedVoiceCapabilitiesSnapshot(): Promise<VoiceCapabilitiesSnapshot | null> {
  const [elevenLabs, google] = await Promise.all([
    loadElevenLabsVoiceCapabilitiesSnapshot(),
    loadGoogleVoiceCapabilitiesSnapshot(),
  ]);
  return mergeVoiceCapabilitySnapshots(
    [elevenLabs, google].filter(Boolean) as VoiceCapabilitiesSnapshot[],
  );
}

function mergeVoiceCapabilitySnapshots(
  snapshots: VoiceCapabilitiesSnapshot[],
): VoiceCapabilitiesSnapshot | null {
  if (snapshots.length === 0) return null;

  const generatedAt = snapshots
    .map((snapshot) => new Date(snapshot.generatedAt).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0];
  const generatedAtIso =
    typeof generatedAt === 'number'
      ? new Date(generatedAt).toISOString()
      : new Date().toISOString();

  const role = new Set<string>();
  const gender = new Set<string>();
  const age = new Set<string>();
  const accent = new Set<string>();
  const style = new Set<string>();

  for (const snapshot of snapshots) {
    for (const value of snapshot.role ?? []) role.add(value);
    for (const value of snapshot.gender ?? []) gender.add(value);
    for (const value of snapshot.age ?? []) age.add(value);
    for (const value of snapshot.accent ?? []) accent.add(value);
    for (const value of snapshot.style ?? []) style.add(value);
  }

  return normalizeSnapshot({
    generatedAt: generatedAtIso,
    role: [...(role.size > 0 ? role : CANONICAL_ROLE)] as VoiceCapabilitiesSnapshot['role'],
    gender: [
      ...(gender.size > 0 ? gender : CANONICAL_GENDER),
    ] as VoiceCapabilitiesSnapshot['gender'],
    age: [...(age.size > 0 ? age : CANONICAL_AGE)] as VoiceCapabilitiesSnapshot['age'],
    accent: [...accent],
    style: [...style],
  });
}

function parseCapabilitiesSnapshot(catalog: VoiceCatalogLike): VoiceCapabilitiesSnapshot | null {
  if (catalog.capabilities && typeof catalog.capabilities === 'object') {
    const parsed = catalog.capabilities as Partial<VoiceCapabilitiesSnapshot>;
    if (
      Array.isArray(parsed.role) &&
      Array.isArray(parsed.gender) &&
      Array.isArray(parsed.age) &&
      Array.isArray(parsed.accent) &&
      Array.isArray(parsed.style)
    ) {
      return normalizeSnapshot({
        generatedAt:
          typeof parsed.generatedAt === 'string'
            ? parsed.generatedAt
            : typeof catalog.generatedAt === 'string'
              ? catalog.generatedAt
              : new Date().toISOString(),
        role: parsed.role as VoiceCapabilitiesSnapshot['role'],
        gender: parsed.gender as VoiceCapabilitiesSnapshot['gender'],
        age: parsed.age as VoiceCapabilitiesSnapshot['age'],
        accent: parsed.accent as string[],
        style: parsed.style as string[],
      });
    }
  }

  if (!Array.isArray(catalog.voices) || catalog.voices.length === 0) return null;

  const accents = new Set<string>();
  const styles = new Set<string>();
  const ages = new Set<VoiceCapabilitiesSnapshot['age'][number]>();
  const genders = new Set<VoiceCapabilitiesSnapshot['gender'][number]>();
  for (const voice of catalog.voices) {
    const labels = voice.labels ?? {};
    for (const value of splitValues(labels.accent)) {
      const normalized = normalizeAccent(value);
      if (normalized) accents.add(normalized);
    }
    for (const value of [
      ...splitValues(labels.descriptive),
      ...splitValues(labels.style),
      ...splitValues(labels.use_case),
      ...splitValues(voice.useCase),
    ]) {
      const normalized = normalizeStyle(value);
      if (normalized) styles.add(normalized);
    }
    for (const value of splitValues(labels.age)) {
      const normalized = normalizeEnum(value);
      if (CANONICAL_AGE.includes(normalized as VoiceCapabilitiesSnapshot['age'][number])) {
        ages.add(normalized as VoiceCapabilitiesSnapshot['age'][number]);
      }
    }
    for (const value of splitValues(labels.gender)) {
      const normalized = normalizeEnum(value);
      if (CANONICAL_GENDER.includes(normalized as VoiceCapabilitiesSnapshot['gender'][number])) {
        genders.add(normalized as VoiceCapabilitiesSnapshot['gender'][number]);
      }
    }
  }

  return normalizeSnapshot({
    generatedAt:
      typeof catalog.generatedAt === 'string' ? catalog.generatedAt : new Date().toISOString(),
    role: [...CANONICAL_ROLE],
    gender: [...(genders.size > 0 ? genders : CANONICAL_GENDER)],
    age: [...(ages.size > 0 ? ages : CANONICAL_AGE)],
    accent: [...accents],
    style: [...styles],
  });
}

function normalizeSnapshot(snapshot: VoiceCapabilitiesSnapshot): VoiceCapabilitiesSnapshot {
  const generatedAt = new Date(snapshot.generatedAt);
  return {
    generatedAt: Number.isNaN(generatedAt.getTime())
      ? new Date().toISOString()
      : generatedAt.toISOString(),
    role: [
      ...new Set(snapshot.role.map((value) => normalizeEnum(value))),
    ].sort() as VoiceCapabilitiesSnapshot['role'],
    gender: [
      ...new Set(snapshot.gender.map((value) => normalizeEnum(value))),
    ].sort() as VoiceCapabilitiesSnapshot['gender'],
    age: [
      ...new Set(snapshot.age.map((value) => normalizeEnum(value))),
    ].sort() as VoiceCapabilitiesSnapshot['age'],
    accent: [
      ...new Set(snapshot.accent.map((value) => normalizeAccent(value)).filter(Boolean)),
    ].sort(),
    style: [
      ...new Set(snapshot.style.map((value) => normalizeStyle(value)).filter(Boolean)),
    ].sort(),
  };
}

function formatVoiceCapabilitiesBlock(snapshot: VoiceCapabilitiesSnapshot): string {
  return [
    '[VOICE_CAPABILITIES]',
    `generated_at: ${snapshot.generatedAt}`,
    `role: ${formatInlineList(snapshot.role)}`,
    `gender: ${formatInlineList(snapshot.gender)}`,
    `age: ${formatInlineList(snapshot.age)}`,
    `accent: ${formatInlineList(snapshot.accent)}`,
    `style: ${formatInlineList(snapshot.style)}`,
  ].join('\n');
}

function formatInlineList(values: readonly string[]): string {
  if (values.length === 0) return '[]';
  return `[${values.join(', ')}]`;
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/g, '_')
    .replaceAll(/[^a-z0-9_]/g, '');
}

function normalizeEnum(value: string): string {
  return normalizeToken(value);
}

function normalizeAccent(value: string): string {
  const normalized = normalizeToken(value);
  if (!normalized) return '';
  if (normalized.includes('american')) return 'american';
  if (normalized.includes('british')) return 'british';
  if (normalized.includes('australian')) return 'australian';
  if (normalized.includes('canadian')) return 'canadian';
  if (normalized.includes('irish')) return 'irish';
  if (normalized.includes('scottish')) return 'scottish';
  if (normalized.includes('indian')) return 'indian';
  if (normalized.includes('south_african')) return 'south_african';
  return normalized;
}

function normalizeStyle(value: string): string {
  const normalized = normalizeToken(value);
  if (!normalized) return '';
  if (GOOGLE_TTS_MODEL_STYLE_DENY_LIST.has(normalized)) return '';
  if (normalized.includes('conversation')) return 'conversational';
  if (normalized.includes('narrative') || normalized.includes('story')) return 'narrative_story';
  if (normalized.includes('informative')) return 'informative_educational';
  if (normalized.includes('social') && normalized.includes('media')) return 'social_media';
  if (normalized.includes('character')) return 'characters_animation';
  if (normalized.includes('entertainment')) return 'entertainment_tv';
  return normalized;
}

function splitValues(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[;,/|]/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
