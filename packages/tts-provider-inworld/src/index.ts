import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  ApiError,
  InworldTTS,
  MissingApiKeyError,
  NetworkError,
  type VoiceInfo,
} from '@inworld/tts';
import yaml from 'js-yaml';

import {
  ConfigurationError,
  InfrastructureError,
  noopLogger,
  type SpeakerProfile,
  ValidationError,
  type VoiceProviderErrorCategory,
} from '@esl-pipeline/contracts';
import {
  extractFrontmatter,
  extractPronunciationShadowFocus,
  extractStudyText,
  type Frontmatter,
} from '@esl-pipeline/pmd';
import { runProviderFallbackLadder } from '@esl-pipeline/provider-runtime';
import {
  type BuildPronunciationShadowSentenceInput,
  type BuildPronunciationShadowSentenceOptions,
  type BuildPronunciationShadowSentenceResult,
  type BuildPronunciationTextInput,
  type BuildPronunciationTextOptions,
  type BuildPronunciationTextResult,
  type BuildStudyTextInput,
  type BuildStudyTextOptions,
  type BuildStudyTextResult,
  hashStudyText,
  INWORLD_TTS_MODELS,
  type InworldTtsModel,
  resolveTtsSelection,
  type SpeakerVoiceAssignment,
  type SpeechDeliveryMode,
  type SpeechPerformancePlanSegment,
  type TtsProviderAdapter,
  type VoiceAssignmentCapabilities,
  type VoiceCatalog,
  type VoicePlanRanker,
} from '@esl-pipeline/tts-core';

const DEFAULT_INWORLD_TTS_MODEL: InworldTtsModel = resolveInworldTtsModel();
const DEFAULT_INWORLD_VOICES = ['Ashley', 'Dennis'] as const;
const DEFAULT_SAMPLE_RATE_HERTZ = 48_000;
const DEFAULT_MAX_RETRIES = 2;
export const INWORLD_ASSEMBLY_MARGIN_POLICY = {
  sameSpeakerMs: 180,
  speakerSwitchMs: 320,
} as const;
const CANONICAL_ROLE = ['narrator', 'teacher', 'student', 'system'] as const;
const CANONICAL_GENDER = ['male', 'female', 'neutral', 'child'] as const;
const CANONICAL_AGE = [
  'child',
  'teen',
  'young',
  'adult',
  'middle_aged',
  'senior',
  'universal',
] as const;

export interface VoiceMapConfig extends Record<string, unknown> {
  default?: unknown;
}

interface StudyTextSegment {
  speaker?: string;
  text: string;
  raw: string;
}

export function resolveInworldAssemblyGapDurations(
  segments: Array<Pick<StudyTextSegment, 'speaker'>>,
): number[] {
  return segments
    .slice(0, -1)
    .map((segment, index) =>
      segment.speaker === segments[index + 1]?.speaker
        ? INWORLD_ASSEMBLY_MARGIN_POLICY.sameSpeakerMs
        : INWORLD_ASSEMBLY_MARGIN_POLICY.speakerSwitchMs,
    );
}

interface InworldSpeakerAssignment {
  speaker: string;
  voiceId: string;
  source: SpeakerVoiceAssignment['source'];
  score?: number;
  selectionReason: string;
  capabilityMatches?: string[];
  capabilityMismatches?: string[];
  capabilities: VoiceAssignmentCapabilities;
}

interface InworldSpeakerAssignmentOptions {
  defaultVoiceId?: string;
  defaultAccent?: string;
  profiles?: SpeakerProfile[];
  ranker?: VoicePlanRanker;
  model?: InworldTtsModel;
  logger?: BuildStudyTextOptions['logger'];
}

class InworldSynthesisRuntimeError extends InfrastructureError {
  readonly category: VoiceProviderErrorCategory;
  readonly retryable: boolean;

  constructor(args: { message: string; category: VoiceProviderErrorCategory; retryable: boolean }) {
    super(args.message);
    this.name = 'InworldSynthesisRuntimeError';
    this.category = args.category;
    this.retryable = args.retryable;
  }
}

const MARKDOWN_STRIPPERS: [RegExp, string][] = [
  [/\r?\n/g, ' '],
  [/^\s*[-*+]\s+/, ''],
  [/^\s*\d+[.)]\s+/, ''],
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

export function resolveInworldTtsModel(model?: string): InworldTtsModel {
  const normalized = (model ?? '').trim().toLowerCase().replaceAll('_', '-');
  if (!normalized) return resolveTtsSelection({ provider: 'inworld' }).model as InworldTtsModel;
  if ((INWORLD_TTS_MODELS as readonly string[]).includes(normalized)) {
    return normalized as InworldTtsModel;
  }
  throw new ConfigurationError(
    `Unsupported Inworld TTS model "${model}". Use one of: ${INWORLD_TTS_MODELS.join(', ')}`,
  );
}

function resolveInworldApiKey(): string | undefined {
  return (
    process.env.ESL_TTS_PROVIDER_INWORLD_API_KEY?.trim() ||
    process.env.INWORLD_API_KEY?.trim() ||
    undefined
  );
}

function resolveInworldVoiceId(explicit?: string): string {
  return (
    explicit?.trim() ||
    process.env.ESL_TTS_PROVIDER_INWORLD_VOICE?.trim() ||
    DEFAULT_INWORLD_VOICES[0]
  );
}

function resolveInworldSampleRateHertz(): number {
  const raw = process.env.ESL_TTS_PROVIDER_INWORLD_SAMPLE_RATE_HERTZ;
  if (!raw) return DEFAULT_SAMPLE_RATE_HERTZ;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SAMPLE_RATE_HERTZ;
  return Math.floor(parsed);
}

function resolveInworldTimeoutMs(): number | undefined {
  const raw = process.env.ESL_TTS_PROVIDER_INWORLD_TIMEOUT_MS;
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function resolveInworldMaxRetries(): number {
  const raw = process.env.ESL_TTS_PROVIDER_INWORLD_RETRY_MAX;
  if (!raw) return DEFAULT_MAX_RETRIES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MAX_RETRIES;
  return Math.floor(parsed);
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
    return { speaker: cleanSpeakerName(line.slice(0, idx)), text: line.slice(idx + 1).trim() };
  }
  return { text: line.trim() };
}

