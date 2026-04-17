import type {
  SpeakerAge,
  SpeakerGender,
  SpeakerRole,
  VoiceCapabilitiesSnapshot,
} from '@esl-pipeline/contracts';

export type VoiceCapabilityKind = 'accent' | 'style' | 'age' | 'gender' | 'role';

interface VoiceLike {
  labels?: Record<string, unknown>;
  useCase?: string;
}

const CANONICAL_ROLE: SpeakerRole[] = ['narrator', 'teacher', 'student', 'system'];
const CANONICAL_GENDER: SpeakerGender[] = ['male', 'female', 'neutral', 'child'];
const CANONICAL_AGE: SpeakerAge[] = [
  'child',
  'teen',
  'young',
  'adult',
  'middle_aged',
  'senior',
  'universal',
];

const STYLE_ALLOWLIST = new Set([
  'advertisement',
  'professional',
  'calm',
  'casual',
  'chill',
  'classy',
  'confident',
  'crisp',
  'cute',
  'deep',
  'formal',
  'gentle',
  'hyped',
  'mature',
  'pleasant',
  'relaxed',
  'rough',
  'sassy',
  'upbeat',
  'conversational',
  'narrative_story',
  'informative_educational',
  'social_media',
  'characters_animation',
  'entertainment_tv',
]);

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[_\s]+/g, '-')
    .replaceAll(/[^a-z0-9-]/g, '');
}

function toComparableToken(value: string): string {
  return normalizeToken(value).replaceAll('-', '_');
}

function splitLabelValue(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[;,/|]/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeAccent(value: string): string {
  const normalized = normalizeToken(value).replaceAll('-', '_');
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
  const normalized = normalizeToken(value).replaceAll('-', '_');
  if (!normalized) return '';
  if (normalized.includes('conversation')) return 'conversational';
  if (normalized.includes('narrative') || normalized.includes('story')) return 'narrative_story';
  if (normalized.includes('informative')) return 'informative_educational';
  if (normalized.includes('social') && normalized.includes('media')) return 'social_media';
  if (normalized.includes('character')) return 'characters_animation';
  if (normalized.includes('entertainment')) return 'entertainment_tv';
  return normalized;
}

function addCapabilitiesFromVoice(
  voice: VoiceLike,
  accents: Set<string>,
  styles: Set<string>,
  ages: Set<string>,
  genders: Set<string>,
): void {
  const labels = voice.labels ?? {};
  for (const rawAccent of splitLabelValue(labels.accent)) {
    const accent = normalizeAccent(rawAccent);
    if (accent) accents.add(accent);
  }
  for (const rawStyle of [
    ...splitLabelValue(labels.descriptive),
    ...splitLabelValue(labels.style),
    ...splitLabelValue(labels.use_case),
    ...splitLabelValue(voice.useCase),
  ]) {
    const style = normalizeStyle(rawStyle);
    if (style && STYLE_ALLOWLIST.has(style)) styles.add(style);
  }
  for (const rawAge of splitLabelValue(labels.age)) {
    const normalized = toComparableToken(rawAge);
    const matched = CANONICAL_AGE.find((item) => item === normalized);
    if (matched) ages.add(matched);
  }
  for (const rawGender of splitLabelValue(labels.gender)) {
    const normalized = toComparableToken(rawGender);
    const matched = CANONICAL_GENDER.find((item) => item === normalized);
    if (matched) genders.add(matched);
  }
}

export function buildVoiceCapabilitiesSnapshot(
  voices: VoiceLike[],
  generatedAt = new Date().toISOString(),
): VoiceCapabilitiesSnapshot {
  const accents = new Set<string>();
  const styles = new Set<string>();
  const ages = new Set<string>();
  const genders = new Set<string>();

  for (const voice of voices) {
    addCapabilitiesFromVoice(voice, accents, styles, ages, genders);
  }

  return {
    generatedAt,
    role: [...CANONICAL_ROLE],
    gender: [...(genders.size > 0 ? genders : CANONICAL_GENDER)].sort() as SpeakerGender[],
    age: [...(ages.size > 0 ? ages : CANONICAL_AGE)].sort() as SpeakerAge[],
    accent: [...accents].sort(),
    style: [...styles].sort(),
  };
}

function normalizeSnapshot(snapshot: VoiceCapabilitiesSnapshot): VoiceCapabilitiesSnapshot {
  return {
    generatedAt: snapshot.generatedAt,
    role: [
      ...new Set(snapshot.role.map((value) => toComparableToken(value) as SpeakerRole)),
    ].sort(),
    gender: [
      ...new Set(snapshot.gender.map((value) => toComparableToken(value) as SpeakerGender)),
    ].sort(),
    age: [...new Set(snapshot.age.map((value) => toComparableToken(value) as SpeakerAge))].sort(),
    accent: [
      ...new Set(snapshot.accent.map((value) => normalizeAccent(value)).filter(Boolean)),
    ].sort(),
    style: [
      ...new Set(snapshot.style.map((value) => normalizeStyle(value)).filter(Boolean)),
    ].sort(),
  };
}

export function getVoiceCapabilities(catalog: {
  capabilities?: VoiceCapabilitiesSnapshot;
  voices?: VoiceLike[];
}): VoiceCapabilitiesSnapshot {
  if (catalog.capabilities) {
    return normalizeSnapshot(catalog.capabilities);
  }
  return buildVoiceCapabilitiesSnapshot(catalog.voices ?? []);
}

export function validateCapabilityValue(
  capabilities: VoiceCapabilitiesSnapshot,
  kind: VoiceCapabilityKind,
  value: string,
): boolean {
  const normalized = kind === 'accent' ? normalizeAccent(value) : normalizeStyle(value);
  if (kind === 'accent') return capabilities.accent.includes(normalized);
  if (kind === 'style') return capabilities.style.includes(normalized);
  if (kind === 'age') return capabilities.age.includes(toComparableToken(value) as SpeakerAge);
  if (kind === 'gender')
    return capabilities.gender.includes(toComparableToken(value) as SpeakerGender);
  return capabilities.role.includes(toComparableToken(value) as SpeakerRole);
}
