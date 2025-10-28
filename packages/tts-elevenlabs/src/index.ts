import { createHash } from 'node:crypto';
import { readFileSync, createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdir, copyFile, unlink, stat } from 'node:fs/promises';
import yaml from 'js-yaml';
import { extractStudyText, extractFrontmatter, type Frontmatter } from '@esl-pipeline/md-extractor';
import { loadVoicesCatalog, type VoiceCatalog } from './assign.js';
import { concatMp3Segments, synthSilenceMp3 } from './ffmpeg.js';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getElevenClient } from './eleven.js';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { resolveSpeakerVoices, type VoiceMapConfig } from './speakerAssignment.js';

const DEFAULT_MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2';
const DEFAULT_OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT ?? 'mp3_22050_32';
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function hashStudyText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

type BuildStudyTextOptions = {
  voiceMapPath: string;
  outPath: string;
  preview?: boolean;
  force?: boolean;
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
};

export async function buildStudyTextMp3(
  mdPath: string,
  opts: BuildStudyTextOptions
): Promise<BuildStudyTextResult> {
  // Read and extract study text
  const mdContent = readFileSync(mdPath, 'utf-8');
  const frontmatter = loadFrontmatter(mdContent);
  const studyText = extractStudyText(mdContent);
  const sanitizedSegments = studyText.lines
    .map(line => cleanSpeechText(parseSpeaker(line).text))
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
  const speakers = collectSpeakers(studyText, frontmatter);
  const assignments = await resolveSpeakerVoices({
    speakers,
    profiles: Array.isArray(frontmatter.speaker_profiles)
      ? frontmatter.speaker_profiles
      : undefined,
    voiceMap,
    catalog,
    mode: studyText.type,
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

  // Generate hash based on study text and voice map
  const hashInput = JSON.stringify({ text: normalizedText, voices: resolvedVoiceDescriptor });
  const hash = hashStudyText(hashInput);
  const fileName = `${hash}.mp3`;
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

  // Generate TTS for each line or chunk
  const segmentFiles: string[] = [];
  const cleanupTargets: string[] = [];
  const eleven = getElevenClient();
  const fallbackVoiceId = assignments[0]?.voiceId;

  for (const line of studyText.lines) {
    const { speaker, text } = parseSpeaker(line);
    const normalizedSpeaker = speaker?.trim() ?? '';
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

    if (!voiceId) {
      throw new Error(
        `No ElevenLabs voice could be resolved for line "${line}". ` +
          `Ensure frontmatter speaker profiles or voices.yml provide enough information.`
      );
    }

    const speechText = cleanSpeechText(text);
    if (!speechText) continue;

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
  if (tailSeconds > 0.01) {
    const silenceFileName = `${hash}-silence.mp3`;
    silencePath = resolve(outputDir, silenceFileName);
    await synthSilenceMp3(silencePath, tailSeconds);
    concatFiles.push(silencePath);
    cleanupTargets.push(silencePath);
  }

  try {
    if (concatFiles.length === 1) {
      await copyFile(concatFiles[0]!, targetPath);
    } else if (concatFiles.length > 1) {
      await concatMp3Segments(concatFiles, targetPath, true);
    }
  } finally {
    // best-effort cleanup; ignore errors
    await Promise.allSettled(cleanupTargets.map(p => unlink(p)));
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

function collectSpeakers(
  studyText: { type: 'monologue' | 'dialogue'; lines: string[] },
  frontmatter: Frontmatter
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (name: string | undefined | null) => {
    const trimmed = name?.trim();
    if (!trimmed) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    ordered.push(trimmed);
  };

  if (Array.isArray(frontmatter.speaker_labels)) {
    for (const label of frontmatter.speaker_labels) {
      if (typeof label === 'string') add(label);
    }
  }

  for (const line of studyText.lines) {
    const { speaker } = parseSpeaker(line);
    add(speaker);
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