function resolveStudyTextSegments(lines: string[], frontmatter: Frontmatter): StudyTextSegment[] {
  const labelOrder = Array.isArray(frontmatter.speaker_labels)
    ? frontmatter.speaker_labels
        .map((label) => (typeof label === 'string' ? cleanSpeakerName(label) : ''))
        .filter(Boolean)
    : [];
  const nonNarratorFallback = labelOrder.find((label) => label.toLowerCase() !== 'narrator');
  const singleFallback = labelOrder.length === 1 ? labelOrder[0] : undefined;
  const segments: StudyTextSegment[] = [];
  let lastSpeaker: string | undefined;

  for (const raw of lines) {
    const { speaker, text } = parseSpeaker(raw);
    let resolvedSpeaker = speaker || undefined;
    if (!resolvedSpeaker && lastSpeaker) {
      resolvedSpeaker = lastSpeaker;
    } else if (!resolvedSpeaker && !lastSpeaker) {
      resolvedSpeaker = nonNarratorFallback ?? singleFallback;
    }
    if (resolvedSpeaker) lastSpeaker = resolvedSpeaker;
    segments.push({ speaker: resolvedSpeaker, text, raw });
  }

  return segments;
}

function collectSpeakers(segments: StudyTextSegment[], frontmatter: Frontmatter): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = cleanSpeakerName(value);
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    ordered.push(trimmed);
  };
  for (const segment of segments) add(segment.speaker);
  if (Array.isArray(frontmatter.speaker_labels)) {
    for (const label of frontmatter.speaker_labels) add(label);
  }
  if (ordered.length === 0 && Array.isArray(frontmatter.speaker_profiles)) {
    add(frontmatter.speaker_profiles.find((profile) => typeof profile.id === 'string')?.id);
  }
  if (ordered.length === 0) ordered.push('Narrator');
  return ordered;
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

function resolveVoiceMapValue(voiceMap: VoiceMapConfig, speaker: string): string | undefined {
  const direct = normalizeVoiceMapToken(voiceMap[speaker]);
  if (direct) return direct;
  const normalizedSpeaker = normalizeSpeakerToken(speaker);
  const entry = Object.entries(voiceMap).find(
    ([key]) => normalizeSpeakerToken(key) === normalizedSpeaker,
  );
  return entry ? normalizeVoiceMapToken(entry[1]) : undefined;
}

async function loadVoiceMap(path: string): Promise<VoiceMapConfig> {
  try {
    const voiceMapContent = await readFile(path, 'utf8');
    const rawVoiceMap = yaml.load(voiceMapContent) ?? {};
    return typeof rawVoiceMap === 'object' && rawVoiceMap
      ? (rawVoiceMap as VoiceMapConfig)
      : ({} as VoiceMapConfig);
  } catch {
    return {};
  }
}

function sanitizeStudentName(student?: unknown): string {
  if (typeof student !== 'string') return '';
  const normalized = student
    .trim()
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036F]/g, '')
    .toLowerCase();
  return normalized.replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
}

function buildOutputFileName(hash: string, frontmatter: Frontmatter): string {
  const prefix = sanitizeStudentName(frontmatter.student);
  return prefix ? `${prefix}-${hash}.mp3` : `${hash}.mp3`;
}

function buildShadowSentenceOutputFileName(hash: string, frontmatter: Frontmatter): string {
  const prefix = sanitizeStudentName(frontmatter.student);
  return prefix ? `${prefix}-${hash}-shadow-sentence.mp3` : `${hash}-shadow-sentence.mp3`;
}

function buildPronunciationOutputFileName(
  hash: string,
  frontmatter: Frontmatter,
  fileStem?: string,
): string {
  const prefix = sanitizeStudentName(frontmatter.student);
  const stem =
    fileStem
      ?.trim()
      .replaceAll(/[^a-z0-9-]+/gi, '-')
      .replaceAll(/^-+|-+$/g, '') || 'pronunciation';
  return prefix ? `${prefix}-${hash}-${stem}.mp3` : `${hash}-${stem}.mp3`;
}

async function fileExistsNonEmpty(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.size > 0;
  } catch {
    return false;
  }
}

function classifyInworldStatus(status: number | null | undefined): VoiceProviderErrorCategory {
  if (status === 400 || status === 404) return 'invalid_voice_id';
  if (status === 408 || status === 504) return 'provider_timeout';
  if (status === 429) return 'provider_rate_limit';
  return 'provider_contract_error';
}

export function classifyInworldTtsProviderError(error: unknown): VoiceProviderErrorCategory {
  if (error instanceof MissingApiKeyError) return 'provider_contract_error';
  if (error instanceof NetworkError) return 'provider_timeout';
  if (error instanceof ApiError) return classifyInworldStatus(error.code);
  return 'provider_contract_error';
}

