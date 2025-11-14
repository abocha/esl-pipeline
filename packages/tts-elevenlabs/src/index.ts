import { createHash } from 'node:crypto';
import { readFileSync, createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdir, copyFile, unlink, stat } from 'node:fs/promises';
import yaml from 'js-yaml';
import { extractStudyText, extractFrontmatter, type Frontmatter } from '@esl-pipeline/md-extractor';
import { loadVoicesCatalog, type VoiceCatalog } from './assign.js';
import {
  concatMp3Segments,
  synthSilenceMp3,
  resolveFfmpegPath,
  setMp3TitleMetadata,
} from './ffmpeg.js';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getElevenClient } from './eleven.js';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { resolveSpeakerVoices, type VoiceMapConfig } from './speakerAssignment.js';
import type { TtsMode, DialogueInput } from './types.js';
import { synthesizeDialogue } from './dialogue.js';

const DEFAULT_MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2';
const DEFAULT_OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT ?? 'mp3_22050_32';
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function hashStudyText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function sanitizeStudentName(student?: unknown): string {
  if (typeof student !== 'string') return '';
  const trimmed = student.trim();
  if (!trimmed) return '';
  const normalized = trimmed
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug;
}

function buildOutputFileName(hash: string, frontmatter: Frontmatter): string {
  const prefix = sanitizeStudentName(frontmatter.student);
  return prefix ? `${prefix}-${hash}.mp3` : `${hash}.mp3`;
}

type BuildStudyTextOptions = {
  voiceMapPath: string;
  outPath: string;
  preview?: boolean;
  force?: boolean;
  defaultAccent?: string;
  ffmpegPath?: string;
  outputFormat?: string;
  
  // New fields for dual TTS mode
  ttsMode?: 'auto' | 'dialogue' | 'monologue';
  dialogueLanguage?: string;
  dialogueStability?: number;
  dialogueSeed?: number;
};

export type BuildStudyTextResult = {
  path: string;
  duration?: number;
  hash: string;
  voices: {
    speaker: string;
    voiceId: string;
    source: string;
    score?: number;
    voiceName?: string;
    gender?: string;
    accent?: string;
    useCase?: string;
  }[];
  voiceAssignments?: Record<string, string>;
};

/**
 * Determines which TTS mode to use based on options and content type
 */
function selectTtsMode(
  options: BuildStudyTextOptions,
  studyTextType: 'monologue' | 'dialogue' | 'mixed'
): 'dialogue' | 'monologue' {
  // Check environment variable first
  const envMode = process.env.ELEVENLABS_TTS_MODE as TtsMode | undefined;
  const mode = options.ttsMode ?? envMode ?? 'auto';

  if (mode === 'dialogue') {
    return 'dialogue';
  }
  if (mode === 'monologue') {
    return 'monologue';
  }
  
  // Auto mode: use dialogue for dialogue/mixed content, monologue otherwise
  return studyTextType === 'monologue' ? 'monologue' : 'dialogue';
}

/**
 * Builds MP3 using dialogue mode (Text-to-Dialogue API)
 */
async function buildDialogueMp3(
  segments: StudyTextSegment[],
  voiceAssignments: Map<string, string>,
  voiceSummaries: BuildStudyTextResult['voices'],
  options: BuildStudyTextOptions,
  apiKey: string,
  outputDir: string
): Promise<BuildStudyTextResult> {
  const { dialogueLanguage, dialogueStability, dialogueSeed } = options;
  
  // Convert segments to dialogue inputs
  const inputs: DialogueInput[] = segments.map(seg => {
    const speaker = seg.speaker ?? 'default';
    const voiceId = voiceAssignments.get(speaker);
    if (!voiceId) {
      throw new Error(
        `No voice mapping found for speaker "${speaker}". ` +
        `Available speakers: ${Array.from(voiceAssignments.keys()).join(', ')}`
      );
    }
    return {
      text: seg.text,
      voice_id: voiceId
    };
  });

  // Synthesize dialogue
  const result = await synthesizeDialogue(
    {
      inputs,
      modelId: 'eleven_v3',
      languageCode: dialogueLanguage,
      stability: dialogueStability,
      seed: dialogueSeed,
      outputFormat: options.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
      applyTextNormalization: 'auto'
    },
    apiKey,
    outputDir
  );

  return {
    path: result.audioPath,
    duration: result.duration,
    hash: result.hash,
    voices: voiceSummaries,
    voiceAssignments: Object.fromEntries(voiceAssignments)
  };
}

