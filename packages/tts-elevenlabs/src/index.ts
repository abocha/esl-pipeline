import yaml from 'js-yaml';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
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
import { type Frontmatter, extractFrontmatter, extractStudyText } from '@esl-pipeline/pmd';
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
import {
  classifyElevenLabsVoiceProviderError,
  extractElevenLabsRuntimeErrorDetails,
  isElevenLabsTtsRetryableStatus,
} from './provider-runtime.js';
import { type VoiceMapConfig, resolveSpeakerVoices } from './speakerAssignment.js';
import type { DialogueInput, TtsStrategy } from './types.js';
import type { BuildStudyTextInput, BuildStudyTextOptions, BuildStudyTextResult } from './types.js';

const DEFAULT_MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2';
type TextToSpeechConvertBody = Parameters<
  ReturnType<typeof getElevenClient>['textToSpeech']['convert']
>[1];
type TtsConvertRequest = Pick<TextToSpeechConvertBody, 'modelId' | 'outputFormat'>;
type TtsOutputFormat = NonNullable<TextToSpeechConvertBody['outputFormat']>;

const DEFAULT_OUTPUT_FORMAT = (process.env.ELEVENLABS_OUTPUT_FORMAT ??
  'mp3_22050_32') as unknown as TtsOutputFormat;
const DEFAULT_TTS_MAX_CHARS = 4500;
const DEFAULT_TTS_PROVIDER = 'elevenlabs';

function isTtsDebugEnabled(): boolean {
  const raw = process.env.ELEVENLABS_TTS_DEBUG ?? process.env.ESL_TTS_DEBUG;
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
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

/**
 * Determines which TTS strategy to use based on options and content heuristics.
 */
function selectTtsStrategy(
  options: BuildStudyTextOptions,
  segments: StudyTextSegment[],
): 'dialogue' | 'tts' {
  const envStrategy = process.env.ELEVENLABS_TTS_STRATEGY as TtsStrategy | undefined;
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
  const raw = process.env.ELEVENLABS_TTS_MAX_CHARS;
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

export async function buildStudyTextMp3(
  input: BuildStudyTextInput,
  opts: BuildStudyTextOptions,
): Promise<BuildStudyTextResult> {
  const logger = opts.logger ?? noopLogger;
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
    const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_TOKEN || '';
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
  if (process.env.ELEVENLABS_SILENCE_TAIL_SECONDS !== undefined) {
    const parsed = Number(process.env.ELEVENLABS_SILENCE_TAIL_SECONDS);
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
  DialogueInput,
  DialogueSynthesisOptions,
  DialogueSynthesisResult,
  DialogueChunk,
  BuildStudyTextInput,
  BuildStudyTextOptions,
  BuildStudyTextResult,
} from './types.js';

// Export dialogue functions for orchestrator integration
export { chunkDialogueInputs, buildDialogueHash, synthesizeDialogue } from './dialogue.js';