function mapInworldSynthesisRuntimeError(
  error: unknown,
  context: { voiceId: string; text: string },
): InworldSynthesisRuntimeError {
  if (error instanceof InworldSynthesisRuntimeError) return error;
  const category = classifyInworldTtsProviderError(error);
  const retryable = category === 'provider_rate_limit' || category === 'provider_timeout';
  const message = error instanceof Error ? error.message : String(error);
  return new InworldSynthesisRuntimeError({
    category,
    retryable,
    message:
      `Failed to synthesize line with Inworld voice "${context.voiceId}" ` +
      `[${category}]: ${message}\nLine: ${context.text}`,
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function synthesizeInworldSpeech(
  text: string,
  voiceId: string,
  options: {
    model: InworldTtsModel;
    speakingRate?: number;
    temperature?: number;
    deliveryMode?: SpeechDeliveryMode;
  },
): Promise<Buffer> {
  const apiKey = resolveInworldApiKey();
  if (!apiKey) {
    throw new ConfigurationError(
      'Inworld TTS requires ESL_TTS_PROVIDER_INWORLD_API_KEY or INWORLD_API_KEY.',
    );
  }
  const timeout = resolveInworldTimeoutMs();
  const client = InworldTTS({
    apiKey,
    maxRetries: resolveInworldMaxRetries(),
    ...(timeout ? { timeout } : {}),
  });
  const audio = await client.generate({
    text,
    voice: voiceId,
    model: options.model,
    encoding: 'MP3',
    sampleRate: resolveInworldSampleRateHertz(),
    ...(options.speakingRate !== undefined ? { speakingRate: options.speakingRate } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.deliveryMode !== undefined ? { deliveryMode: options.deliveryMode } : {}),
  });
  return Buffer.from(audio);
}

async function synthesizeInworldChunkWithRetry(
  text: string,
  voiceId: string,
  outFile: string,
  options: {
    model: InworldTtsModel;
    speakingRate?: number;
    temperature?: number;
    deliveryMode?: SpeechDeliveryMode;
  },
): Promise<void> {
  const candidate = { text, voiceId, outFile };
  let backoffAttempt = 0;
  await runProviderFallbackLadder<typeof candidate, void, InworldSynthesisRuntimeError>({
    candidates: [candidate],
    runCandidate: async (current) => {
      const audio = await synthesizeInworldSpeech(current.text, current.voiceId, options);
      await writeFile(current.outFile, audio);
    },
    mapError: (current, error) => mapInworldSynthesisRuntimeError(error, current),
    isTimeoutError: (mappedError) => mappedError.retryable,
    isFailFastError: (mappedError) => !mappedError.retryable,
    getRetryMax: () => resolveInworldMaxRetries(),
    getRetryBackoffMs: () => {
      const backoffMs = 400 * Math.pow(2, backoffAttempt);
      backoffAttempt += 1;
      return backoffMs;
    },
    sleep: wait,
  });
}

export interface RenderedInworldSpeechSegment {
  text: string;
  speakingRate?: number;
  temperature?: number;
  deliveryMode?: SpeechDeliveryMode;
}

export function renderInworldSpeechSegment(args: {
  model: InworldTtsModel;
  segment: SpeechPerformancePlanSegment;
  capabilities?: VoiceAssignmentCapabilities;
}): RenderedInworldSpeechSegment {
  const cleanText = cleanSpeechText(args.segment.text);
  if (args.model !== 'inworld-tts-2') {
    return {
      text: cleanText,
      ...(resolveSpeakingRate(args.segment.pace) !== undefined
        ? { speakingRate: resolveSpeakingRate(args.segment.pace) }
        : {}),
    };
  }

  const capabilities = args.capabilities ?? {
    supportsMetadataInstructions: true,
    supportsNonVerbals: true,
    supportsUppercaseEmphasis: true,
    supportsFreeFormDirection: false,
  };
  const metadataInstructions = [
    args.segment.emotion ? `emotion: ${args.segment.emotion}` : undefined,
    args.segment.intonation ? `intonation: ${args.segment.intonation}` : undefined,
    args.segment.pace ? `pace: ${args.segment.pace}` : undefined,
  ].filter(Boolean);
  const before = capabilities.supportsNonVerbals
    ? (args.segment.nonVerbalsBefore ?? []).map((cue) => `[${cue}]`)
    : [];
  const after = capabilities.supportsNonVerbals
    ? (args.segment.nonVerbalsAfter ?? []).map((cue) => `[${cue}]`)
    : [];
  const spokenText = capabilities.supportsUppercaseEmphasis
    ? applyUppercaseEmphasis(cleanText, args.segment.emphasis)
    : cleanText;
  const text = [
    capabilities.supportsMetadataInstructions && metadataInstructions.length
      ? `[${metadataInstructions.join('; ')}]`
      : undefined,
    capabilities.supportsFreeFormDirection && args.segment.freeFormDirection
      ? `[${args.segment.freeFormDirection}]`
      : undefined,
    ...before,
    args.segment.pauseBeforeMs ? `<break time="${args.segment.pauseBeforeMs}ms" />` : undefined,
    spokenText,
    ...after,
    args.segment.pauseAfterMs ? `<break time="${args.segment.pauseAfterMs}ms" />` : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    text,
    ...(resolveSpeakingRate(args.segment.pace) !== undefined
      ? { speakingRate: resolveSpeakingRate(args.segment.pace) }
      : {}),
    ...(args.segment.deliveryMode ? { deliveryMode: args.segment.deliveryMode } : {}),
  };
}

function applyUppercaseEmphasis(text: string, emphasis: string[] | undefined): string {
  return (emphasis ?? []).reduce((rendered, phrase) => {
    const escaped = phrase.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    return rendered.replace(new RegExp(escaped, 'gi'), (match) => match.toUpperCase());
  }, text);
}

function resolveSpeakingRate(pace: SpeechPerformancePlanSegment['pace']): number | undefined {
  if (pace === 'slow') return 0.85;
  if (pace === 'measured') return 0.95;
  if (pace === 'natural') return 1;
  if (pace === 'brisk') return 1.1;
  return undefined;
}

export function resolveInworldSpeakerAssignmentsFromCatalog(
  speakers: string[],
  voiceMap: VoiceMapConfig,
  catalog: Pick<VoiceCatalog, 'voices'>,
  options: InworldSpeakerAssignmentOptions = {},
): InworldSpeakerAssignment[] {
  const configuredDefault = options.defaultVoiceId ?? normalizeVoiceMapToken(voiceMap.default);
  const credentialedEnglishVoices = catalog.voices.filter(
    (voice) => !isStaticInworldVoice(voice.id) && isEnglishInworldVoice(voice),
  );
  const staticVoices = catalog.voices.filter((voice) => isStaticInworldVoice(voice.id));
  const usedVoices = new Set<string>();

  return speakers.map((speaker, index) => {
    const explicit = resolveVoiceMapValue(voiceMap, speaker);
    if (explicit || configuredDefault) {
      const voiceId = explicit ?? configuredDefault!;
      const catalogVoice = catalog.voices.find((voice) => voice.id === voiceId);
      return {
        speaker,
        voiceId,
        source: explicit ? 'voiceMap' : 'default',
        score: explicit ? 100 : 90,
        selectionReason: explicit
          ? 'Selected from voices.yml explicit speaker mapping.'
          : 'Selected from configured Inworld default voice.',
        capabilities: resolveInworldVoiceCapabilities(catalogVoice),
      };
    }

    const profile = findInworldSpeakerProfile(options.profiles, speaker);
    const preferredAccent =
      normalizeRequestedAccent(profile?.accent) ?? normalizeRequestedAccent(options.defaultAccent);
    const candidates = credentialedEnglishVoices
      .map((voice) => scoreInworldVoiceCandidate({ voice, profile, preferredAccent }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.voice.name.localeCompare(b.voice.name) ||
          a.voice.id.localeCompare(b.voice.id),
      );
    const selected =
      candidates.find((candidate) => !usedVoices.has(candidate.voice.id)) ?? candidates[0];
    if (selected) {
      usedVoices.add(selected.voice.id);
      const exactAccent = !preferredAccent || selected.accent === preferredAccent;
      return {
        speaker,
        voiceId: selected.voice.id,
        source: exactAccent ? 'auto' : 'fallback',
        score: selected.score,
        selectionReason: exactAccent
          ? `Selected from Inworld credentialed English catalog with ${preferredAccent ? `exact "${preferredAccent}" accent` : 'deterministic scoring'}.`
          : `Selected deterministic Inworld English fallback because accent "${preferredAccent}" was unavailable.`,
        capabilityMatches: selected.capabilityMatches,
        capabilityMismatches: selected.capabilityMismatches,
        capabilities: selected.capabilities,
      };
    }

    const staticVoice =
      staticVoices[index % staticVoices.length]?.id ??
      DEFAULT_INWORLD_VOICES[index % DEFAULT_INWORLD_VOICES.length] ??
      resolveInworldVoiceId();
    usedVoices.add(staticVoice);
    return {
      speaker,
      voiceId: staticVoice,
      source: 'fallback',
      score: 50 - index,
      selectionReason: 'Selected from Inworld static fallback voices.',
      capabilities: resolveInworldVoiceCapabilities(
        catalog.voices.find((voice) => voice.id === staticVoice),
      ),
    };
  });
}

export async function resolveInworldSpeakerAssignmentsWithRankerFromCatalog(
  speakers: string[],
  voiceMap: VoiceMapConfig,
  catalog: Pick<VoiceCatalog, 'voices'>,
  options: InworldSpeakerAssignmentOptions = {},
): Promise<InworldSpeakerAssignment[]> {
  const deterministic = resolveInworldSpeakerAssignmentsFromCatalog(
    speakers,
    voiceMap,
    catalog,
    options,
  );
  if (!options.ranker) return deterministic;
  if (options.model !== 'inworld-tts-2') {
    options.logger?.log({
      level: 'info',
      stage: 'voice-plan',
      message: 'Inworld voice ranker skipped',
      detail: {
        ranker: options.ranker.metadata,
        reason: 'model_not_supported',
        model: options.model,
      },
    });
    return deterministic;
  }

  const credentialedEnglishVoices = catalog.voices.filter(
    (voice) => !isStaticInworldVoice(voice.id) && isEnglishInworldVoice(voice),
  );
  const rankable = deterministic.flatMap((assignment) => {
    if (assignment.source !== 'auto' && assignment.source !== 'fallback') return [];
    const profile = findInworldSpeakerProfile(options.profiles, assignment.speaker);
    const preferredAccent =
      normalizeRequestedAccent(profile?.accent) ?? normalizeRequestedAccent(options.defaultAccent);
    const candidates = credentialedEnglishVoices
      .map((voice) => scoreInworldVoiceCandidate({ voice, profile, preferredAccent }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.voice.name.localeCompare(b.voice.name) ||
          a.voice.id.localeCompare(b.voice.id),
      )
      .slice(0, 12);
    return candidates.length > 0 ? [{ assignment, profile, candidates }] : [];
  });
  if (rankable.length === 0) {
    options.logger?.log({
      level: 'info',
      stage: 'voice-plan',
      message: 'Inworld voice ranker skipped',
      detail: {
        ranker: options.ranker.metadata,
        reason: 'no_rankable_credentialed_english_candidates',
      },
    });
    return deterministic;
  }

  try {
    if (options.ranker.debugLogPlan) {
      options.logger?.log({
        level: 'info',
        stage: 'voice-plan',
        message: 'Inworld voice ranker shortlist debug payload',
        detail: {
          speakers: rankable.map(({ assignment, candidates }) => ({
            speaker: assignment.speaker,
            candidates: candidates.map((candidate) => ({
              voiceId: candidate.voice.id,
              name: candidate.voice.name,
              score: candidate.score,
              capabilities: candidate.capabilities,
              capabilityMatches: candidate.capabilityMatches,
              capabilityMismatches: candidate.capabilityMismatches,
            })),
          })),
        },
      });
    }
    const ranked = await options.ranker.rank({
      provider: 'inworld',
      model: options.model,
      speakers: rankable.map(({ assignment, profile, candidates }) => ({
        speaker: assignment.speaker,
        ...(profile ? { profile } : {}),
        candidates: candidates.map((candidate) => ({
          voiceId: candidate.voice.id,
          name: candidate.voice.name,
          score: candidate.score,
          ...(typeof candidate.voice.labels?.description === 'string'
            ? { description: candidate.voice.labels.description }
            : {}),
          ...(Array.isArray(candidate.voice.labels?.tags)
            ? { tags: candidate.voice.labels.tags.map(String) }
            : {}),
          capabilities: candidate.capabilities,
        })),
      })),
    });
    const selectionBySpeaker = new Map(
      ranked.selections.map((selection) => [selection.speaker, selection]),
    );
    const usedVoices = new Set(
      deterministic
        .filter((assignment) => assignment.source === 'voiceMap' || assignment.source === 'default')
        .map((assignment) => assignment.voiceId),
    );
    const resolved = deterministic.map((assignment) => {
      const rankedSelection = selectionBySpeaker.get(assignment.speaker);
      const rankedCandidate = rankable
        .find((entry) => entry.assignment.speaker === assignment.speaker)
        ?.candidates.find((candidate) => candidate.voice.id === rankedSelection?.voiceId);
      if (!rankedCandidate || usedVoices.has(rankedCandidate.voice.id)) return assignment;
      usedVoices.add(rankedCandidate.voice.id);
      return {
        speaker: assignment.speaker,
        voiceId: rankedCandidate.voice.id,
        source: 'auto' as const,
        score: rankedCandidate.score,
        selectionReason: rankedSelection?.reason
          ? `Selected by Inworld voice ranker: ${rankedSelection.reason}`
          : 'Selected by Inworld voice ranker from credentialed English shortlist.',
        capabilityMatches: rankedCandidate.capabilityMatches,
        capabilityMismatches: rankedCandidate.capabilityMismatches,
        capabilities: rankedCandidate.capabilities,
      };
    });
    options.logger?.log({
      level: 'info',
      stage: 'voice-plan',
      message: 'Inworld voice ranker selected credentialed voices',
      detail: {
        ranker: options.ranker.metadata,
        voices: resolved.map(({ speaker, voiceId }) => ({ speaker, voiceId })),
      },
    });
    return resolved;
  } catch (error) {
    options.logger?.log({
      level: 'warn',
      stage: 'voice-plan',
      message: 'Inworld voice ranker fell back to deterministic catalog selection',
      detail: {
        ranker: options.ranker.metadata,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        ...(options.ranker.debugLogPlan && error instanceof Error
          ? {
              errorMessage: error.message,
              ...('rawText' in error && typeof error.rawText === 'string'
                ? { rejectedRankerRawText: error.rawText }
                : {}),
            }
          : {}),
      },
    });
    return deterministic;
  }
}

function findInworldSpeakerProfile(
  profiles: SpeakerProfile[] | undefined,
  speaker: string,
): SpeakerProfile | undefined {
  const normalizedSpeaker = normalizeInworldToken(speaker);
  return profiles?.find(
    (profile) =>
      normalizeInworldToken(profile.id) === normalizedSpeaker ||
      normalizeInworldToken(profile.display_name) === normalizedSpeaker,
  );
}

function normalizeInworldToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/g, '_');
  return normalized || undefined;
}

function normalizeRequestedAccent(value: unknown): string | undefined {
  const normalized = normalizeInworldToken(value);
  if (
    normalized === 'neutral' ||
    normalized === 'standard' ||
    normalized === 'default' ||
    normalized === 'generic'
  ) {
    return undefined;
  }
  return normalized;
}

function readInworldVoiceLabel(
  voice: VoiceCatalog['voices'][number],
  key: string,
): string | undefined {
  return normalizeInworldToken(voice.labels?.[key]);
}

function isStaticInworldVoice(voiceId: string): boolean {
  return (DEFAULT_INWORLD_VOICES as readonly string[]).includes(voiceId);
}

function isEnglishInworldVoice(voice: VoiceCatalog['voices'][number]): boolean {
  const language = readInworldVoiceLabel(voice, 'language');
  if (language) return language === 'en' || language.startsWith('en_');
  return (voice.verifiedLanguages ?? []).some((entry) => {
    const token = normalizeInworldToken(entry.locale ?? entry.language);
    return token === 'en' || token?.startsWith('en_');
  });
}

function scoreInworldVoiceCandidate(args: {
  voice: VoiceCatalog['voices'][number];
  profile?: SpeakerProfile;
  preferredAccent?: string;
}) {
  const accent = readInworldVoiceLabel(args.voice, 'accent');
  const gender = readInworldVoiceLabel(args.voice, 'gender');
  const age = readInworldVoiceLabel(args.voice, 'age');
  const capabilityMatches: string[] = [];
  const capabilityMismatches: string[] = [];
  const capabilities = resolveInworldVoiceCapabilities(args.voice);
  let score = 50;

  if (args.preferredAccent) {
    if (accent === args.preferredAccent) {
      score += 40;
      capabilityMatches.push(`accent:${args.preferredAccent}`);
    } else {
      score -= 20;
      capabilityMismatches.push(`accent:${args.preferredAccent}`);
    }
  }
  const profileGender = normalizeInworldToken(args.profile?.gender);
  if (profileGender) {
    if (gender === profileGender) {
      score += 20;
      capabilityMatches.push(`gender:${profileGender}`);
    } else if (gender) {
      score -= 10;
      capabilityMismatches.push(`gender:${profileGender}`);
    }
  }
  const profileAge = normalizeInworldToken(args.profile?.age);
  if (profileAge && profileAge !== 'universal') {
    if (age === profileAge) {
      score += 10;
      capabilityMatches.push(`age:${profileAge}`);
    } else if (age) {
      score -= 5;
      capabilityMismatches.push(`age:${profileAge}`);
    }
  }
  const profileText =
    `${args.profile?.role ?? ''} ${args.profile?.persona ?? ''} ${args.profile?.voice_direction ?? ''}`.toLowerCase();
  const searchableVoiceText = [
    args.voice.name,
    String(args.voice.labels?.description ?? ''),
    ...(Array.isArray(args.voice.labels?.tags) ? args.voice.labels.tags.map(String) : []),
  ]
    .join(' ')
    .toLowerCase();
  const personaTerms = [...new Set(profileText.match(/[a-z]{4,}/g) ?? [])];
  const personaMatches = personaTerms.filter((term) => searchableVoiceText.includes(term));
  if (personaMatches.length > 0) {
    score += Math.min(10, personaMatches.length * 2);
    capabilityMatches.push(`persona:${personaMatches.join(',')}`);
  }
  if (capabilities.supportsFreeFormDirection) {
    score += 8;
    capabilityMatches.push('steerable');
  }
  const mismatchedQualities = ['strident', 'promotional', 'shouty', 'theatrical'];
  const requestedQualities = new Set(profileText.match(/[a-z]{4,}/g) ?? []);
  const qualityMismatches = mismatchedQualities.filter(
    (quality) => searchableVoiceText.includes(quality) && !requestedQualities.has(quality),
  );
  if (qualityMismatches.length > 0) {
    score -= qualityMismatches.length * 12;
    capabilityMismatches.push(`quality:${qualityMismatches.join(',')}`);
  }

  return {
    voice: args.voice,
    score,
    accent,
    capabilityMatches: capabilityMatches.length > 0 ? capabilityMatches : undefined,
    capabilityMismatches: capabilityMismatches.length > 0 ? capabilityMismatches : undefined,
    capabilities,
  };
}

function resolveInworldVoiceCapabilities(
  voice: VoiceCatalog['voices'][number] | undefined,
): VoiceAssignmentCapabilities {
  const tags = Array.isArray(voice?.labels?.tags)
    ? voice.labels.tags.map((tag) => normalizeInworldToken(tag))
    : [];
  return {
    supportsMetadataInstructions: true,
    supportsNonVerbals: true,
    supportsUppercaseEmphasis: true,
    supportsFreeFormDirection: tags.includes('steerable'),
  };
}

function resolveInworldVoiceMetadata(voice: VoiceInfo): {
  accent?: string;
  gender?: string;
  age?: string;
} {
  const metadataText = [voice.displayName, voice.name, voice.description, ...(voice.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const locale = normalizeInworldToken(voice.langCode);

  const accent =
    findInworldMetadataToken(metadataText, [
      'american',
      'british',
      'australian',
      'indian',
      'irish',
      'canadian',
      'new zealand',
    ]) ??
    (locale === 'en_gb'
      ? 'british'
      : locale === 'en_au'
        ? 'australian'
        : locale === 'en_in'
          ? 'indian'
          : locale === 'en_ie'
            ? 'irish'
            : locale === 'en_ca'
              ? 'canadian'
              : locale === 'en_nz'
                ? 'new_zealand'
                : undefined);
  const gender = findInworldMetadataToken(metadataText, ['female', 'male', 'neutral']);
  const age = findInworldMetadataToken(metadataText, [
    'child',
    'teen',
    'young',
    'adult',
    'middle aged',
    'senior',
  ]);

  return {
    ...(accent ? { accent: normalizeInworldToken(accent) } : {}),
    ...(gender ? { gender: normalizeInworldToken(gender) } : {}),
    ...(age ? { age: normalizeInworldToken(age) } : {}),
  };
}

function findInworldMetadataToken(text: string, tokens: string[]): string | undefined {
  return tokens.find((token) =>
    new RegExp(`\\b${token.replaceAll(' ', '\\s+')}\\b`, 'i').test(text),
  );
}

function buildVoiceSummaries(
  assignments: InworldSpeakerAssignment[],
): BuildStudyTextResult['voices'] {
  return assignments.map((assignment) => ({
    speaker: assignment.speaker,
    voiceId: assignment.voiceId,
    source: assignment.source,
    score: assignment.score,
    voiceName: assignment.voiceId,
    useCase: 'inworld',
    selectionReason: assignment.selectionReason,
    capabilityMatches: assignment.capabilityMatches,
    capabilityMismatches: assignment.capabilityMismatches,
  }));
}

async function resolveAssignmentsForStudyText(
  input: BuildStudyTextInput,
  opts: BuildStudyTextOptions,
): Promise<{
  frontmatter: Frontmatter;
  segments: StudyTextSegment[];
  normalizedText: string;
  model: InworldTtsModel;
  assignments: InworldSpeakerAssignment[];
  voiceSummaries: BuildStudyTextResult['voices'];
}> {
  const frontmatter = extractFrontmatter(input.context);
  const studyText = extractStudyText(input.context);
  const segments = resolveStudyTextSegments(studyText.lines, frontmatter);
  const sanitizedSegments = segments
    .map((segment) => cleanSpeechText(segment.text))
    .filter((segment) => segment.length > 0);
  const normalizedText = sanitizedSegments.join('\n');
  const model = resolveInworldTtsModel(opts.ttsModel);
  const assignments = opts.voicePlan
    ? opts.voicePlan.assignments.map((assignment) => ({
        ...assignment,
        selectionReason: assignment.selectionReason ?? 'Selected from prepared voice plan.',
      }))
    : await resolveInworldSpeakerAssignmentsWithRankerFromCatalog(
        collectSpeakers(segments, frontmatter),
        await loadVoiceMap(opts.voiceMapPath),
        await loadInworldVoicesCatalog(),
        {
          defaultVoiceId: opts.defaultVoiceId,
          defaultAccent: opts.defaultAccent,
          profiles: frontmatter.speaker_profiles,
          ranker: opts.voiceRanker,
          model,
          logger: opts.logger,
        },
      );
  return {
    frontmatter,
    segments,
    normalizedText,
    model,
    assignments,
    voiceSummaries: buildVoiceSummaries(assignments),
  };
}

export async function buildStudyTextMp3Inworld(
  input: BuildStudyTextInput,
  opts: BuildStudyTextOptions,
): Promise<BuildStudyTextResult> {
  const plan = await resolveAssignmentsForStudyText(input, opts);
  const { frontmatter, segments, normalizedText, model, assignments, voiceSummaries } = plan;
  const voiceAssignments = Object.fromEntries(
    assignments.map((assignment) => [assignment.speaker, assignment.voiceId]),
  );
  const hash = hashStudyText(
    JSON.stringify({
      provider: 'inworld',
      model,
      text: normalizedText,
      voices: voiceAssignments,
      voicePlan: opts.voicePlan,
      speechPlan: opts.speechPlan,
      assemblyMargins: INWORLD_ASSEMBLY_MARGIN_POLICY,
    }),
  );
  const outputDir = resolve(opts.outPath || (input.mdPath ? dirname(input.mdPath) : process.cwd()));
  const targetPath = resolve(outputDir, buildOutputFileName(hash, frontmatter));

  if (opts.preview) {
    return {
      path: targetPath,
      hash,
      duration: undefined,
      provider: 'inworld',
      modelId: model,
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
      provider: 'inworld',
      modelId: model,
      voices: voiceSummaries,
      voiceAssignments,
      cachedCharacters: normalizedText.length,
      generatedCharacters: 0,
    };
  }

  const assignmentLookup = new Map(
    assignments.map((assignment) => [assignment.speaker, assignment]),
  );
  const runFiles: string[] = [];
  const runSegments: Array<Pick<StudyTextSegment, 'speaker'>> = [];
  let generatedCharacters = 0;
  let cachedCharacters = 0;

  for (const [index, segment] of segments.entries()) {
    const speechPlanSegment = opts.speechPlan?.segments[index];
    const assignment =
      (segment.speaker ? assignmentLookup.get(segment.speaker) : undefined) ?? assignments[0];
    const rendered = renderInworldSpeechSegment({
      model,
      segment: speechPlanSegment ?? {
        id: `segment-${index + 1}`,
        speaker: segment.speaker,
        text: segment.text,
      },
      capabilities: assignment?.capabilities,
    });
    const speechText = rendered.text;
    if (!speechText) continue;
    const voiceId = assignment?.voiceId ?? resolveInworldVoiceId(opts.defaultVoiceId);
    const chunkHash = createHash('sha256')
      .update(
        JSON.stringify({
          provider: 'inworld',
          model,
          voiceId,
          text: speechText,
          index,
          speakingRate: rendered.speakingRate,
          temperature: rendered.temperature,
          deliveryMode: rendered.deliveryMode,
        }),
      )
      .digest('hex');
    const chunkFilePath = resolve(outputDir, `${chunkHash}.mp3`);
    if (!opts.force && (await fileExistsNonEmpty(chunkFilePath))) {
      runFiles.push(chunkFilePath);
      runSegments.push({ speaker: segment.speaker });
      cachedCharacters += speechText.length;
      continue;
    }
    await synthesizeInworldChunkWithRetry(speechText, voiceId, chunkFilePath, {
      model,
      speakingRate: rendered.speakingRate,
      temperature: rendered.temperature,
      deliveryMode: rendered.deliveryMode,
    });
    runFiles.push(chunkFilePath);
    runSegments.push({ speaker: segment.speaker });
    generatedCharacters += speechText.length;
  }

  if (runFiles.length === 0) {
    throw new ValidationError('TTS produced 0 segments. Check study-text content.');
  }

  if (runFiles.length === 1) {
    await copyFile(runFiles[0]!, targetPath);
  } else {
    const { concatMp3Segments, resolveFfmpegPath } = await import('./ffmpeg.js');
    await concatMp3Segments(
      runFiles,
      targetPath,
      true,
      await resolveFfmpegPath(opts.ffmpegPath),
      resolveInworldAssemblyGapDurations(runSegments),
    );
  }

  return {
    path: targetPath,
    hash,
    duration: undefined,
    provider: 'inworld',
    modelId: model,
    voices: voiceSummaries,
    voiceAssignments,
    generatedCharacters,
    cachedCharacters,
  };
}

export async function buildPronunciationShadowSentenceMp3Inworld(
  input: BuildPronunciationShadowSentenceInput,
  opts: BuildPronunciationShadowSentenceOptions,
): Promise<BuildPronunciationShadowSentenceResult> {
  const logger = opts.logger ?? noopLogger;
  const frontmatter = extractFrontmatter(input.context);
  const shadowFocus = extractPronunciationShadowFocus(input.context);
  if (!shadowFocus?.shadowSentence) {
    throw new ValidationError(
      'Pronunciation shadow sentence mode not found. Add "**Mode:** shadow_sentence" and a shadow sentence under section C.',
    );
  }
  const sentence = cleanSpeechText(shadowFocus.shadowSentence);
  if (!sentence) throw new ValidationError('Pronunciation shadow sentence is empty.');
  const model = resolveInworldTtsModel(opts.ttsModel);
  const voiceId = resolveInworldVoiceId(input.voiceId);
  const outputDir = resolve(opts.outPath || (input.mdPath ? dirname(input.mdPath) : process.cwd()));
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        kind: 'pronunciation_shadow_sentence',
        provider: 'inworld',
        text: sentence,
        voiceId,
        model,
      }),
    )
    .digest('hex');
  const targetPath = resolve(outputDir, buildShadowSentenceOutputFileName(hash, frontmatter));

  if (opts.preview) {
    return {
      path: targetPath,
      duration: undefined,
      hash,
      provider: 'inworld',
      modelId: model,
      voiceId,
      generatedCharacters: sentence.length,
      cachedCharacters: 0,
    };
  }

  await mkdir(outputDir, { recursive: true });
  if (!opts.force && (await fileExistsNonEmpty(targetPath))) {
    return {
      path: targetPath,
      duration: undefined,
      hash,
      provider: 'inworld',
      modelId: model,
      voiceId,
      generatedCharacters: 0,
      cachedCharacters: sentence.length,
    };
  }
  logger.log({
    level: 'info',
    stage: 'tts',
    message: 'Generating pronunciation shadow sentence audio',
    detail: { provider: 'inworld', voiceId, model },
  });
  await synthesizeInworldChunkWithRetry(sentence, voiceId, targetPath, { model });
  return {
    path: targetPath,
    duration: undefined,
    hash,
    provider: 'inworld',
    modelId: model,
    voiceId,
    generatedCharacters: sentence.length,
    cachedCharacters: 0,
  };
}

export async function buildPronunciationTextMp3Inworld(
  input: BuildPronunciationTextInput,
  opts: BuildPronunciationTextOptions,
): Promise<BuildPronunciationTextResult> {
  const logger = opts.logger ?? noopLogger;
  const sentence = cleanSpeechText(input.text ?? '');
  if (!sentence) throw new ValidationError('Pronunciation synthesis text is empty.');
  const frontmatter: Frontmatter = {
    title: input.title?.trim() || 'Pronunciation Practice',
    student: 'student',
    level: 'Unknown',
    topic: 'English Practice',
    input_type: 'generate',
  };
  const model = resolveInworldTtsModel(opts.ttsModel);
  const voiceId = resolveInworldVoiceId(input.voiceId);
  const fileStem = opts.fileStem?.trim() || 'pronunciation';
  const outputDir = resolve(opts.outPath || (input.mdPath ? dirname(input.mdPath) : process.cwd()));
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        kind: input.kind ?? 'pronunciation_text',
        provider: 'inworld',
        text: sentence,
        voiceId,
        model,
        fileStem,
      }),
    )
    .digest('hex');
  const targetPath = resolve(
    outputDir,
    buildPronunciationOutputFileName(hash, frontmatter, fileStem),
  );

  if (opts.preview) {
    return {
      path: targetPath,
      duration: undefined,
      hash,
      provider: 'inworld',
      modelId: model,
      voiceId,
      generatedCharacters: sentence.length,
      cachedCharacters: 0,
    };
  }

  await mkdir(outputDir, { recursive: true });
  if (!opts.force && (await fileExistsNonEmpty(targetPath))) {
    return {
      path: targetPath,
      duration: undefined,
      hash,
      provider: 'inworld',
      modelId: model,
      voiceId,
      generatedCharacters: 0,
      cachedCharacters: sentence.length,
    };
  }
  logger.log({
    level: 'info',
    stage: 'tts',
    message: 'Generating pronunciation text audio',
    detail: { provider: 'inworld', voiceId, model, fileStem },
  });
  await synthesizeInworldChunkWithRetry(sentence, voiceId, targetPath, { model });
  return {
    path: targetPath,
    duration: undefined,
    hash,
    provider: 'inworld',
    modelId: model,
    voiceId,
    generatedCharacters: sentence.length,
    cachedCharacters: 0,
  };
}

