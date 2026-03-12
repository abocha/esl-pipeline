import yaml from 'js-yaml';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  ConfigurationError,
  InfrastructureError,
  ValidationError,
  type VoiceProviderErrorCategory,
  noopLogger,
  normalizeSpeakerRole,
} from '@esl-pipeline/contracts';
import {
  type Frontmatter,
  type SpeakerProfile,
  extractFrontmatter,
  extractPronunciationShadowFocus,
  extractStudyText,
} from '@esl-pipeline/pmd';
import { runProviderFallbackLadder } from '@esl-pipeline/provider-runtime';
import {
  type BuildPronunciationShadowSentenceInput,
  type BuildPronunciationShadowSentenceOptions,
  type BuildPronunciationShadowSentenceResult,
  type BuildStudyTextInput,
  type BuildStudyTextOptions,
  type BuildStudyTextResult,
  type GoogleTtsModel,
  type SpeakerVoiceAssignment,
  type TtsProviderAdapter,
  type VoiceCatalog,
  hashStudyText,
} from '@esl-pipeline/tts-core';

import {
  concatMp3Segments,
  resolveFfmpegPath,
  setMp3TitleMetadata,
  synthSilenceMp3,
} from './ffmpeg.js';
import { type GoogleVoiceListEntry, listGoogleVoices, synthesizeGoogleSpeech } from './google.js';

const GOOGLE_TTS_BYTE_LIMIT = 5000;
const GOOGLE_TTS_MODEL_FAMILIES = ['chirp3_hd', 'studio', 'neural2', 'wavenet'] as const;
const DEFAULT_GOOGLE_TTS_MODEL: GoogleTtsModel = 'chirp3_hd';
const GOOGLE_VOICE_CATALOG_TTL_MS = 15 * 60 * 1000;
const CANONICAL_ROLE = ['narrator', 'teacher', 'student', 'system'] as const;
const CANONICAL_AGE = [
  'child',
  'teen',
  'young',
  'adult',
  'middle_aged',
  'senior',
  'universal',
] as const;

const DEFAULT_GOOGLE_VOICE_BY_MODEL: Record<GoogleTtsModel, string> = {
  chirp3_hd: 'en-US-Chirp3-HD-Charon',
  studio: 'en-US-Studio-O',
  neural2: 'en-US-Neural2-F',
  wavenet: 'en-US-Wavenet-F',
};

interface VoiceMapConfig extends Record<string, unknown> {
  default?: unknown;
}

interface StudyTextSegment {
  speaker?: string;
  text: string;
  raw: string;
}

interface GoogleSpeakerAssignment {
  speaker: string;
  voiceName: string;
  source: SpeakerVoiceAssignment['source'];
  catalogVoice: GoogleCatalogVoice;
  score?: number;
  selectionReason: string;
  capabilityMatches?: string[];
  capabilityMismatches?: string[];
}

interface ResolvedVoiceLanguage {
  voiceName: string;
  languageCode: string;
}

interface GoogleCatalogVoice {
  name: string;
  modelFamily: GoogleTtsModel;
  locale: string;
  language: string;
  gender: 'male' | 'female' | 'neutral';
  accent: string;
}

interface GoogleCatalogSnapshot {
  generatedAt: string;
  voices: GoogleCatalogVoice[];
}

interface GoogleCatalogCacheEntry {
  expiresAtMs: number;
  snapshot: GoogleCatalogSnapshot;
}

type GoogleAccentSelectionTier = 'exact' | 'regional_close' | 'en_us_fallback' | 'general_en';

let googleCatalogCache: GoogleCatalogCacheEntry | null = null;

const MARKDOWN_STRIPPERS: [RegExp, string][] = [
  [/\r?\n/g, ' '],
  [/^\s*[-*+]\s+/, ''],
  [/^\s*\d+[\.)]\s+/, ''],
  [/\*\*(.+?)\*\*/g, '$1'],
  [/__(.+?)__/g, '$1'],
  [/\*(.+?)\*/g, '$1'],
  [/_([^_]+)_/g, '$1'],
  [/~~(.+?)~~/g, '$1'],
  [/`{1,3}([^`]+)`{1,3}/g, '$1'],
  [/!\[(.*?)\]\([^)]*\)/g, '$1'],
  [/\[(.+?)\]\((.+?)\)/g, '$1'],
  [/<[^>]+>/g, ''],
] as const;

export function resolveGoogleTtsModel(model?: string): GoogleTtsModel {
  const normalized = (model ?? process.env.ESL_TTS_PROVIDER_GOOGLE_MODEL ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '');

  if (!normalized) return DEFAULT_GOOGLE_TTS_MODEL;
  if (normalized === 'chirp3hd' || normalized === 'chirp_3_hd' || normalized === 'chirp3_hd') {
    return 'chirp3_hd';
  }
  if (normalized === 'studio') return 'studio';
  if (normalized === 'neural2' || normalized === 'neural_2') return 'neural2';
  if (normalized === 'wavenet' || normalized === 'wave_net') return 'wavenet';

  throw new ConfigurationError(
    `Unsupported ESL_TTS_PROVIDER_GOOGLE_MODEL "${model}". Use one of: ${GOOGLE_TTS_MODEL_FAMILIES.join(', ')}`,
  );
}

function resolveGoogleDefaultVoice(model: GoogleTtsModel): string {
  switch (model) {
    case 'chirp3_hd': {
      return (
        process.env.ESL_TTS_PROVIDER_GOOGLE_VOICE_CHIRP3_HD?.trim() ||
        DEFAULT_GOOGLE_VOICE_BY_MODEL.chirp3_hd
      );
    }
    case 'studio': {
      return (
        process.env.ESL_TTS_PROVIDER_GOOGLE_VOICE_STUDIO?.trim() ||
        DEFAULT_GOOGLE_VOICE_BY_MODEL.studio
      );
    }
    case 'neural2': {
      return (
        process.env.ESL_TTS_PROVIDER_GOOGLE_VOICE_NEURAL2?.trim() ||
        DEFAULT_GOOGLE_VOICE_BY_MODEL.neural2
      );
    }
    case 'wavenet': {
      return (
        process.env.ESL_TTS_PROVIDER_GOOGLE_VOICE_WAVENET?.trim() ||
        DEFAULT_GOOGLE_VOICE_BY_MODEL.wavenet
      );
    }
  }
}

function resolveGoogleLanguageCode(
  explicitLanguageCode: string | undefined,
  voiceName: string,
): string {
  const explicit = explicitLanguageCode?.trim();
  if (explicit) return normalizeLanguageCodeToken(explicit);

  const inferred = inferLocaleFromVoiceName(voiceName);
  if (inferred) return normalizeLanguageCodeToken(inferred);

  const envLanguageCode = process.env.ESL_TTS_PROVIDER_GOOGLE_LANGUAGE_CODE?.trim();
  if (envLanguageCode) return normalizeLanguageCodeToken(envLanguageCode);

  return 'en-US';
}

function resolveGoogleApiEndpoint(explicitEndpoint?: string): string | undefined {
  if (explicitEndpoint?.trim()) return explicitEndpoint.trim();
  const envEndpoint = process.env.ESL_TTS_PROVIDER_GOOGLE_API_ENDPOINT?.trim();
  if (envEndpoint) return envEndpoint;
  const location = process.env.ESL_TTS_PROVIDER_GOOGLE_LOCATION?.trim().toLowerCase();
  if (location === 'us' || location === 'eu') {
    return `${location}-texttospeech.googleapis.com`;
  }
  return undefined;
}

function resolveGoogleTtsByteLimit(): number {
  const raw = process.env.ESL_TTS_PROVIDER_GOOGLE_MAX_BYTES;
  if (!raw) return GOOGLE_TTS_BYTE_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return GOOGLE_TTS_BYTE_LIMIT;
  return Math.max(500, Math.floor(parsed));
}

function resolveSilenceTailSeconds(): number {
  const raw = process.env.ESL_TTS_PROVIDER_GOOGLE_SILENCE_TAIL_SECONDS;
  if (raw === undefined) return 0.4;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0.4;
  return parsed;
}

function normalizeVoiceMapToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeSpeakerToken(value: string | undefined | null): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(/[*_`~>#]/g, '')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/[:：]+$/g, '')
    .trim();
}

function normalizeAccentToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/g, '_');
  if (!normalized) return undefined;
  if (normalized.includes('american') || normalized === 'us') return 'american';
  if (normalized.includes('british') || normalized === 'uk') return 'british';
  if (normalized.includes('australian') || normalized === 'au') return 'australian';
  if (normalized.includes('indian') || normalized === 'in') return 'indian';
  if (normalized.includes('canadian') || normalized === 'ca') return 'canadian';
  if (normalized.includes('irish') || normalized === 'ie') return 'irish';
  if (normalized.includes('new_zealand') || normalized === 'nz' || normalized.includes('kiwi')) {
    return 'new_zealand';
  }
  if (normalized.includes('south_african') || normalized === 'za') return 'south_african';
  return normalized;
}

function normalizeLanguageCodeToken(value: string): string {
  const [langRaw, localeRaw] = value.trim().split('-', 2);
  if (!langRaw || !localeRaw) return value.trim();
  return `${langRaw.toLowerCase()}-${localeRaw.toUpperCase()}`;
}

function inferLocaleFromVoiceName(voiceName: string): string | undefined {
  const match = /^([a-z]{2,3}-[A-Z]{2,3})-/.exec(voiceName.trim());
  return match ? normalizeLanguageCodeToken(match[1] ?? '') : undefined;
}

function extractEnglishLocales(languageCodes: readonly string[], voiceName: string): string[] {
  const locales = new Set<string>();
  for (const raw of languageCodes) {
    const code = normalizeLanguageCodeToken(raw);
    if (code.toLowerCase().startsWith('en-')) {
      locales.add(code);
    }
  }
  const inferred = inferLocaleFromVoiceName(voiceName);
  if (inferred?.toLowerCase().startsWith('en-')) {
    locales.add(inferred);
  }
  return [...locales].sort((a, b) => a.localeCompare(b));
}

function resolveModelFamilyFromVoiceName(voiceName: string): GoogleTtsModel | undefined {
  const name = voiceName.toLowerCase();
  if (name.includes('-chirp3-hd-')) return 'chirp3_hd';
  if (name.includes('-studio-')) return 'studio';
  if (name.includes('-neural2-')) return 'neural2';
  if (name.includes('-wavenet-')) return 'wavenet';
  return undefined;
}

function normalizeGoogleGender(value: string | undefined): 'male' | 'female' | 'neutral' {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized.includes('female')) return 'female';
  if (normalized.includes('male')) return 'male';
  return 'neutral';
}

function deriveAccentFromLocale(locale: string): string {
  const normalized = locale.trim().toUpperCase();
  if (normalized.endsWith('-US')) return 'american';
  if (normalized.endsWith('-GB')) return 'british';
  if (normalized.endsWith('-AU')) return 'australian';
  if (normalized.endsWith('-IN')) return 'indian';
  if (normalized.endsWith('-CA')) return 'canadian';
  if (normalized.endsWith('-IE')) return 'irish';
  if (normalized.endsWith('-NZ')) return 'new_zealand';
  if (normalized.endsWith('-ZA')) return 'south_african';
  return normalized.toLowerCase().replaceAll('-', '_');
}

function buildFallbackGoogleCatalogSnapshot(): GoogleCatalogSnapshot {
  const generatedAt = new Date().toISOString();
  const fallbackVoices: GoogleCatalogVoice[] = GOOGLE_TTS_MODEL_FAMILIES.map((modelFamily) => {
    const name = resolveGoogleDefaultVoice(modelFamily);
    const locale = inferLocaleFromVoiceName(name) ?? 'en-US';
    return {
      name,
      modelFamily,
      locale,
      language: locale.split('-')[0] ?? 'en',
      gender: 'neutral',
      accent: deriveAccentFromLocale(locale),
    };
  });
  return { generatedAt, voices: fallbackVoices };
}

function buildGoogleCatalogSnapshotFromList(
  rawVoices: readonly GoogleVoiceListEntry[],
): GoogleCatalogSnapshot {
  const normalized: GoogleCatalogVoice[] = [];
  for (const raw of rawVoices) {
    const name = raw.name.trim();
    if (!name) continue;
    const modelFamily = resolveModelFamilyFromVoiceName(name);
    if (!modelFamily) continue;
    const locales = extractEnglishLocales(raw.languageCodes, name);
    if (locales.length === 0) continue;
    for (const locale of locales) {
      normalized.push({
        name,
        modelFamily,
        locale,
        language: (locale.split('-')[0] ?? 'en').toLowerCase(),
        gender: normalizeGoogleGender(raw.ssmlGender),
        accent: deriveAccentFromLocale(locale),
      });
    }
  }

  normalized.sort(
    (a, b) =>
      a.modelFamily.localeCompare(b.modelFamily) ||
      a.locale.localeCompare(b.locale) ||
      a.name.localeCompare(b.name),
  );

  if (normalized.length === 0) {
    return buildFallbackGoogleCatalogSnapshot();
  }

  return {
    generatedAt: new Date().toISOString(),
    voices: normalized,
  };
}

async function loadGoogleCatalogSnapshot(): Promise<GoogleCatalogSnapshot> {
  const now = Date.now();
  if (googleCatalogCache && now < googleCatalogCache.expiresAtMs) {
    return googleCatalogCache.snapshot;
  }

  try {
    const apiEndpoint = resolveGoogleApiEndpoint();
    const rawVoices = await listGoogleVoices(apiEndpoint ? { apiEndpoint } : undefined);
    const snapshot = buildGoogleCatalogSnapshotFromList(rawVoices);
    googleCatalogCache = {
      expiresAtMs: now + GOOGLE_VOICE_CATALOG_TTL_MS,
      snapshot,
    };
    return snapshot;
  } catch {
    const snapshot = buildFallbackGoogleCatalogSnapshot();
    googleCatalogCache = {
      expiresAtMs: now + GOOGLE_VOICE_CATALOG_TTL_MS,
      snapshot,
    };
    return snapshot;
  }
}