export async function buildStudyTextMp3(
  mdPath: string,
  opts: BuildStudyTextOptions
): Promise<BuildStudyTextResult> {
  // Read and extract study text
  const mdContent = readFileSync(mdPath, 'utf-8');
  const frontmatter = loadFrontmatter(mdContent);
  const studyText = extractStudyText(mdContent);
  const segments = resolveStudyTextSegments(studyText.lines, frontmatter);
  const sanitizedSegments = segments
    .map(segment => cleanSpeechText(segment.text))
    .filter(segment => segment.length > 0);
  const normalizedText = sanitizedSegments.join('\n');

  // Load voice map
  const voiceMapContent = readFileSync(opts.voiceMapPath, 'utf-8');
  const rawVoiceMap = yaml.load(voiceMapContent) ?? {};
  const voiceMap =
    typeof rawVoiceMap === 'object' && rawVoiceMap
      ? (rawVoiceMap as VoiceMapConfig)
      : ({} as VoiceMapConfig);
  const catalog = await loadVoicesCatalog().catch<VoiceCatalog>(() => ({ voices: [] }));
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
  const speakerVoiceMap = new Map(assignments.map(a => [a.speaker, a.voiceId]));
  const sortedAssignments = [...assignments].sort((a, b) =>
    a.speaker.localeCompare(b.speaker, undefined, { sensitivity: 'base' })
  );
  const resolvedVoiceDescriptor = Object.fromEntries(
    sortedAssignments.map(a => [a.speaker, a.voiceId])
  );
  const voiceSummaries = assignments.map(a => ({
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
  }));

  // Determine TTS mode
  const selectedMode = selectTtsMode(opts, studyText.type);
  console.log(`Using TTS mode: ${selectedMode} (content type: ${studyText.type})`);

  // Route to appropriate synthesis path
  if (selectedMode === 'dialogue') {
    const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_TOKEN || '';
    const outputDir = resolve(opts.outPath || dirname(mdPath));
    await mkdir(outputDir, { recursive: true });
    
    return buildDialogueMp3(segments, speakerVoiceMap, voiceSummaries, opts, apiKey, outputDir);
  }

  // Continue with existing monologue path...
  
  // Generate hash based on study text and voice map
  const hashInput = JSON.stringify({ text: normalizedText, voices: resolvedVoiceDescriptor });
  const hash = hashStudyText(hashInput);
  const fileName = buildOutputFileName(hash, frontmatter);
  const outputDir = resolve(opts.outPath || dirname(mdPath));
  const targetPath = resolve(outputDir, fileName);

  if (opts.preview) {
    return {
      path: targetPath,
      hash,
      duration: undefined,
      voices: voiceSummaries,
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
          duration: calculateApproxDuration(cachedStats.size),
          voices: voiceSummaries,
        };
      }
    } catch {
      // File doesn't exist, proceed with generation
    }
  }

  // Generate TTS for each line or chunk (monologue mode)
  const segmentFiles: string[] = [];
  const cleanupTargets: string[] = [];
  const eleven = getElevenClient();
  const fallbackVoiceId = assignments[0]?.voiceId;

  for (const segment of segments) {
    const normalizedSpeaker = segment.speaker?.trim() ?? '';
    let voiceId =
      normalizedSpeaker && speakerVoiceMap.get(normalizedSpeaker)
        ? speakerVoiceMap.get(normalizedSpeaker)
        : undefined;

    if (!voiceId && normalizedSpeaker) {
      const byCaseInsensitive = assignments.find(
        a => a.speaker.toLowerCase() === normalizedSpeaker.toLowerCase()
      );
      voiceId = byCaseInsensitive?.voiceId;
    }

    if (!voiceId) {
      voiceId = fallbackVoiceId ?? catalog.voices[0]?.id;
    }

    const speechText = cleanSpeechText(segment.text);
    if (!speechText) continue;

    if (!voiceId) {
      throw new Error(
        `No ElevenLabs voice could be resolved for line "${segment.raw}". ` +
          `Ensure frontmatter speaker profiles or voices.yml provide enough information.`
      );
    }

    // Create a temporary file for this line's audio
    const lineHash = createHash('sha256').update(`${speechText}-${voiceId}`).digest('hex');
    const lineFileName = `${lineHash}.mp3`;
    const lineFilePath = resolve(outputDir, lineFileName);

    if (!opts.force && (await fileExistsNonEmpty(lineFilePath))) {
      segmentFiles.push(lineFilePath);
      cleanupTargets.push(lineFilePath);
      continue;
    }

    await synthesizeLineWithRetry(eleven, voiceId, speechText, lineFilePath);
    segmentFiles.push(lineFilePath);
    cleanupTargets.push(lineFilePath);
  }
  if (segmentFiles.length === 0) {
    throw new Error(
      'TTS produced 0 segments. Check voices.yml (default/auto) and study-text content.'
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
    cleanupTargets.push(silencePath);
  }

  try {
    if (concatFiles.length === 1) {
      await copyFile(concatFiles[0]!, targetPath);
    } else if (concatFiles.length > 1) {
      await concatMp3Segments(concatFiles, targetPath, true, resolvedFfmpeg);
    }
  } finally {
    // best-effort cleanup; ignore errors
    await Promise.allSettled(cleanupTargets.map(p => unlink(p)));
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
    duration: await approximateDurationFromFile(targetPath),
    hash,
    voices: voiceSummaries,
  };
}