export async function loadInworldVoicesCatalog(): Promise<VoiceCatalog> {
  const generatedAt = new Date().toISOString();
  const voices: VoiceCatalog['voices'] = DEFAULT_INWORLD_VOICES.map((voiceId) => ({
    id: voiceId,
    name: voiceId,
    category: 'inworld',
    labels: {
      provider: 'inworld',
      model_family: DEFAULT_INWORLD_TTS_MODEL,
      language: 'en',
      accent: 'american',
      gender: voiceId === 'Dennis' ? 'male' : 'female',
    },
    useCase: DEFAULT_INWORLD_TTS_MODEL,
    verifiedLanguages: [{ language: 'en', locale: 'en-US' }],
  }));

  const apiKey = resolveInworldApiKey();
  if (apiKey) {
    try {
      const client = InworldTTS({ apiKey, timeout: resolveInworldTimeoutMs() ?? 30_000 });
      const workspaceVoices = await client.listVoices();
      for (const voice of workspaceVoices) {
        if (!voice.voiceId) continue;
        const metadata = resolveInworldVoiceMetadata(voice);
        voices.push({
          id: voice.voiceId,
          name: voice.displayName || voice.voiceId,
          category: 'inworld',
          labels: {
            provider: 'inworld',
            model_family: DEFAULT_INWORLD_TTS_MODEL,
            language: voice.langCode?.toLowerCase() ?? 'en',
            ...(metadata.accent ? { accent: metadata.accent } : {}),
            ...(metadata.gender ? { gender: metadata.gender } : {}),
            ...(metadata.age ? { age: metadata.age } : {}),
            ...(voice.description ? { description: voice.description } : {}),
            ...(voice.tags?.length ? { tags: voice.tags } : {}),
            ...(voice.source ? { source: voice.source } : {}),
          },
          useCase: DEFAULT_INWORLD_TTS_MODEL,
          verifiedLanguages: voice.langCode
            ? [
                {
                  language: voice.langCode.toLowerCase(),
                  locale: voice.langCode.replaceAll('_', '-'),
                },
              ]
            : [{ language: 'en', locale: 'en-US' }],
        });
      }
    } catch {
      // Keep fallback voices available if live catalog loading fails.
    }
  }

  return {
    generatedAt,
    capabilities: {
      generatedAt,
      provider: 'inworld',
      role: [...CANONICAL_ROLE],
      gender: [...CANONICAL_GENDER],
      age: [...CANONICAL_AGE],
      accent: [
        ...new Set(
          voices
            .map((voice) => readInworldVoiceLabel(voice, 'accent'))
            .filter((accent): accent is string => Boolean(accent)),
        ),
      ].sort(),
      style: [...INWORLD_TTS_MODELS].sort(),
    },
    voices,
  };
}