function buildVoiceLookupByName(
  snapshot: GoogleCatalogSnapshot,
): Map<string, GoogleCatalogVoice[]> {
  const lookup = new Map<string, GoogleCatalogVoice[]>();
  for (const voice of snapshot.voices) {
    const list = lookup.get(voice.name) ?? [];
    list.push(voice);
    lookup.set(voice.name, list);
  }
  return lookup;
}

function resolveGoogleVoiceMapValue(voiceMap: VoiceMapConfig, speaker: string): string | undefined {
  const direct = normalizeVoiceMapToken((voiceMap as Record<string, unknown>)[speaker]);
  if (direct) return direct;

  const normalizedSpeaker = normalizeSpeakerToken(speaker);
  const entry = Object.entries(voiceMap).find(
    ([key]) => normalizeSpeakerToken(key) === normalizedSpeaker,
  );
  return entry ? normalizeVoiceMapToken(entry[1]) : undefined;
}

function findSpeakerProfile(
  profiles: SpeakerProfile[] | undefined,
  speaker: string,
): SpeakerProfile | undefined {
  if (!profiles?.length) return undefined;
  const exactId = profiles.find((profile) => profile.id === speaker);
  if (exactId) return exactId;
  const exactDisplay = profiles.find((profile) => profile.display_name === speaker);
  if (exactDisplay) return exactDisplay;
  const normalizedSpeaker = normalizeSpeakerToken(speaker);
  return profiles.find(
    (profile) =>
      normalizeSpeakerToken(profile.id) === normalizedSpeaker ||
      normalizeSpeakerToken(profile.display_name ?? '') === normalizedSpeaker,
  );
}

function guessGenderFromName(name: string): 'male' | 'female' | 'neutral' {
  const normalized = normalizeSpeakerToken(name);
  if (!normalized) return 'neutral';
  if (/[ae]$/.test(normalized) || /(anna|maria|olga|sofia|eva|lisa|emma)$/.test(normalized)) {
    return 'female';
  }
  if (/(alex|john|mike|jack|dan|peter|paul|martin)$/.test(normalized)) {
    return 'male';
  }
  return 'neutral';
}

function resolveVoiceFromToken(
  token: string,
  voiceLookupByName: Map<string, GoogleCatalogVoice[]>,
): GoogleCatalogVoice | undefined {
  const trimmed = token.trim();
  if (!trimmed) return undefined;
  const exact = voiceLookupByName.get(trimmed)?.[0];
  if (exact) return exact;
  const lower = trimmed.toLowerCase();
  for (const [name, voices] of voiceLookupByName.entries()) {
    if (name.toLowerCase() === lower) {
      return voices[0];
    }
  }
  return undefined;
}

function describeSupportedVoicesForModelFamily(
  modelFamily: GoogleTtsModel,
  voices: readonly GoogleCatalogVoice[],
): string {
  const sample = voices
    .filter((voice) => voice.modelFamily === modelFamily)
    .slice(0, 8)
    .map((voice) => voice.name);
  if (sample.length === 0) return '(none)';
  return sample.join(', ');
}

function describeAccentTier(tier: GoogleAccentSelectionTier): string {
  switch (tier) {
    case 'exact': {
      return 'exact accent match';
    }
    case 'regional_close': {
      return 'regional close accent fallback';
    }
    case 'en_us_fallback': {
      return 'en-US fallback';
    }
    case 'general_en': {
      return 'general en-* fallback';
    }
  }
}

function buildGoogleSelectionReason(args: {
  source: SpeakerVoiceAssignment['source'];
  accentTier?: GoogleAccentSelectionTier;
  preferredAccent?: string;
  selectedAccent?: string;
  selectedLocale?: string;
}): string {
  const source = args.source;
  switch (source) {
    case 'profile': {
      return 'Selected from speaker_profiles.voice override.';
    }
    case 'voiceMap': {
      return 'Selected from voices.yml explicit speaker mapping.';
    }
    case 'default': {
      return 'Selected from voices.yml default mapping.';
    }
    case 'fallback': {
      if (args.accentTier) {
        const preferred = args.preferredAccent ?? 'unspecified';
        return (
          `Selected from accent fallback ladder (${describeAccentTier(args.accentTier)}). ` +
          `Preferred accent: "${preferred}", selected: "${args.selectedAccent ?? 'unknown'}" (${args.selectedLocale ?? 'unknown locale'}).`
        );
      }
      return 'Selected from accent fallback ladder after capability-aware scoring.';
    }
    case 'reuse': {
      return 'Selected by controlled reuse fallback.';
    }
    default: {
      if (args.accentTier) {
        const preferred = args.preferredAccent ?? 'unspecified';
        return (
          `Selected by Google capability-aware heuristic scoring (${describeAccentTier(args.accentTier)}). ` +
          `Preferred accent: "${preferred}", selected: "${args.selectedAccent ?? 'unknown'}" (${args.selectedLocale ?? 'unknown locale'}).`
        );
      }
      return 'Selected by Google capability-aware heuristic scoring.';
    }
  }
}

function buildGoogleCapabilityDiagnostics(
  profile: SpeakerProfile | undefined,
  voice: GoogleCatalogVoice,
): Pick<GoogleSpeakerAssignment, 'capabilityMatches' | 'capabilityMismatches'> {
  if (!profile) {
    return {};
  }

  const matches: string[] = [];
  const mismatches: string[] = [];
  const expectedGender =
    typeof profile.gender === 'string' ? profile.gender.trim().toLowerCase() : undefined;
  const expectedAccent = normalizeAccentToken(
    typeof profile.accent === 'string' ? profile.accent : undefined,
  );
  const normalizedRole = normalizeSpeakerRole(profile.role);
  const expectedStyle =
    typeof profile.style === 'string' ? profile.style.trim().toLowerCase() : undefined;

  if (expectedGender && expectedGender !== 'neutral') {
    if (voice.gender === expectedGender) {
      matches.push(`gender: ${expectedGender}`);
    } else {
      mismatches.push(`gender: expected "${expectedGender}" got "${voice.gender}"`);
    }
  }

  if (expectedAccent) {
    if (voice.accent === expectedAccent) {
      matches.push(`accent: ${expectedAccent}`);
    } else {
      mismatches.push(`accent: expected "${expectedAccent}" got "${voice.accent}"`);
    }
  }

  if (normalizedRole) {
    matches.push(`role: ${normalizedRole}`);
  }
  if (expectedStyle) {
    matches.push(`style: ${expectedStyle}`);
  }

  return {
    capabilityMatches: matches.length > 0 ? matches : undefined,
    capabilityMismatches: mismatches.length > 0 ? mismatches : undefined,
  };
}

function assertVoiceInSelectedModelFamily(args: {
  voice: GoogleCatalogVoice;
  modelFamily: GoogleTtsModel;
  source: SpeakerVoiceAssignment['source'];
  speaker?: string;
  availableVoices: readonly GoogleCatalogVoice[];
}): void {
  if (args.voice.modelFamily === args.modelFamily) return;
  const speakerSuffix = args.speaker ? ` for speaker "${args.speaker}"` : '';
  const supported = describeSupportedVoicesForModelFamily(args.modelFamily, args.availableVoices);
  throw new ConfigurationError(
    `Google voice "${args.voice.name}"${speakerSuffix} is ${args.voice.modelFamily}, but selected model family is ${args.modelFamily}. ` +
      `Update ${args.source === 'profile' ? 'speaker_profiles.voice' : 'voices.yml/default voice'} to a ${args.modelFamily} voice, or change googleTtsModel. ` +
      `Sample ${args.modelFamily} voices: ${supported}`,
  );
}

