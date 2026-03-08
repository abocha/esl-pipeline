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
} from '@esl-pipeline/contracts';
import {
  type Frontmatter,
  extractFrontmatter,
  extractPronunciationShadowFocus,
  extractStudyText,
} from '@esl-pipeline/pmd';
import { runProviderFallbackLadder } from '@esl-pipeline/provider-runtime';
import {
  hashStudyText,
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
} from '@esl-pipeline/tts-core';

import { concatMp3Segments, resolveFfmpegPath, setMp3TitleMetadata, synthSilenceMp3 } from './ffmpeg.js';
import { synthesizeGoogleSpeech } from './google.js';

const GOOGLE_TTS_BYTE_LIMIT = 5000;
const GOOGLE_TTS_MODEL_FAMILIES = ['chirp3_hd', 'studio', 'neural2', 'wavenet'] as const;
const DEFAULT_GOOGLE_TTS_MODEL: GoogleTtsModel = 'chirp3_hd';

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
  source: BuildStudyTextResult['voices'][number]['source'];
}

interface ResolvedVoiceLanguage {
  voiceName: string;
  languageCode: string;
}

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
      return process.env.ESL_TTS_PROVIDER_GOOGLE_VOICE_CHIRP3_HD?.trim() || DEFAULT_GOOGLE_VOICE_BY_MODEL.chirp3_hd;
    }
    case 'studio': {
      return process.env.ESL_TTS_PROVIDER_GOOGLE_VOICE_STUDIO?.trim() || DEFAULT_GOOGLE_VOICE_BY_MODEL.studio;
    }
    case 'neural2': {
      return process.env.ESL_TTS_PROVIDER_GOOGLE_VOICE_NEURAL2?.trim() || DEFAULT_GOOGLE_VOICE_BY_MODEL.neural2;
    }
    case 'wavenet': {
      return process.env.ESL_TTS_PROVIDER_GOOGLE_VOICE_WAVENET?.trim() || DEFAULT_GOOGLE_VOICE_BY_MODEL.wavenet;
    }
  }
}

function resolveGoogleLanguageCode(
  explicitLanguageCode: string | undefined,
  voiceName: string,
): string {
  const envLanguageCode = process.env.ESL_TTS_PROVIDER_GOOGLE_LANGUAGE_CODE?.trim();
  if (explicitLanguageCode?.trim()) return explicitLanguageCode.trim();
  if (envLanguageCode) return envLanguageCode;
  const inferred = /^([a-z]{2,3}-[A-Z]{2,3})-/.exec(voiceName)?.[1];
  return inferred ?? 'en-US';
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

function resolveGoogleVoiceMapValue(voiceMap: VoiceMapConfig, speaker: string): string | undefined {
  const direct = normalizeVoiceMapToken((voiceMap as Record<string, unknown>)[speaker]);
  if (direct) return direct;

  const normalizedSpeaker = speaker.trim().toLowerCase();
  const entry = Object.entries(voiceMap).find(([key]) => key.trim().toLowerCase() === normalizedSpeaker);
  return entry ? normalizeVoiceMapToken(entry[1]) : undefined;
}

function resolveGoogleSpeakerVoiceName(
  voiceMap: VoiceMapConfig,
  speaker: string,
  providerDefaultVoice: string,
): { voiceName: string; source: BuildStudyTextResult['voices'][number]['source'] } {
  const explicit = resolveGoogleVoiceMapValue(voiceMap, speaker);
  if (explicit) return { voiceName: explicit, source: 'voiceMap' };
  const fromDefault = normalizeVoiceMapToken(voiceMap.default);
  if (fromDefault) return { voiceName: fromDefault, source: 'default' };
  return { voiceName: providerDefaultVoice, source: 'auto' };
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
  const providerDefaultVoice = resolveGoogleDefaultVoice(modelFamily);
  const defaultVoice = opts.defaultVoiceId?.trim() || providerDefaultVoice;
  const voiceMap = await loadVoiceMap(opts.voiceMapPath);
  if (opts.defaultVoiceId) {
    voiceMap.default = opts.defaultVoiceId;
  }

  const speakers = collectSpeakers(segments, frontmatter);
  const speakerAssignments = speakers.map((speaker) => {
    const resolved = resolveGoogleSpeakerVoiceName(voiceMap, speaker, defaultVoice);
    return { speaker, voiceName: resolved.voiceName, source: resolved.source };
  });

  const voiceAssignments = Object.fromEntries(
    speakerAssignments.map((assignment) => [assignment.speaker, assignment.voiceName]),
  );

  const voiceSummaries = speakerAssignments.map((assignment) => ({
    speaker: assignment.speaker,
    voiceId: assignment.voiceName,
    source: assignment.source,
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
  const uniqueVoices = [...new Set(assignments.map((assignment) => assignment.voiceName))].sort((a, b) =>
    a.localeCompare(b),
  );
  return uniqueVoices.map((voiceName) => ({
    voiceName,
    languageCode: resolveGoogleLanguageCode(explicitLanguageCode, voiceName),
  }));
}

class SynthesisRuntimeError extends InfrastructureError {
  readonly category: VoiceProviderErrorCategory;
  readonly retryable: boolean;

  constructor(args: {
    message: string;
    category: VoiceProviderErrorCategory;
    retryable: boolean;
  }) {
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
  const modelName = opts.googleModelName ?? process.env.ESL_TTS_PROVIDER_GOOGLE_MODEL_NAME ?? undefined;
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
  const modelName = opts.googleModelName ?? process.env.ESL_TTS_PROVIDER_GOOGLE_MODEL_NAME ?? undefined;

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

function buildDefaultGoogleVoices(): { modelFamily: GoogleTtsModel; voiceName: string }[] {
  return GOOGLE_TTS_MODEL_FAMILIES.map((modelFamily) => ({
    modelFamily,
    voiceName: resolveGoogleDefaultVoice(modelFamily),
  }));
}

export async function loadGoogleVoicesCatalog(): Promise<VoiceCatalog> {
  const now = new Date().toISOString();
  const byVoiceName = new Map<string, { modelFamily: GoogleTtsModel; voiceName: string }>();
  for (const entry of buildDefaultGoogleVoices()) {
    if (!byVoiceName.has(entry.voiceName)) {
      byVoiceName.set(entry.voiceName, entry);
    }
  }

  return {
    generatedAt: now,
    capabilities: {
      generatedAt: now,
      provider: 'google',
      role: ['narration', 'dialogue', 'pronunciation'],
      gender: ['female', 'male', 'neutral'],
      accent: ['en-US'],
      style: ['chirp3_hd', 'studio', 'neural2', 'wavenet'],
    },
    voices: [...byVoiceName.values()].map((entry) => ({
      id: entry.voiceName,
      name: entry.voiceName,
      category: 'google',
      labels: {
        provider: 'google',
        model_family: entry.modelFamily,
      },
      useCase: 'study_text',
      verifiedLanguages: [{ language: 'en', locale: 'en-US' }],
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
    source: assignment.source as SpeakerVoiceAssignment['source'],
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