export async function resolveInworldSpeakerAssignments(
  input: BuildStudyTextInput,
  options: BuildStudyTextOptions,
): Promise<SpeakerVoiceAssignment[]> {
  const plan = await resolveAssignmentsForStudyText(input, options);
  return plan.assignments.map((assignment) => ({
    speaker: assignment.speaker,
    voiceId: assignment.voiceId,
    source: assignment.source,
    score: assignment.score,
    selectionReason: assignment.selectionReason,
    capabilityMatches: assignment.capabilityMatches,
    capabilityMismatches: assignment.capabilityMismatches,
    capabilities: assignment.capabilities,
  }));
}

export function createInworldTtsProvider(): TtsProviderAdapter {
  return {
    id: 'inworld',
    providerMetadata(args) {
      return {
        provider: 'inworld',
        modelFamily: resolveInworldTtsModel(
          args.studyTextOptions?.ttsModel ?? args.shadowOptions?.ttsModel,
        ),
        pricingToken: 'INWORLD_TTS',
      };
    },
    classifyProviderError(error) {
      return classifyInworldTtsProviderError(error);
    },
    voice: {
      async loadCatalog() {
        return loadInworldVoicesCatalog();
      },
      async resolveSpeakerAssignments(args) {
        return resolveInworldSpeakerAssignments(args.input, args.options);
      },
    },
    async synthesizeStudyText(input, options) {
      return buildStudyTextMp3Inworld(input, { ...options, ttsProvider: 'inworld' });
    },
    async synthesizeShadowSentence(input, options) {
      return buildPronunciationShadowSentenceMp3Inworld(input, {
        ...options,
        ttsProvider: 'inworld',
      });
    },
    async synthesizePronunciationText(input, options) {
      return buildPronunciationTextMp3Inworld(input, {
        ...options,
        ttsProvider: 'inworld',
      });
    },
  };
}

export { FfmpegNotFoundError, resolveFfmpegPath } from './ffmpeg.js';
