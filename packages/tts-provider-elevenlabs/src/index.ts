import yaml from 'js-yaml';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

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

import { loadVoicesCatalog } from './assign.js';
import { estimateDurationFromFileSize } from './audioDuration.js';
import { buildDialogueHash, synthesizeDialogue } from './dialogue.js';
import { getElevenClient } from './eleven.js';
import {
  concatMp3Segments,
  resolveFfmpegPath,
  setMp3TitleMetadata,
  synthSilenceMp3,
} from './ffmpeg.js';
import { synthesizeGoogleSpeech } from './google.js';
import {
  classifyElevenLabsVoiceProviderError,
  extractElevenLabsRuntimeErrorDetails,
  isElevenLabsTtsRetryableStatus,
} from './provider-runtime.js';
import { type VoiceMapConfig, resolveSpeakerVoices } from './speakerAssignment.js';
import type { DialogueInput, GoogleTtsModel, TtsProvider, TtsStrategy } from './types.js';
import type {
  BuildPronunciationShadowSentenceInput,
  BuildPronunciationShadowSentenceOptions,
  BuildPronunciationShadowSentenceResult,
  BuildStudyTextInput,
  BuildStudyTextOptions,
  BuildStudyTextResult,
} from './types.js';

const DEFAULT_MODEL_ID = process.env.ESL_TTS_PROVIDER_ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2';
type TextToSpeechConvertBody = Parameters<
  ReturnType<typeof getElevenClient>['textToSpeech']['convert']
>[1];
type TtsConvertRequest = Pick<TextToSpeechConvertBody, 'modelId' | 'outputFormat'>;
type TtsOutputFormat = NonNullable<TextToSpeechConvertBody['outputFormat']>;

const DEFAULT_OUTPUT_FORMAT = (process.env.ESL_TTS_PROVIDER_ELEVENLABS_OUTPUT_FORMAT ??
  'mp3_22050_32') as unknown as TtsOutputFormat;
const DEFAULT_TTS_MAX_CHARS = 4500;
const DEFAULT_TTS_PROVIDER: TtsProvider = 'elevenlabs';
const GOOGLE_TTS_BYTE_LIMIT = 5000;
const ESL_TTS_PROVIDER_GOOGLE_MODEL_FAMILIES = ['chirp3_hd', 'studio', 'neural2', 'wavenet'] as const;
const DEFAULT_ESL_TTS_PROVIDER_GOOGLE_MODEL: GoogleTtsModel = 'chirp3_hd';
const DEFAULT_GOOGLE_VOICE_BY_MODEL: Record<GoogleTtsModel, string> = {
  chirp3_hd: 'en-US-Chirp3-HD-Charon',
  studio: 'en-US-Studio-O',
  neural2: 'en-US-Neural2-F',
  wavenet: 'en-US-Wavenet-F',
};

