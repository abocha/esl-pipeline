import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ApiError, InworldTTS, MissingApiKeyError, NetworkError } from '@inworld/tts';
import yaml from 'js-yaml';

import {
  ConfigurationError,
  InfrastructureError,
  noopLogger,
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
  type TtsProviderAdapter,
  type VoiceCatalog,
} from '@esl-pipeline/tts-core';

const DEFAULT_INWORLD_TTS_MODEL: InworldTtsModel = resolveInworldTtsModel();
const DEFAULT_INWORLD_VOICES = ['Ashley', 'Dennis'] as const;
const DEFAULT_SAMPLE_RATE_HERTZ = 48_000;
const DEFAULT_MAX_RETRIES = 2;
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

interface VoiceMapConfig extends Record<string, unknown> {
  default?: unknown;
}

interface StudyTextSegment {
  speaker?: string;
  text: string;
  raw: string;
}

interface InworldSpeakerAssignment {
  speaker: string;
  voiceId: string;
  source: SpeakerVoiceAssignment['source'];
  score?: number;
  selectionReason: string;
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
  options: { model: InworldTtsModel },
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
  });
  return Buffer.from(audio);
}

async function synthesizeInworldChunkWithRetry(
  text: string,
  voiceId: string,
  outFile: string,
  options: { model: InworldTtsModel },
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

function resolveSpeakerAssignments(
  speakers: string[],
  voiceMap: VoiceMapConfig,
  defaultVoiceId?: string,
): InworldSpeakerAssignment[] {
  const defaultVoice = resolveInworldVoiceId(
    defaultVoiceId ?? normalizeVoiceMapToken(voiceMap.default),
  );
  return speakers.map((speaker, index) => {
    const explicit = resolveVoiceMapValue(voiceMap, speaker);
    const voiceId =
      explicit ?? DEFAULT_INWORLD_VOICES[index % DEFAULT_INWORLD_VOICES.length] ?? defaultVoice;
    return {
      speaker,
      voiceId,
      source: explicit ? 'voiceMap' : defaultVoiceId ? 'default' : 'auto',
      score: explicit ? 100 : 50 - index,
      selectionReason: explicit
        ? 'Selected from voices.yml explicit speaker mapping.'
        : 'Selected from Inworld fallback voice rotation.',
    };
  });
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
  const voiceMap = await loadVoiceMap(opts.voiceMapPath);
  if (opts.defaultVoiceId) voiceMap.default = opts.defaultVoiceId;
  const assignments = resolveSpeakerAssignments(
    collectSpeakers(segments, frontmatter),
    voiceMap,
    opts.defaultVoiceId,
  );
  return {
    frontmatter,
    segments,
    normalizedText,
    model: resolveInworldTtsModel(opts.ttsModel),
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
  let generatedCharacters = 0;
  let cachedCharacters = 0;

  for (const [index, segment] of segments.entries()) {
    const speechText = cleanSpeechText(segment.text);
    if (!speechText) continue;
    const assignment =
      (segment.speaker ? assignmentLookup.get(segment.speaker) : undefined) ?? assignments[0];
    const voiceId = assignment?.voiceId ?? resolveInworldVoiceId(opts.defaultVoiceId);
    const chunkHash = createHash('sha256')
      .update(JSON.stringify({ provider: 'inworld', model, voiceId, text: speechText, index }))
      .digest('hex');
    const chunkFilePath = resolve(outputDir, `${chunkHash}.mp3`);
    if (!opts.force && (await fileExistsNonEmpty(chunkFilePath))) {
      runFiles.push(chunkFilePath);
      cachedCharacters += speechText.length;
      continue;
    }
    await synthesizeInworldChunkWithRetry(speechText, voiceId, chunkFilePath, { model });
    runFiles.push(chunkFilePath);
    generatedCharacters += speechText.length;
  }

  if (runFiles.length === 0) {
    throw new ValidationError('TTS produced 0 segments. Check study-text content.');
  }

  if (runFiles.length === 1) {
    await copyFile(runFiles[0]!, targetPath);
  } else {
    const { concatMp3Segments, resolveFfmpegPath } = await import('./ffmpeg.js');
    await concatMp3Segments(runFiles, targetPath, true, await resolveFfmpegPath(opts.ffmpegPath));
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
        voices.push({
          id: voice.voiceId,
          name: voice.displayName || voice.voiceId,
          category: 'inworld',
          labels: {
            provider: 'inworld',
            model_family: DEFAULT_INWORLD_TTS_MODEL,
            language: voice.langCode?.toLowerCase() ?? 'en',
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
      accent: ['american'],
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