const REGIONAL_ACCENT_GROUPS: readonly (readonly string[])[] = [
  ['american', 'canadian'],
  ['british', 'irish'],
  ['australian', 'new_zealand'],
];

function resolveRegionalCloseAccents(preferredAccent: string | undefined): Set<string> {
  if (!preferredAccent) return new Set<string>();
  const normalizedPreferred = normalizeAccentToken(preferredAccent);
  if (!normalizedPreferred) return new Set<string>();
  for (const group of REGIONAL_ACCENT_GROUPS) {
    if (!group.includes(normalizedPreferred)) continue;
    return new Set(group.filter((accent) => accent !== normalizedPreferred));
  }
  return new Set<string>();
}

function resolveGoogleAccentTier(args: {
  voice: GoogleCatalogVoice;
  preferredAccent?: string;
  regionalCloseAccents: Set<string>;
}): { rank: number; tier: GoogleAccentSelectionTier } {
  const preferredAccent = normalizeAccentToken(args.preferredAccent);
  if (preferredAccent && args.voice.accent === preferredAccent) {
    return { rank: 0, tier: 'exact' };
  }
  if (args.regionalCloseAccents.has(args.voice.accent)) {
    return { rank: 1, tier: 'regional_close' };
  }
  if (args.voice.locale.toUpperCase().endsWith('-US')) {
    return { rank: 2, tier: 'en_us_fallback' };
  }
  return { rank: 3, tier: 'general_en' };
}

function scoreGoogleVoiceCandidate(args: {
  speaker: string;
  voice: GoogleCatalogVoice;
  profile: SpeakerProfile | undefined;
}): number {
  const profileGender =
    typeof args.profile?.gender === 'string' ? args.profile.gender.trim().toLowerCase() : undefined;
  const preferredGender =
    profileGender && profileGender !== 'neutral'
      ? profileGender
      : guessGenderFromName(args.speaker);

  let score = 0;
  if (preferredGender && preferredGender !== 'neutral') {
    if (args.voice.gender === preferredGender) {
      score += 45;
    } else {
      score -= 20;
    }
  }

  const role = normalizeSpeakerRole(args.profile?.role);
  if (role === 'narrator') {
    score += args.voice.gender === 'female' ? 6 : 3;
  } else if (role === 'teacher') {
    score += 2;
  }

  const style =
    typeof args.profile?.style === 'string' ? args.profile.style.trim().toLowerCase() : '';
  if (style.includes('narrat') && args.voice.gender === 'female') {
    score += 2;
  }
  if (style.includes('convers') && args.voice.gender !== 'neutral') {
    score += 1;
  }

  return score;
}

export function resetGoogleVoiceCatalogCacheForTests(): void {
  googleCatalogCache = null;
}