function isTtsDebugEnabled(): boolean {
  const raw = process.env.ESL_TTS_DEBUG;
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function resolveTtsProvider(provider?: string): TtsProvider {
  const raw = (provider ?? process.env.ESL_TTS_DEFAULT_PROVIDER ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return DEFAULT_TTS_PROVIDER;
  if (raw === 'elevenlabs') return 'elevenlabs';
  if (raw === 'google' || raw === 'vertex' || raw === 'vertex_ai' || raw === 'gcp') return 'google';
  throw new ConfigurationError(
    `Unsupported TTS provider "${provider}". Use one of: elevenlabs, google.`,
  );
}

function resolveGoogleTtsModel(model?: string): GoogleTtsModel {
  const normalized = (model ?? process.env.ESL_TTS_PROVIDER_GOOGLE_MODEL ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '');

  if (!normalized) return DEFAULT_ESL_TTS_PROVIDER_GOOGLE_MODEL;
  if (normalized === 'chirp3hd' || normalized === 'chirp_3_hd' || normalized === 'chirp3_hd')
    return 'chirp3_hd';
  if (normalized === 'studio') return 'studio';
  if (normalized === 'neural2' || normalized === 'neural_2') return 'neural2';
  if (normalized === 'wavenet' || normalized === 'wave_net') return 'wavenet';

  throw new ConfigurationError(
    `Unsupported ESL_TTS_PROVIDER_GOOGLE_MODEL "${model}". Use one of: ${ESL_TTS_PROVIDER_GOOGLE_MODEL_FAMILIES.join(', ')}`,
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

export function hashStudyText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function ensureFileExists(path: string): Promise<void> {
  try {
    await stat(path);
    return;
  } catch (error: unknown) {
    if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  throw new InfrastructureError(
    `Expected output file to exist but it was missing: ${path}. ` +
    `This likely indicates a failed TTS synthesis or an unexpected output path.`,
  );
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

/**
 * Determines which TTS strategy to use based on options and content heuristics.
 */
function selectTtsStrategy(
  options: BuildStudyTextOptions,
  segments: StudyTextSegment[],
): 'dialogue' | 'tts' {
  const envStrategy = process.env.ESL_TTS_PROVIDER_ELEVENLABS_STRATEGY as TtsStrategy | undefined;
  const strategy = options.ttsStrategy ?? envStrategy ?? 'auto';

  if (strategy === 'dialogue') return 'dialogue';
  if (strategy === 'tts') return 'tts';

  const speakersUsed = new Set(
    segments
      .map((s) => s.speaker?.trim())
      .filter((speaker): speaker is string => speaker !== undefined && speaker.length > 0),
  );
  const uniqueSpeakers = speakersUsed.size;

  // Hard rule: any actual multi-speaker content uses Text-to-Dialogue.
  if (uniqueSpeakers >= 2) return 'dialogue';

  const statsText = segments
    .map((s) => cleanSpeechText(s.text))
    .map((t) => (t.length > 0 ? t : '\n\n'))
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();

  const sentences = splitIntoSentences(statsText);
  const sentenceLengths = sentences.map((s) => s.length).filter((n) => n > 0);

  const sentenceCount = sentenceLengths.length;
  const totalChars = statsText.length;

  if (sentenceCount === 0) return 'tts';

  const medianSentenceChars = percentile(sentenceLengths, 50);
  const p90SentenceChars = percentile(sentenceLengths, 90);
  const shortSentenceRatio = sentenceLengths.filter((n) => n <= 90).length / sentenceCount;

  // Heuristic: "simple + sentence-choppy" tends to sound better in Eleven v3 / Text-to-Dialogue
  // (clearer pacing for short, low-level texts).
  const wantsDialogue =
    (sentenceCount >= 6 && medianSentenceChars <= 90) ||
    (sentenceCount >= 8 && shortSentenceRatio >= 0.6) ||
    (totalChars <= 1200 && medianSentenceChars <= 90);

  // Heuristic: longer, higher-level monologues are generally fine (and cheaper) via standard TTS.
  const wantsTts = medianSentenceChars >= 120 || p90SentenceChars >= 220;

  if (wantsDialogue && !wantsTts) return 'dialogue';
  return 'tts';
}

function splitIntoSentences(text: string): string[] {
  const normalized = text.replaceAll(/\s+/g, ' ').trim();
  if (!normalized) return [];
  return normalized.split(/(?<=[.!?])\s+/);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx] ?? 0;
}

function resolveTtsMaxChars(): number {
  const raw = process.env.ESL_TTS_PROVIDER_ELEVENLABS_MAX_CHARS;
  if (raw === undefined) return DEFAULT_TTS_MAX_CHARS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 500) return Math.floor(parsed);
  return DEFAULT_TTS_MAX_CHARS;
}

function resolveOutputFormat(raw?: string): TtsOutputFormat {
  return (raw ?? DEFAULT_OUTPUT_FORMAT) as unknown as TtsOutputFormat;
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

function normalizeVoiceMapToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Builds MP3 using dialogue mode (Text-to-Dialogue API)
 */
function toDialogueInputs(
  segments: StudyTextSegment[],
  voiceAssignments: Map<string, string>,
): DialogueInput[] {
  const fallbackSpeaker = voiceAssignments.has('Narrator')
    ? 'Narrator'
    : (voiceAssignments.keys().next().value as string | undefined);
  const fallbackVoiceId =
    (fallbackSpeaker ? voiceAssignments.get(fallbackSpeaker) : undefined) ??
    (voiceAssignments.values().next().value as string | undefined);

  const inputs: DialogueInput[] = [];
  for (const seg of segments) {
    const speaker = seg.speaker?.trim() || fallbackSpeaker || 'default';
    const voiceId = voiceAssignments.get(speaker) ?? fallbackVoiceId;
    if (!voiceId) {
      throw new ConfigurationError(
        `No voice mapping found for speaker "${speaker}". ` +
        `Available speakers: ${[...voiceAssignments.keys()].join(', ') || '(none)'}`,
      );
    }
    const sanitizedText = cleanSpeechText(seg.text);
    if (!sanitizedText) continue;
    inputs.push({ text: sanitizedText, voiceId });
  }
  return inputs;
}

async function buildDialogueMp3(
  inputs: DialogueInput[],
  hash: string,
  voiceAssignments: Map<string, string>,
  voiceSummaries: BuildStudyTextResult['voices'],
  options: BuildStudyTextOptions,
  apiKey: string,
  outputDir: string,
  frontmatter: Frontmatter,
): Promise<BuildStudyTextResult> {
  const { dialogueLanguage, dialogueStability, dialogueSeed } = options;
  // Synthesize dialogue
  const result = await synthesizeDialogue(
    {
      inputs,
      modelId: 'eleven_v3',
      languageCode: dialogueLanguage,
      stability: dialogueStability,
      seed: dialogueSeed,
      outputFormat: options.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
      applyTextNormalization: 'auto',
      force: options.force,
    },
    apiKey,
    outputDir,
  );

  // Rename file to include student name prefix
  const fileName = buildOutputFileName(hash, frontmatter);
  const targetPath = resolve(outputDir, fileName);

  // If the target path is different from the generated path, rename it
  if (targetPath !== result.audioPath) {
    // Check if target already exists to avoid overwriting if not forced?
    // For now, we just overwrite/rename as per monologue behavior which calculates target path first.
    // But here synthesizeDialogue generated a hash-based file.
    await ensureFileExists(result.audioPath);
    await rename(result.audioPath, targetPath);
  }

  // Set ID3 title metadata
  const titleMeta =
    typeof frontmatter.title === 'string' && frontmatter.title.trim().length > 0
      ? frontmatter.title.trim()
      : '';

  if (titleMeta) {
    await setMp3TitleMetadata(targetPath, titleMeta, await resolveFfmpegPath(options.ffmpegPath));
  }

  return {
    path: targetPath,
    duration: result.duration,
    hash,
    provider: DEFAULT_TTS_PROVIDER,
    voices: voiceSummaries,
    voiceAssignments: Object.fromEntries(voiceAssignments),
    generatedCharacters: result.generatedCharacters,
    cachedCharacters: result.cachedCharacters,
  };
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

function mapGoogleSynthesisRuntimeError(
  error: unknown,
  context: { voiceName: string; text: string },
): SynthesisRuntimeError {
  if (error instanceof SynthesisRuntimeError) {
    return error;
  }

  const status = Number((error as { code?: unknown } | undefined)?.code);
  const isRateLimit = status === 8;
  const isTimeout = status === 4;
  const retryable = isRateLimit || isTimeout || status === 14;
  const category: VoiceProviderErrorCategory = isRateLimit
    ? 'provider_rate_limit'
    : isTimeout
      ? 'provider_timeout'
      : 'provider_contract_error';
  const message = error instanceof Error ? error.message : String(error);

  return new SynthesisRuntimeError({
    category,
    retryable,
    message:
      `Failed to synthesize line with Google voice "${context.voiceName}" ` +
      `[${category}]: ${message}\nLine: ${context.text}`,
  });
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

async function buildStudyTextMp3Google(
  input: BuildStudyTextInput,
  opts: BuildStudyTextOptions,
  args: {
    frontmatter: Frontmatter;
    segments: StudyTextSegment[];
    normalizedText: string;
    voiceMap: VoiceMapConfig;
  },
): Promise<BuildStudyTextResult> {
  const { frontmatter, segments, normalizedText, voiceMap } = args;
  const modelFamily = resolveGoogleTtsModel(opts.googleTtsModel);
  const providerDefaultVoice = resolveGoogleDefaultVoice(modelFamily);
  const defaultVoice = opts.defaultVoiceId?.trim() || providerDefaultVoice;
  const speakers = collectSpeakers(segments, frontmatter);
  const speakerAssignments = speakers.map((speaker) => {
    const resolved = resolveGoogleSpeakerVoiceName(voiceMap, speaker, defaultVoice);
    return { speaker, voiceName: resolved.voiceName, source: resolved.source };
  });
  const voiceSummaries = speakerAssignments.map((assignment) => ({
    speaker: assignment.speaker,
    voiceId: assignment.voiceName,
    source: assignment.source,
  }));
  const voiceAssignments = Object.fromEntries(
    speakerAssignments.map((assignment) => [assignment.speaker, assignment.voiceName]),
  );
  const hashInput = JSON.stringify({
    provider: 'google',
    modelFamily,
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

  if (!opts.force) {
    try {
      const cachedStats = await stat(targetPath);
      if (cachedStats.size > 0) {
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
    } catch {
      // File does not exist yet.
    }
  }

  const maxBytes = resolveGoogleTtsByteLimit();
  const apiEndpoint = resolveGoogleApiEndpoint(opts.googleApiEndpoint);
  const modelName = opts.googleModelName ?? process.env.ESL_TTS_PROVIDER_GOOGLE_MODEL_NAME ?? undefined;
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
      voiceName = speakerAssignments[0]?.voiceName ?? defaultVoice;
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

  let tailSeconds = 0.4;
  if (process.env.ESL_TTS_PROVIDER_ELEVENLABS_SILENCE_TAIL_SECONDS !== undefined) {
    const parsed = Number(process.env.ESL_TTS_PROVIDER_ELEVENLABS_SILENCE_TAIL_SECONDS);
    if (Number.isFinite(parsed) && parsed >= 0) {
      tailSeconds = parsed;
    }
  }

  const concatFiles = [...segmentFiles];
  let silencePath: string | undefined;
  const needsSilence = tailSeconds > 0.01;
  const needsConcat = segmentFiles.length > 1 || needsSilence;
  let resolvedFfmpeg: string | undefined;

  if (needsConcat) {
    resolvedFfmpeg = await resolveFfmpegPath(opts.ffmpegPath);
  }

  if (needsSilence) {
    const silenceFileName = `${hash}-silence.mp3`;
    silencePath = resolve(outputDir, silenceFileName);
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

export async function buildStudyTextMp3(
  input: BuildStudyTextInput,
  opts: BuildStudyTextOptions,
): Promise<BuildStudyTextResult> {
  const logger = opts.logger ?? noopLogger;
  const ttsProvider = resolveTtsProvider(opts.ttsProvider);
  const frontmatter = extractFrontmatter(input.context);
  const studyText = extractStudyText(input.context);
  const segments = resolveStudyTextSegments(studyText.lines, frontmatter);
  const sanitizedSegments = segments
    .map((segment) => cleanSpeechText(segment.text))
    .filter((segment) => segment.length > 0);
  const normalizedText = sanitizedSegments.join('\n');

  // Load voice map
  const voiceMapContent = await readFile(opts.voiceMapPath, 'utf8');
  const rawVoiceMap = yaml.load(voiceMapContent) ?? {};
  const voiceMap =
    typeof rawVoiceMap === 'object' && rawVoiceMap
      ? (rawVoiceMap as VoiceMapConfig)
      : ({} as VoiceMapConfig);
  if (opts.defaultVoiceId) {
    voiceMap.default = opts.defaultVoiceId;
  }

  if (ttsProvider === 'google') {
    if (opts.ttsStrategy === 'dialogue') {
      logger.log({
        level: 'warn',
        stage: 'tts',
        message: 'Google Cloud TTS does not support ElevenLabs dialogue mode; falling back to tts mode.',
        detail: { provider: 'google', requestedStrategy: opts.ttsStrategy },
      });
    }
    return buildStudyTextMp3Google(input, opts, {
      frontmatter,
      segments,
      normalizedText,
      voiceMap,
    });
  }

  const catalog = await loadVoicesCatalog();
  const speakers = collectSpeakers(segments, frontmatter);
  const assignments = await resolveSpeakerVoices({
    speakers,
    profiles: Array.isArray(frontmatter.speaker_profiles)
      ? frontmatter.speaker_profiles
      : undefined,
    voiceMap,
    catalog,
    mode: studyText.type,
    defaultAccent: opts.defaultAccent,
  });
  const speakerVoiceMap = new Map(assignments.map((a) => [a.speaker, a.voiceId]));
  const sortedAssignments = [...assignments].sort((a, b) =>
    a.speaker.localeCompare(b.speaker, undefined, { sensitivity: 'base' }),
  );
  const resolvedVoiceDescriptor = Object.fromEntries(
    sortedAssignments.map((a) => [a.speaker, a.voiceId]),
  );
  const voiceSummaries = assignments.map((a) => ({
    speaker: a.speaker,
    voiceId: a.voiceId,
    source: a.source,
    score: a.score,
    voiceName: a.catalogEntry?.name ?? undefined,
    gender:
      typeof a.catalogEntry?.labels?.gender === 'string'
        ? (a.catalogEntry.labels.gender as string)
        : undefined,
    accent:
      typeof a.catalogEntry?.labels?.accent === 'string'
        ? (a.catalogEntry.labels.accent as string)
        : undefined,
    useCase:
      typeof a.catalogEntry?.labels?.use_case === 'string'
        ? (a.catalogEntry.labels.use_case as string)
        : undefined,
    selectionReason: a.selectionReason,
    capabilityMatches: a.capabilityMatches,
    capabilityMismatches: a.capabilityMismatches,
  }));

  // Determine TTS strategy
  const selectedStrategy = selectTtsStrategy(opts, segments);
  if (isTtsDebugEnabled()) {
    logger.log({
      level: 'debug',
      message: `Using TTS strategy: ${selectedStrategy} (content type: ${studyText.type})`,
      detail: { strategy: selectedStrategy, contentType: studyText.type },
      stage: 'tts',
    });
  }

  // Route to appropriate synthesis path
  if (selectedStrategy === 'dialogue') {
    const apiKey = process.env.ESL_TTS_PROVIDER_ELEVENLABS_API_KEY || process.env.ESL_TTS_PROVIDER_ELEVENLABS_API_TOKEN || '';
    const outputDir = resolve(opts.outPath || (input.mdPath ? dirname(input.mdPath) : process.cwd()));
    const inputs = toDialogueInputs(segments, speakerVoiceMap);
    const hash = buildDialogueHash(inputs, {
      modelId: 'eleven_v3',
      outputFormat: resolveOutputFormat(opts.outputFormat),
      languageCode: opts.dialogueLanguage,
      stability: opts.dialogueStability,
      seed: opts.dialogueSeed,
      applyTextNormalization: 'auto',
    });
    const fileName = buildOutputFileName(hash, frontmatter);
    const targetPath = resolve(outputDir, fileName);

    if (opts.preview) {
      return {
        path: targetPath,
        duration: undefined,
        hash,
        provider: DEFAULT_TTS_PROVIDER,
        voices: voiceSummaries,
        voiceAssignments: Object.fromEntries(speakerVoiceMap),
      };
    }

    await mkdir(outputDir, { recursive: true });

    if (!opts.force) {
      try {
        const cachedStats = await stat(targetPath);
        if (cachedStats.size > 0) {
          return {
            path: targetPath,
            duration: await approximateDurationFromFile(
              targetPath,
              resolveOutputFormat(opts.outputFormat),
            ),
            hash,
            provider: DEFAULT_TTS_PROVIDER,
            voices: voiceSummaries,
            voiceAssignments: Object.fromEntries(speakerVoiceMap),
          };
        }
      } catch {
        // File doesn't exist, proceed with generation
      }
    }

    return buildDialogueMp3(
      inputs,
      hash,
      speakerVoiceMap,
      voiceSummaries,
      opts,
      apiKey,
      outputDir,
      frontmatter,
    );
  }

  // Continue with existing TTS path...

  // Generate hash based on study text and voice map
  const hashInput = JSON.stringify({ text: normalizedText, voices: resolvedVoiceDescriptor });
  const hash = hashStudyText(hashInput);
  const fileName = buildOutputFileName(hash, frontmatter);
  const outputDir = resolve(opts.outPath || (input.mdPath ? dirname(input.mdPath) : process.cwd()));
  const targetPath = resolve(outputDir, fileName);

  if (opts.preview) {
    return {
      path: targetPath,
      hash,
      duration: undefined,
      provider: DEFAULT_TTS_PROVIDER,
      voices: voiceSummaries,
      cachedCharacters: normalizedText.length,
      generatedCharacters: 0,
    };
  }

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  // Check if cached file exists
  if (!opts.force) {
    try {
      const cachedStats = await stat(targetPath);
      if (cachedStats.size > 0) {
        return {
          path: targetPath,
          hash,
          duration: calculateApproxDuration(cachedStats.size, resolveOutputFormat(opts.outputFormat)),
          provider: DEFAULT_TTS_PROVIDER,
          voices: voiceSummaries,
          cachedCharacters: normalizedText.length,
          generatedCharacters: 0,
        };
      }
    } catch {
      // File doesn't exist, proceed with generation
    }
  }

  // Generate TTS in larger chunks to preserve prosody (avoid per-line resets).
  const segmentFiles: string[] = [];
  const transientFiles: string[] = [];
  const eleven = getElevenClient();
  const fallbackVoiceId = assignments[0]?.voiceId;
  const maxChars = resolveTtsMaxChars();

  let generatedCharacters = 0;
  let cachedCharacters = 0;

  interface TtsRun {
    voiceId: string;
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
    let voiceId =
      normalizedSpeaker && speakerVoiceMap.get(normalizedSpeaker)
        ? speakerVoiceMap.get(normalizedSpeaker)
        : undefined;

    if (!voiceId && normalizedSpeaker) {
      const byCaseInsensitive = assignments.find(
        (a) => a.speaker.toLowerCase() === normalizedSpeaker.toLowerCase(),
      );
      voiceId = byCaseInsensitive?.voiceId;
    }

    if (!voiceId) {
      voiceId = fallbackVoiceId ?? catalog.voices[0]?.id;
    }

    const speechText = cleanSpeechText(segment.text);
    if (!speechText) {
      pendingParagraphBreak = true;
      continue;
    }

    if (!voiceId) {
      throw new ConfigurationError(
        `No ElevenLabs voice could be resolved for line "${segment.raw}". ` +
        `Ensure frontmatter speaker profiles or voices.yml provide enough information.`,
      );
    }

    if (currentRun && currentRun.voiceId !== voiceId) {
      flushRun();
    }
    if (!currentRun) {
      currentRun = { voiceId, lines: [] };
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
    const chunks = chunkTextForTts(runText, maxChars);
    for (const chunkText of chunks) {
      const chunkHashInput = JSON.stringify({
        voiceId: run.voiceId,
        text: chunkText,
        modelId: DEFAULT_MODEL_ID,
        outputFormat: resolveOutputFormat(opts.outputFormat),
      });
      const chunkHash = createHash('sha256').update(chunkHashInput).digest('hex');
      const chunkFileName = `${chunkHash}.mp3`;
      const chunkFilePath = resolve(outputDir, chunkFileName);

      if (!opts.force && (await fileExistsNonEmpty(chunkFilePath))) {
        segmentFiles.push(chunkFilePath);
        cachedCharacters += chunkText.length;
        continue;
      }

      await synthesizeLineWithRetry(eleven, run.voiceId, chunkText, chunkFilePath, {
        modelId: DEFAULT_MODEL_ID,
        outputFormat: resolveOutputFormat(opts.outputFormat),
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

  let tailSeconds = 0.4;
  if (process.env.ESL_TTS_PROVIDER_ELEVENLABS_SILENCE_TAIL_SECONDS !== undefined) {
    const parsed = Number(process.env.ESL_TTS_PROVIDER_ELEVENLABS_SILENCE_TAIL_SECONDS);
    if (Number.isFinite(parsed) && parsed >= 0) {
      tailSeconds = parsed;
    }
  }

  const concatFiles = [...segmentFiles];
  let silencePath: string | undefined;
  const needsSilence = tailSeconds > 0.01;
  const needsConcat = segmentFiles.length > 1 || needsSilence;
  let resolvedFfmpeg: string | undefined;

  if (needsConcat) {
    resolvedFfmpeg = await resolveFfmpegPath(opts.ffmpegPath);
  }

  if (needsSilence) {
    const silenceFileName = `${hash}-silence.mp3`;
    silencePath = resolve(outputDir, silenceFileName);
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
    // Keep segment chunks as a durable cache; only clean transient helper files.
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
    duration: await approximateDurationFromFile(targetPath, resolveOutputFormat(opts.outputFormat)),
    hash,
    provider: DEFAULT_TTS_PROVIDER,
    voices: voiceSummaries,
    generatedCharacters,
    cachedCharacters,
  };
}

export async function buildPronunciationShadowSentenceMp3(
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
  const ttsProvider = resolveTtsProvider(opts.ttsProvider);
  const modelId = opts.modelId ?? DEFAULT_MODEL_ID;
  const outputFormat = resolveOutputFormat(opts.outputFormat);
  const googleModelFamily = resolveGoogleTtsModel(opts.googleTtsModel);
  const googleLanguageCode = resolveGoogleLanguageCode(opts.googleLanguageCode, input.voiceId.trim());
  const googleApiEndpoint = resolveGoogleApiEndpoint(opts.googleApiEndpoint);
  const googleModelName = opts.googleModelName ?? process.env.ESL_TTS_PROVIDER_GOOGLE_MODEL_NAME ?? undefined;
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        kind: 'pronunciation_shadow_sentence',
        provider: ttsProvider,
        text: sentence,
        voiceId: input.voiceId.trim(),
        modelId: ttsProvider === 'google' ? googleModelFamily : modelId,
        outputFormat: ttsProvider === 'google' ? 'mp3' : outputFormat,
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
      provider: ttsProvider,
      voiceId: input.voiceId.trim(),
      generatedCharacters,
      cachedCharacters: 0,
    };
  }

  if (!opts.force && (await fileExistsNonEmpty(targetPath))) {
    return {
      path: targetPath,
      duration:
        ttsProvider === 'google'
          ? undefined
          : await approximateDurationFromFile(targetPath, outputFormat),
      hash,
      provider: ttsProvider,
      voiceId: input.voiceId.trim(),
      generatedCharacters: 0,
      cachedCharacters: generatedCharacters,
    };
  }

  if (ttsProvider === 'google') {
    logger.log({
      level: 'info',
      stage: 'tts',
      message: 'Generating pronunciation shadow sentence audio',
      detail: {
        provider: 'google',
        voiceName: input.voiceId.trim(),
        modelFamily: googleModelFamily,
        languageCode: googleLanguageCode,
      },
    });
    await synthesizeGoogleChunkWithRetry(sentence, input.voiceId.trim(), targetPath, {
      languageCode: googleLanguageCode,
      apiEndpoint: googleApiEndpoint,
      modelName: googleModelName,
    });
  } else {
    const client = getElevenClient();
    logger.log({
      level: 'info',
      stage: 'tts',
      message: 'Generating pronunciation shadow sentence audio',
      detail: { voiceId: input.voiceId.trim(), modelId, outputFormat },
    });
    await synthesizeLineWithRetry(client, input.voiceId.trim(), sentence, targetPath, {
      modelId,
      outputFormat,
    });
  }
  await ensureFileExists(targetPath);

  const titleMeta =
    typeof frontmatter.title === 'string' && frontmatter.title.trim().length > 0
      ? `${frontmatter.title.trim()} — Pronunciation Shadow Sentence`
      : '';
  if (titleMeta) {
    await setMp3TitleMetadata(targetPath, titleMeta, await resolveFfmpegPath(opts.ffmpegPath));
  }

  return {
    path: targetPath,
    duration:
      ttsProvider === 'google'
        ? undefined
        : await approximateDurationFromFile(targetPath, outputFormat),
    hash,
    provider: ttsProvider,
    voiceId: input.voiceId.trim(),
    generatedCharacters,
    cachedCharacters: 0,
  };
}

export function parseSpeaker(line: string): { speaker?: string; text: string } {
  const idx = line.indexOf(':');
  if (idx > 0 && idx < 40) {
    return { speaker: line.slice(0, idx).trim(), text: line.slice(idx + 1).trim() };
  }
  return { text: line.trim() };
}

const MARKDOWN_STRIPPERS: [RegExp, string][] = [
  [/\r?\n/g, ' '], // single line
  [/^\s*[-*+]\s+/, ''], // bullet prefixes
  [/^\s*\d+[\.)]\s+/, ''], // numbered lists
  [/\*\*(.+?)\*\*/g, '$1'],
  [/__(.+?)__/g, '$1'],
  [/\*(.+?)\*/g, '$1'],
  [/_([^_]+)_/g, '$1'],
  [/~~(.+?)~~/g, '$1'],
  [/`{1,3}([^`]+)`{1,3}/g, '$1'],
  [/!\[(.*?)\]\([^)]*\)/g, '$1'], // image alt text
  [/\[(.+?)\]\((.+?)\)/g, '$1'], // links
  [/<[^>]+>/g, ''], // html tags
] as const;

export function cleanSpeechText(text: string): string {
  let sanitized = text;
  for (const [pattern, replacement] of MARKDOWN_STRIPPERS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  sanitized = sanitized.replaceAll(/[*_`~>#]/g, ''); // stray md chars
  sanitized = sanitized.replaceAll(/\s+/g, ' ').trim();
  return sanitized;
}

function cleanSpeakerName(name: string): string {
  return cleanSpeechText(name);
}

interface StudyTextSegment {
  speaker?: string;
  text: string;
  raw: string;
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

async function synthesizeLineWithRetry(
  client: ReturnType<typeof getElevenClient>,
  voiceId: string,
  text: string,
  outFile: string,
  request: TtsConvertRequest,
  maxAttempts = 3,
): Promise<void> {
  const retryBudget = Math.max(0, maxAttempts - 1);
  let backoffAttempt = 0;
  const candidate = { voiceId, text, outFile };

  await runProviderFallbackLadder<typeof candidate, void, SynthesisRuntimeError>({
    candidates: [candidate],
    runCandidate: async (current) => {
      await synthesizeLine(client, current.voiceId, current.text, current.outFile, request);
    },
    mapError: (current, error) => mapSynthesisRuntimeError(error, current),
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

async function synthesizeLine(
  client: ReturnType<typeof getElevenClient>,
  voiceId: string,
  text: string,
  outFile: string,
  request: TtsConvertRequest,
): Promise<void> {
  const responseStream = await client.textToSpeech.convert(voiceId, {
    text,
    modelId: request.modelId,
    outputFormat: request.outputFormat,
  });
  const nodeStream = Readable.fromWeb(responseStream as unknown as NodeReadableStream);
  await pipeline(nodeStream, createWriteStream(outFile));
}

async function fileExistsNonEmpty(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.size > 0;
  } catch {
    return false;
  }
}

async function approximateDurationFromFile(
  filePath: string,
  outputFormat: TtsOutputFormat = DEFAULT_OUTPUT_FORMAT,
): Promise<number | undefined> {
  try {
    const info = await stat(filePath);
    if (info.size === 0) return undefined;
    return calculateApproxDuration(info.size, outputFormat);
  } catch {
    return undefined;
  }
}

function calculateApproxDuration(
  bytes: number,
  outputFormat: TtsOutputFormat = DEFAULT_OUTPUT_FORMAT,
): number | undefined {
  return estimateDurationFromFileSize(bytes, outputFormat);
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

function mapSynthesisRuntimeError(
  error: unknown,
  context: { voiceId: string; text: string },
): SynthesisRuntimeError {
  if (error instanceof SynthesisRuntimeError) {
    return error;
  }

  const details = extractElevenLabsRuntimeErrorDetails(error);
  const category = classifyElevenLabsVoiceProviderError({
    error,
    messageForClassification: details.message,
  });
  const retryable = isElevenLabsTtsRetryableStatus(details.status);
  return new SynthesisRuntimeError({
    category,
    retryable,
    message:
      `Failed to synthesize line with voice "${context.voiceId}" ` +
      `[${category}]: ${details.message}\nLine: ${context.text}`,
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { resolveFfmpegPath, FfmpegNotFoundError } from './ffmpeg.js';
export { loadVoiceCapabilities, loadVoicesCatalog } from './assign.js';
export type { VoiceCatalog } from './assign.js';
export { DEFAULT_VOICES_OUT, syncVoices } from './syncVoices.js';
export {
  buildVoiceCapabilitiesSnapshot,
  getVoiceCapabilities,
  validateCapabilityValue,
} from './voiceCapabilities.js';

// Export types for orchestrator integration
export type {
  TtsStrategy,
  TtsProvider,
  GoogleTtsModel,
  DialogueInput,
  DialogueSynthesisOptions,
  DialogueSynthesisResult,
  DialogueChunk,
  BuildPronunciationShadowSentenceInput,
  BuildPronunciationShadowSentenceOptions,
  BuildPronunciationShadowSentenceResult,
  BuildStudyTextInput,
  BuildStudyTextOptions,
  BuildStudyTextResult,
} from './types.js';

// Export dialogue functions for orchestrator integration
export { chunkDialogueInputs, buildDialogueHash, synthesizeDialogue } from './dialogue.js';
export { createElevenLabsTtsProvider } from './adapter.js';