function parseSpeaker(line: string): { speaker?: string; text: string } {
  const idx = line.indexOf(':');
  if (idx > 0 && idx < 40) {
    return { speaker: line.slice(0, idx).trim(), text: line.slice(idx + 1).trim() };
  }
  return { text: line.trim() };
}

const MARKDOWN_STRIPPERS: Array<[RegExp, string]> = [
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

function cleanSpeechText(text: string): string {
  let sanitized = text;
  for (const [pattern, replacement] of MARKDOWN_STRIPPERS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  sanitized = sanitized.replace(/[*_`~>#]/g, ''); // stray md chars
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  return sanitized;
}

type StudyTextSegment = { speaker?: string; text: string; raw: string };

function collectSpeakers(segments: StudyTextSegment[], frontmatter: Frontmatter): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (name: string | undefined | null) => {
    const trimmed = name?.trim();
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
      segment => segment.speaker?.trim().toLowerCase() === 'narrator'
    );
    const hasAnySegmentSpeakers = ordered.length > 0;
    for (const label of frontmatter.speaker_labels) {
      if (typeof label !== 'string') continue;
      const trimmed = label.trim();
      if (!trimmed) continue;
      if (trimmed.toLowerCase() === 'narrator' && hasAnySegmentSpeakers && !hasNarratorInSegments) {
        continue;
      }
      add(trimmed);
    }
  }

  if (ordered.length === 0 && Array.isArray(frontmatter.speaker_profiles)) {
    const firstProfile = frontmatter.speaker_profiles.find(
      profile => typeof profile?.id === 'string'
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
        .map(label => (typeof label === 'string' ? label.trim() : ''))
        .filter(Boolean)
    : [];
  const nonNarratorFallback = labelOrder.find(label => label.toLowerCase() !== 'narrator');
  const singleFallback = labelOrder.length === 1 ? labelOrder[0] : undefined;
  let lastSpeaker: string | undefined;

  for (const raw of lines) {
    const { speaker, text } = parseSpeaker(raw);
    let resolvedSpeaker = speaker?.trim();
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

function loadFrontmatter(source: string): Frontmatter {
  const fm = extractFrontmatter(source);
  if (fm && Object.keys(fm).length > 0) return fm;
  const normalized = source.replace(/\r\n/g, '\n');
  const fenceMatch = normalized.match(/```[^\n]*\n([\s\S]*?)```/);
  if (fenceMatch && fenceMatch[1]) {
    const innerFm = extractFrontmatter(fenceMatch[1]);
    if (innerFm && Object.keys(innerFm).length > 0) {
      return innerFm;
    }
  }
  return {} as Frontmatter;
}

async function synthesizeLineWithRetry(
  client: ReturnType<typeof getElevenClient>,
  voiceId: string,
  text: string,
  outFile: string,
  maxAttempts = 3
): Promise<void> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt < maxAttempts) {
    try {
      await synthesizeLine(client, voiceId, text, outFile);
      return;
    } catch (err: any) {
      lastError = err;
      const status = err?.status ?? err?.statusCode ?? err?.response?.status;
      if (!RETRYABLE_STATUS.has(status) || attempt === maxAttempts - 1) {
        throw wrapSynthesisError(err, voiceId, text);
      }
      await wait(400 * Math.pow(2, attempt));
      attempt++;
    }
  }
  throw wrapSynthesisError(lastError, voiceId, text);
}

async function synthesizeLine(
  client: ReturnType<typeof getElevenClient>,
  voiceId: string,
  text: string,
  outFile: string
): Promise<void> {
  const responseStream = await client.textToSpeech.convert(voiceId, {
    text,
    modelId: DEFAULT_MODEL_ID as any,
    outputFormat: DEFAULT_OUTPUT_FORMAT as any,
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

async function approximateDurationFromFile(filePath: string): Promise<number | undefined> {
  try {
    const info = await stat(filePath);
    if (info.size === 0) return undefined;
    return calculateApproxDuration(info.size);
  } catch {
    return undefined;
  }
}

function calculateApproxDuration(bytes: number): number | undefined {
  const match = DEFAULT_OUTPUT_FORMAT.match(/mp3_\d+_(\d+)/);
  if (!match) return undefined;
  const kbps = Number.parseInt(match[1] ?? '', 10);
  if (!kbps) return undefined;
  const seconds = (bytes * 8) / (kbps * 1000);
  return Math.round(seconds * 100) / 100;
}

function wrapSynthesisError(error: unknown, voiceId: string, text: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Failed to synthesize line with voice "${voiceId}": ${message}\nLine: ${text}`);
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { resolveFfmpegPath, FfmpegNotFoundError } from './ffmpeg.js';

// Export types for orchestrator integration
export type { TtsMode, DialogueInput, DialogueSynthesisOptions, DialogueSynthesisResult, DialogueChunk } from './types.js';

// Export dialogue functions for orchestrator integration
export { chunkDialogueInputs, buildDialogueHash, synthesizeDialogue } from './dialogue.js';