function cleanSpeechText(text: string): string {
  let sanitized = text;
  for (const [pattern, replacement] of MARKDOWN_STRIPPERS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  sanitized = sanitized.replaceAll(/[*_`~>#]/g, '');
  sanitized = sanitized.replaceAll(/\s+/g, ' ').trim();
  return sanitized;
}

function cleanSpeakerName(name: string): string {
  return cleanSpeechText(name);
}

function parseSpeaker(line: string): { speaker?: string; text: string } {
  const idx = line.indexOf(':');
  if (idx > 0 && idx < 40) {
    return { speaker: line.slice(0, idx).trim(), text: line.slice(idx + 1).trim() };
  }
  return { text: line.trim() };
}

function collectSpeakers(segments: StudyTextSegment[], frontmatter: Frontmatter): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (name: string | undefined | null) => {
    const trimmed = typeof name === 'string' ? cleanSpeakerName(name) : '';
    if (!trimmed) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    ordered.push(trimmed);
  };

  for (const segment of segments) {
    add(segment.speaker);
  }

  if (Array.isArray(frontmatter.speaker_labels)) {
    const hasNarratorInSegments = segments.some(
      (segment) => segment.speaker?.trim().toLowerCase() === 'narrator',
    );
    const hasAnySegmentSpeakers = ordered.length > 0;
    for (const label of frontmatter.speaker_labels) {
      if (typeof label !== 'string') continue;
      const trimmed = cleanSpeakerName(label);
      if (!trimmed) continue;
      if (trimmed.toLowerCase() === 'narrator' && hasAnySegmentSpeakers && !hasNarratorInSegments) {
        continue;
      }
      add(trimmed);
    }
  }

  if (ordered.length === 0 && Array.isArray(frontmatter.speaker_profiles)) {
    const firstProfile = frontmatter.speaker_profiles.find(
      (profile) => typeof profile?.id === 'string',
    );
    if (firstProfile?.id) add(firstProfile.id);
  }

  if (ordered.length === 0) {
    add('Narrator');
  }

  return ordered;
}

function resolveStudyTextSegments(lines: string[], frontmatter: Frontmatter): StudyTextSegment[] {
  const segments: StudyTextSegment[] = [];
  const labelOrder = Array.isArray(frontmatter.speaker_labels)
    ? frontmatter.speaker_labels
        .map((label) => (typeof label === 'string' ? cleanSpeakerName(label) : ''))
        .filter(Boolean)
    : [];
  const nonNarratorFallback = labelOrder.find((label) => label.toLowerCase() !== 'narrator');
  const singleFallback = labelOrder.length === 1 ? labelOrder[0] : undefined;
  let lastSpeaker: string | undefined;

  for (const raw of lines) {
    const { speaker, text } = parseSpeaker(raw);
    let resolvedSpeaker = speaker ? cleanSpeakerName(speaker) : undefined;
    if (!resolvedSpeaker && lastSpeaker) {
      resolvedSpeaker = lastSpeaker;
    } else if (!resolvedSpeaker && !lastSpeaker) {
      resolvedSpeaker = nonNarratorFallback ?? singleFallback;
    }
    if (resolvedSpeaker) {
      lastSpeaker = resolvedSpeaker;
    }
    segments.push({ speaker: resolvedSpeaker, text, raw });
  }

  return segments;
}

function splitIntoSentences(text: string): string[] {
  const normalized = text.replaceAll(/\s+/g, ' ').trim();
  if (!normalized) return [];
  return normalized.split(/(?<=[.!?])\s+/);
}

function chunkTextForTts(text: string, maxChars: number): string[] {
  const normalized = text.replaceAll('\r\n', '\n').trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  let current = '';

  const push = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = '';
  };

  const addPiece = (piece: string) => {
    const p = piece.trim();
    if (!p) return;
    if (!current) {
      current = p;
      return;
    }
    if (current.length + 1 + p.length <= maxChars) {
      current = `${current} ${p}`;
      return;
    }
    push();
    current = p;
  };

  const paragraphs = normalized.split(/\n{2,}/);
  for (const paragraph of paragraphs) {
    const para = paragraph.trim();
    if (!para) continue;
    if (para.length <= maxChars) {
      addPiece(para);
      continue;
    }

    const sentences = splitIntoSentences(para);
    if (sentences.length <= 1) {
      for (let i = 0; i < para.length; i += maxChars) {
        addPiece(para.slice(i, i + maxChars));
      }
      continue;
    }

    for (const sentence of sentences) {
      if (sentence.length <= maxChars) {
        addPiece(sentence);
        continue;
      }
      for (let i = 0; i < sentence.length; i += maxChars) {
        addPiece(sentence.slice(i, i + maxChars));
      }
    }
  }

  push();
  return chunks;
}

function byteLengthUtf8(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function splitByUtf8ByteLimit(text: string, maxBytes: number): string[] {
  const normalized = text.replaceAll(/\s+/g, ' ').trim();
  if (!normalized) return [];
  if (byteLengthUtf8(normalized) <= maxBytes) return [normalized];

  const words = normalized.split(' ');
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = '';
  };

  for (const word of words) {
    if (!word) continue;
    const candidate = current ? `${current} ${word}` : word;
    if (byteLengthUtf8(candidate) <= maxBytes) {
      current = candidate;
      continue;
    }

    if (current) {
      pushCurrent();
    }

    if (byteLengthUtf8(word) <= maxBytes) {
      current = word;
      continue;
    }

    let overflow = word;
    while (overflow.length > 0) {
      let idx = Math.min(overflow.length, maxBytes);
      while (idx > 1 && byteLengthUtf8(overflow.slice(0, idx)) > maxBytes) {
        idx -= 1;
      }
      chunks.push(overflow.slice(0, idx));
      overflow = overflow.slice(idx);
    }
  }

  pushCurrent();
  return chunks;
}

function chunkTextForGoogle(text: string, maxBytes: number): string[] {
  const candidateChunks = chunkTextForTts(text, maxBytes);
  const chunks: string[] = [];
  for (const chunk of candidateChunks) {
    if (byteLengthUtf8(chunk) <= maxBytes) {
      chunks.push(chunk);
      continue;
    }
    chunks.push(...splitByUtf8ByteLimit(chunk, maxBytes));
  }
  return chunks;
}

function sanitizeStudentName(student?: unknown): string {
  if (typeof student !== 'string') return '';
  const trimmed = student.trim();
  if (!trimmed) return '';
  const normalized = trimmed
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036F]/g, '')
    .toLowerCase();
  const slug = normalized.replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
  return slug;
}

function buildOutputFileName(hash: string, frontmatter: Frontmatter): string {
  const prefix = sanitizeStudentName(frontmatter.student);
  return prefix ? `${prefix}-${hash}.mp3` : `${hash}.mp3`;
}

function buildShadowSentenceOutputFileName(hash: string, frontmatter: Frontmatter): string {
  const prefix = sanitizeStudentName(frontmatter.student);
  return prefix ? `${prefix}-${hash}-shadow-sentence.mp3` : `${hash}-shadow-sentence.mp3`;
}

async function fileExistsNonEmpty(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.size > 0;
  } catch {
    return false;
  }
}

async function loadVoiceMap(path: string): Promise<VoiceMapConfig> {
  const voiceMapContent = await readFile(path, 'utf8');
  const rawVoiceMap = yaml.load(voiceMapContent) ?? {};
  return typeof rawVoiceMap === 'object' && rawVoiceMap
    ? (rawVoiceMap as VoiceMapConfig)
    : ({} as VoiceMapConfig);
}

interface ResolvedStudyTextPlan {
  frontmatter: Frontmatter;
  segments: StudyTextSegment[];
  normalizedText: string;
  modelFamily: GoogleTtsModel;
  voiceAssignments: Record<string, string>;
  speakerAssignments: GoogleSpeakerAssignment[];
  voiceSummaries: BuildStudyTextResult['voices'];
}

async function resolveStudyTextPlan(
  input: BuildStudyTextInput,
  opts: BuildStudyTextOptions,
): Promise<ResolvedStudyTextPlan> {
  const frontmatter = extractFrontmatter(input.context);
  const studyText = extractStudyText(input.context);
  const segments = resolveStudyTextSegments(studyText.lines, frontmatter);
  const sanitizedSegments = segments
    .map((segment) => cleanSpeechText(segment.text))
    .filter((segment) => segment.length > 0);
  const normalizedText = sanitizedSegments.join('\n');

  const modelFamily = resolveGoogleTtsModel(opts.googleTtsModel);
  const catalogSnapshot = await loadGoogleCatalogSnapshot();
  const voiceLookupByName = buildVoiceLookupByName(catalogSnapshot);
  const modelVoices = catalogSnapshot.voices.filter((voice) => voice.modelFamily === modelFamily);
  if (modelVoices.length === 0) {
    throw new ConfigurationError(
      `No Google voices are available for model family "${modelFamily}" in english locales.`,
    );
  }

  const providerDefaultVoiceName = resolveGoogleDefaultVoice(modelFamily);
  const providerDefaultVoice =
    resolveVoiceFromToken(providerDefaultVoiceName, voiceLookupByName) ?? modelVoices[0]!;

  const voiceMap = await loadVoiceMap(opts.voiceMapPath);
  if (opts.defaultVoiceId) {
    voiceMap.default = opts.defaultVoiceId;
  }

  const speakers = collectSpeakers(segments, frontmatter);
  const speakerAssignments: GoogleSpeakerAssignment[] = [];
  const usedAutoVoices = new Set<string>();

  for (const speaker of speakers) {
    const profile = findSpeakerProfile(frontmatter.speaker_profiles, speaker);
    const explicitProfileToken = normalizeVoiceMapToken(profile?.voice);
    const explicitVoiceMapToken = resolveGoogleVoiceMapValue(voiceMap, speaker);
    const explicitDefaultToken = normalizeVoiceMapToken(voiceMap.default);

    const assignResolvedVoice = (args: {
      voice: GoogleCatalogVoice;
      source: SpeakerVoiceAssignment['source'];
      score?: number;
      profile: SpeakerProfile | undefined;
      selectionReason?: string;
    }) => {
      const diagnostics = buildGoogleCapabilityDiagnostics(args.profile, args.voice);
      speakerAssignments.push({
        speaker,
        voiceName: args.voice.name,
        source: args.source,
        catalogVoice: args.voice,
        score: args.score,
        selectionReason:
          args.selectionReason ??
          buildGoogleSelectionReason({
            source: args.source,
          }),
        capabilityMatches: diagnostics.capabilityMatches,
        capabilityMismatches: diagnostics.capabilityMismatches,
      });
    };

    if (explicitProfileToken) {
      const resolved = resolveVoiceFromToken(explicitProfileToken, voiceLookupByName);
      if (!resolved) {
        throw new ConfigurationError(
          `Google voice "${explicitProfileToken}" from speaker_profiles.voice for "${speaker}" ` +
            `does not exist in the current Google english voice catalog.`,
        );
      }
      assertVoiceInSelectedModelFamily({
        voice: resolved,
        modelFamily,
        source: 'profile',
        speaker,
        availableVoices: catalogSnapshot.voices,
      });
      assignResolvedVoice({ voice: resolved, source: 'profile', profile });
      usedAutoVoices.add(resolved.name);
      continue;
    }

    if (explicitVoiceMapToken) {
      const resolved = resolveVoiceFromToken(explicitVoiceMapToken, voiceLookupByName);
      if (!resolved) {
        throw new ConfigurationError(
          `Google voice "${explicitVoiceMapToken}" from voices.yml mapping for "${speaker}" ` +
            `does not exist in the current Google english voice catalog.`,
        );
      }
      assertVoiceInSelectedModelFamily({
        voice: resolved,
        modelFamily,
        source: 'voiceMap',
        speaker,
        availableVoices: catalogSnapshot.voices,
      });
      assignResolvedVoice({ voice: resolved, source: 'voiceMap', profile });
      usedAutoVoices.add(resolved.name);
      continue;
    }

    if (explicitDefaultToken) {
      const resolved = resolveVoiceFromToken(explicitDefaultToken, voiceLookupByName);
      if (!resolved) {
        throw new ConfigurationError(
          `Google voice "${explicitDefaultToken}" from voices.yml default does not exist in the current Google english voice catalog.`,
        );
      }
      assertVoiceInSelectedModelFamily({
        voice: resolved,
        modelFamily,
        source: 'default',
        speaker,
        availableVoices: catalogSnapshot.voices,
      });
      assignResolvedVoice({ voice: resolved, source: 'default', profile });
      usedAutoVoices.add(resolved.name);
      continue;
    }

    const preferredAccent = normalizeAccentToken(
      typeof profile?.accent === 'string' ? profile.accent : opts.defaultAccent,
    );
    const regionalCloseAccents = resolveRegionalCloseAccents(preferredAccent);
    const scoredCandidates = modelVoices
      .map((voice) => ({
        voice,
        score: scoreGoogleVoiceCandidate({ speaker, voice, profile }),
        accentTier: resolveGoogleAccentTier({
          voice,
          preferredAccent,
          regionalCloseAccents,
        }),
      }))
      .sort(
        (a, b) =>
          a.accentTier.rank - b.accentTier.rank ||
          b.score - a.score ||
          a.voice.locale.localeCompare(b.voice.locale) ||
          a.voice.name.localeCompare(b.voice.name),
      );

    const preferred = scoredCandidates.find(
      (candidate) => !usedAutoVoices.has(candidate.voice.name),
    );
    const selected = preferred ?? scoredCandidates[0];
    if (!selected) {
      assignResolvedVoice({ voice: providerDefaultVoice, source: 'reuse', profile });
      usedAutoVoices.add(providerDefaultVoice.name);
      continue;
    }

    const source: SpeakerVoiceAssignment['source'] = preferred
      ? selected.accentTier.rank <= 1
        ? 'auto'
        : 'fallback'
      : 'reuse';

    const selectionReason =
      source === 'reuse'
        ? undefined
        : buildGoogleSelectionReason({
            source,
            accentTier: selected.accentTier.tier,
            preferredAccent,
            selectedAccent: selected.voice.accent,
            selectedLocale: selected.voice.locale,
          });

    assignResolvedVoice({
      voice: selected.voice,
      source,
      score: source === 'reuse' ? undefined : selected.score,
      profile,
      selectionReason,
    });
    usedAutoVoices.add(selected.voice.name);
  }

  const voiceAssignments = Object.fromEntries(
    speakerAssignments.map((assignment) => [assignment.speaker, assignment.voiceName]),
  );

  const voiceSummaries = speakerAssignments.map((assignment) => ({
    speaker: assignment.speaker,
    voiceId: assignment.voiceName,
    source: assignment.source,
    score: assignment.score,
    voiceName: assignment.voiceName,
    gender: assignment.catalogVoice.gender,
    accent: assignment.catalogVoice.accent,
    useCase: assignment.catalogVoice.modelFamily,
    selectionReason: assignment.selectionReason,
    capabilityMatches: assignment.capabilityMatches,
    capabilityMismatches: assignment.capabilityMismatches,
  }));

  return {
    frontmatter,
    segments,
    normalizedText,
    modelFamily,
    voiceAssignments,
    speakerAssignments,
    voiceSummaries,
  };
}

function buildResolvedVoiceLanguages(
  assignments: GoogleSpeakerAssignment[],
  explicitLanguageCode: string | undefined,
): ResolvedVoiceLanguage[] {
  const uniqueVoices = [...new Set(assignments.map((assignment) => assignment.voiceName))].sort(
    (a, b) => a.localeCompare(b),
  );
  return uniqueVoices.map((voiceName) => ({
    voiceName,
    languageCode: resolveGoogleLanguageCode(explicitLanguageCode, voiceName),
  }));
}

class SynthesisRuntimeError extends InfrastructureError {
  readonly category: VoiceProviderErrorCategory;
  readonly retryable: boolean;

  constructor(args: { message: string; category: VoiceProviderErrorCategory; retryable: boolean }) {
    super(args.message);
    this.name = 'SynthesisRuntimeError';
    this.category = args.category;
    this.retryable = args.retryable;
  }
}

function extractErrorCode(error: unknown): number | undefined {
  const direct = Number((error as { code?: unknown } | undefined)?.code);
  if (Number.isFinite(direct)) return direct;
  const nested = Number((error as { details?: { code?: unknown } } | undefined)?.details?.code);
  if (Number.isFinite(nested)) return nested;
  return undefined;
}

export function classifyGoogleTtsProviderError(error: unknown): VoiceProviderErrorCategory {
  const status = extractErrorCode(error);
  if (status === 8) return 'provider_rate_limit';
  if (status === 4 || status === 14) return 'provider_timeout';
  return 'provider_contract_error';
}

function mapGoogleSynthesisRuntimeError(
  error: unknown,
  context: { voiceName: string; text: string },
): SynthesisRuntimeError {
  if (error instanceof SynthesisRuntimeError) {
    return error;
  }

  const status = extractErrorCode(error);
  const isRateLimit = status === 8;
  const isTimeout = status === 4 || status === 14;
  const retryable = isRateLimit || isTimeout;
  const category = classifyGoogleTtsProviderError(error);
  const message = error instanceof Error ? error.message : String(error);

  return new SynthesisRuntimeError({
    category,
    retryable,
    message:
      `Failed to synthesize line with Google voice "${context.voiceName}" ` +
      `[${category}]: ${message}\nLine: ${context.text}`,
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function synthesizeGoogleChunkWithRetry(
  text: string,
  voiceName: string,
  outFile: string,
  options: {
    languageCode: string;
    apiEndpoint?: string;
    modelName?: string;
  },
  maxAttempts = 3,
): Promise<void> {
  const retryBudget = Math.max(0, maxAttempts - 1);
  let backoffAttempt = 0;
  const candidate = { text, voiceName, outFile };

  await runProviderFallbackLadder<typeof candidate, void, SynthesisRuntimeError>({
    candidates: [candidate],
    runCandidate: async (current) => {
      const audio = await synthesizeGoogleSpeech(
        {
          text: current.text,
          voiceName: current.voiceName,
          languageCode: options.languageCode,
          modelName: options.modelName,
        },
        { apiEndpoint: options.apiEndpoint },
      );
      await writeFile(current.outFile, audio);
    },
    mapError: (current, error) => mapGoogleSynthesisRuntimeError(error, current),
    isTimeoutError: (mappedError) => mappedError.retryable,
    isFailFastError: (mappedError) => !mappedError.retryable,
    getRetryMax: () => retryBudget,
    getRetryBackoffMs: () => {
      const backoffMs = 400 * Math.pow(2, backoffAttempt);
      backoffAttempt += 1;
      return backoffMs;
    },
    sleep: wait,
  });
}

export async function buildStudyTextMp3Google(
  input: BuildStudyTextInput,
  opts: BuildStudyTextOptions,
): Promise<BuildStudyTextResult> {
  const plan = await resolveStudyTextPlan(input, opts);
  const {
    frontmatter,
    segments,
    normalizedText,
    modelFamily,
    speakerAssignments,
    voiceAssignments,
    voiceSummaries,
  } = plan;
  const modelName =
    opts.googleModelName ?? process.env.ESL_TTS_PROVIDER_GOOGLE_MODEL_NAME ?? undefined;
  const voiceLanguages = buildResolvedVoiceLanguages(speakerAssignments, opts.googleLanguageCode);

  const hashInput = JSON.stringify({
    provider: 'google',
    modelFamily,
    modelName,
    voiceLanguages,
    text: normalizedText,
    voices: voiceAssignments,
  });
  const hash = hashStudyText(hashInput);
  const fileName = buildOutputFileName(hash, frontmatter);
  const outputDir = resolve(opts.outPath || (input.mdPath ? dirname(input.mdPath) : process.cwd()));
  const targetPath = resolve(outputDir, fileName);

  if (opts.preview) {
    return {
      path: targetPath,
      hash,
      duration: undefined,
      provider: 'google',
      voices: voiceSummaries,
      voiceAssignments,
      cachedCharacters: normalizedText.length,
      generatedCharacters: 0,
    };
  }

  await mkdir(outputDir, { recursive: true });

  if (!opts.force && (await fileExistsNonEmpty(targetPath))) {
    return {
      path: targetPath,
      hash,
      duration: undefined,
      provider: 'google',
      voices: voiceSummaries,
      voiceAssignments,
      cachedCharacters: normalizedText.length,
      generatedCharacters: 0,
    };
  }

  const defaultVoice = speakerAssignments[0]?.voiceName ?? resolveGoogleDefaultVoice(modelFamily);
  const maxBytes = resolveGoogleTtsByteLimit();
  const apiEndpoint = resolveGoogleApiEndpoint(opts.googleApiEndpoint);
  const segmentFiles: string[] = [];
  const transientFiles: string[] = [];
  let generatedCharacters = 0;
  let cachedCharacters = 0;

  interface TtsRun {
    voiceName: string;
    lines: string[];
  }
  const runs: TtsRun[] = [];
  let currentRun: TtsRun | null = null;
  let pendingParagraphBreak = false;

  const flushRun = () => {
    if (!currentRun) return;
    while (currentRun.lines.length > 0 && currentRun.lines.at(-1) === '') {
      currentRun.lines.pop();
    }
    if (currentRun.lines.length > 0) {
      runs.push(currentRun);
    }
    currentRun = null;
  };

  for (const segment of segments) {
    const normalizedSpeaker = segment.speaker?.trim() ?? '';
    let voiceName =
      normalizedSpeaker && voiceAssignments[normalizedSpeaker]
        ? voiceAssignments[normalizedSpeaker]
        : undefined;

    if (!voiceName && normalizedSpeaker) {
      const byCaseInsensitive = speakerAssignments.find(
        (assignment) => assignment.speaker.toLowerCase() === normalizedSpeaker.toLowerCase(),
      );
      voiceName = byCaseInsensitive?.voiceName;
    }

    if (!voiceName) {
      voiceName = defaultVoice;
    }

    const speechText = cleanSpeechText(segment.text);
    if (!speechText) {
      pendingParagraphBreak = true;
      continue;
    }

    if (!voiceName) {
      throw new ConfigurationError(
        `No Google voice could be resolved for line "${segment.raw}". ` +
          'Add voices.yml mappings or set ESL_TTS_PROVIDER_GOOGLE_VOICE_* defaults.',
      );
    }

    if (currentRun && currentRun.voiceName !== voiceName) {
      flushRun();
    }
    if (!currentRun) {
      currentRun = { voiceName, lines: [] };
    }
    if (pendingParagraphBreak && currentRun.lines.length > 0) {
      currentRun.lines.push('');
      pendingParagraphBreak = false;
    }
    currentRun.lines.push(speechText);
  }
  flushRun();

  for (const run of runs) {
    const runText = run.lines
      .join('\n')
      .replaceAll(/\n{3,}/g, '\n\n')
      .trim();
    const chunks = chunkTextForGoogle(runText, maxBytes);
    const languageCode = resolveGoogleLanguageCode(opts.googleLanguageCode, run.voiceName);
    for (const chunkText of chunks) {
      const chunkHashInput = JSON.stringify({
        provider: 'google',
        voiceName: run.voiceName,
        languageCode,
        modelFamily,
        modelName,
        text: chunkText,
      });
      const chunkHash = createHash('sha256').update(chunkHashInput).digest('hex');
      const chunkFileName = `${chunkHash}.mp3`;
      const chunkFilePath = resolve(outputDir, chunkFileName);

      if (!opts.force && (await fileExistsNonEmpty(chunkFilePath))) {
        segmentFiles.push(chunkFilePath);
        cachedCharacters += chunkText.length;
        continue;
      }

      await synthesizeGoogleChunkWithRetry(chunkText, run.voiceName, chunkFilePath, {
        languageCode,
        apiEndpoint,
        modelName,
      });
      generatedCharacters += chunkText.length;
      segmentFiles.push(chunkFilePath);
    }
  }

  if (segmentFiles.length === 0) {
    throw new ValidationError(
      'TTS produced 0 segments. Check voices.yml (default/auto) and study-text content.',
    );
  }

  const tailSeconds = resolveSilenceTailSeconds();
  const concatFiles = [...segmentFiles];
  const needsSilence = tailSeconds > 0.01;
  const needsConcat = segmentFiles.length > 1 || needsSilence;
  let resolvedFfmpeg: string | undefined;

  if (needsConcat) {
    resolvedFfmpeg = await resolveFfmpegPath(opts.ffmpegPath);
  }

  if (needsSilence) {
    const silenceFileName = `${hash}-silence.mp3`;
    const silencePath = resolve(outputDir, silenceFileName);
    await synthSilenceMp3(silencePath, tailSeconds, resolvedFfmpeg);
    concatFiles.push(silencePath);
    transientFiles.push(silencePath);
  }

  try {
    if (concatFiles.length === 1) {
      await copyFile(concatFiles[0]!, targetPath);
    } else if (concatFiles.length > 1) {
      await concatMp3Segments(concatFiles, targetPath, true, resolvedFfmpeg);
    }
  } finally {
    await Promise.allSettled(transientFiles.map((p) => unlink(p)));
  }

  const titleMeta =
    typeof frontmatter.title === 'string' && frontmatter.title.trim().length > 0
      ? frontmatter.title.trim()
      : '';
  if (titleMeta) {
    await setMp3TitleMetadata(targetPath, titleMeta, resolvedFfmpeg ?? opts.ffmpegPath);
  }

  return {
    path: targetPath,
    duration: undefined,
    hash,
    provider: 'google',
    voices: voiceSummaries,
    voiceAssignments,
    generatedCharacters,
    cachedCharacters,
  };
}

export async function buildPronunciationShadowSentenceMp3Google(
  input: BuildPronunciationShadowSentenceInput,
  opts: BuildPronunciationShadowSentenceOptions,
): Promise<BuildPronunciationShadowSentenceResult> {
  if (!input.voiceId?.trim()) {
    throw new ValidationError('voiceId is required for pronunciation shadow sentence synthesis.');
  }

  const logger = opts.logger ?? noopLogger;
  const frontmatter = extractFrontmatter(input.context);
  const shadowFocus = extractPronunciationShadowFocus(input.context);
  if (!shadowFocus) {
    throw new ValidationError(
      'Pronunciation shadow sentence mode not found. Add "**Mode:** shadow_sentence" under section C.',
    );
  }

  const sentence = cleanSpeechText(shadowFocus.shadowSentence ?? '');
  if (!sentence) {
    throw new ValidationError(
      'Pronunciation shadow sentence is empty. Add "**Shadow sentence:** <sentence>" under section C.',
    );
  }

  const outputDir = resolve(opts.outPath || (input.mdPath ? dirname(input.mdPath) : process.cwd()));
  await mkdir(outputDir, { recursive: true });

  const modelFamily = resolveGoogleTtsModel(opts.googleTtsModel);
  const voiceName = input.voiceId.trim();
  const languageCode = resolveGoogleLanguageCode(opts.googleLanguageCode, voiceName);
  const apiEndpoint = resolveGoogleApiEndpoint(opts.googleApiEndpoint);
  const modelName =
    opts.googleModelName ?? process.env.ESL_TTS_PROVIDER_GOOGLE_MODEL_NAME ?? undefined;

  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        kind: 'pronunciation_shadow_sentence',
        provider: 'google',
        text: sentence,
        voiceId: voiceName,
        modelFamily,
        modelName,
        languageCode,
      }),
    )
    .digest('hex');

  const targetPath = resolve(outputDir, buildShadowSentenceOutputFileName(hash, frontmatter));
  const generatedCharacters = sentence.length;

  if (opts.preview) {
    return {
      path: targetPath,
      duration: undefined,
      hash,
      provider: 'google',
      voiceId: voiceName,
      generatedCharacters,
      cachedCharacters: 0,
    };
  }

  if (!opts.force && (await fileExistsNonEmpty(targetPath))) {
    return {
      path: targetPath,
      duration: undefined,
      hash,
      provider: 'google',
      voiceId: voiceName,
      generatedCharacters: 0,
      cachedCharacters: generatedCharacters,
    };
  }

  logger.log({
    level: 'info',
    stage: 'tts',
    message: 'Generating pronunciation shadow sentence audio',
    detail: {
      provider: 'google',
      voiceName,
      modelFamily,
      languageCode,
    },
  });

  await synthesizeGoogleChunkWithRetry(sentence, voiceName, targetPath, {
    languageCode,
    apiEndpoint,
    modelName,
  });

  const titleMeta =
    typeof frontmatter.title === 'string' && frontmatter.title.trim().length > 0
      ? `${frontmatter.title.trim()} — Pronunciation Shadow Sentence`
      : '';
  if (titleMeta) {
    await setMp3TitleMetadata(targetPath, titleMeta, await resolveFfmpegPath(opts.ffmpegPath));
  }

  return {
    path: targetPath,
    duration: undefined,
    hash,
    provider: 'google',
    voiceId: voiceName,
    generatedCharacters,
    cachedCharacters: 0,
  };
}

export async function loadGoogleVoicesCatalog(): Promise<VoiceCatalog> {
  const snapshot = await loadGoogleCatalogSnapshot();
  const accents = new Set<string>();
  const genders = new Set<'male' | 'female' | 'neutral'>();
  const styles = new Set<GoogleTtsModel>();
  const byVoiceName = new Map<string, GoogleCatalogVoice>();

  for (const voice of snapshot.voices) {
    accents.add(voice.accent);
    genders.add(voice.gender);
    styles.add(voice.modelFamily);
    const existing = byVoiceName.get(voice.name);
    if (!existing || voice.locale < existing.locale) {
      byVoiceName.set(voice.name, voice);
    }
  }

  return {
    generatedAt: snapshot.generatedAt,
    capabilities: {
      generatedAt: snapshot.generatedAt,
      provider: 'google',
      role: [...CANONICAL_ROLE],
      gender: [...new Set(genders.size > 0 ? genders : ['female', 'male', 'neutral'])].sort(),
      age: [...CANONICAL_AGE],
      accent: [...accents].sort(),
      style: [...styles].sort(),
    },
    voices: [...byVoiceName.values()].map((voice) => ({
      id: voice.name,
      name: voice.name,
      category: 'google',
      labels: {
        provider: 'google',
        model_family: voice.modelFamily,
        locale: voice.locale,
        language: voice.language,
        gender: voice.gender,
        accent: voice.accent,
      },
      useCase: voice.modelFamily,
      verifiedLanguages: [{ language: voice.language, locale: voice.locale }],
    })),
  };
}

export async function resolveGoogleSpeakerAssignments(
  input: BuildStudyTextInput,
  options: BuildStudyTextOptions,
): Promise<SpeakerVoiceAssignment[]> {
  const plan = await resolveStudyTextPlan(input, options);
  return plan.speakerAssignments.map((assignment) => ({
    speaker: assignment.speaker,
    voiceId: assignment.voiceName,
    source: assignment.source,
    score: assignment.score,
    selectionReason: assignment.selectionReason,
    capabilityMatches: assignment.capabilityMatches,
    capabilityMismatches: assignment.capabilityMismatches,
  }));
}

export function createGoogleTtsProvider(): TtsProviderAdapter {
  return {
    id: 'google',
    providerMetadata(args) {
      return {
        provider: 'google',
        modelFamily: resolveGoogleTtsModel(
          args.studyTextOptions?.googleTtsModel ?? args.shadowOptions?.googleTtsModel,
        ),
        pricingToken: 'GOOGLE_TTS',
      };
    },
    classifyProviderError(error) {
      return classifyGoogleTtsProviderError(error);
    },
    voice: {
      async loadCatalog() {
        return loadGoogleVoicesCatalog();
      },
      async resolveSpeakerAssignments(args) {
        return resolveGoogleSpeakerAssignments(args.input, args.options);
      },
      buildVoiceDiagnostics() {
        return;
      },
    },
    async synthesizeStudyText(input, options) {
      return buildStudyTextMp3Google(input, { ...options, ttsProvider: 'google' });
    },
    async synthesizeShadowSentence(input, options) {
      return buildPronunciationShadowSentenceMp3Google(input, {
        ...options,
        ttsProvider: 'google',
      });
    },
  };
}

export { resolveFfmpegPath, FfmpegNotFoundError } from './ffmpeg.js';
