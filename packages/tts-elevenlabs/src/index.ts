import { createHash } from 'node:crypto';
import { readFileSync, createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdir, copyFile, unlink, stat } from 'node:fs/promises';
import yaml from 'js-yaml';
import { extractStudyText } from '@esl-pipeline/md-extractor';
import { pickVoiceForSpeaker, loadVoicesCatalog, type VoiceCatalog } from './assign.js';
import { concatMp3Segments } from './ffmpeg.js';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getElevenClient } from './eleven.js';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

const DEFAULT_MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2';
const DEFAULT_OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT ?? 'mp3_22050_32';
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function hashStudyText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export async function buildStudyTextMp3(
  mdPath: string,
  opts: { voiceMapPath: string; outPath: string; preview?: boolean; force?: boolean }
): Promise<{ path: string; duration?: number; hash: string }> {
  // Read and extract study text
  const mdContent = readFileSync(mdPath, 'utf-8');
  const studyText = extractStudyText(mdContent);
  const normalizedText = studyText.lines.join('\n');

  // Load voice map
  const voiceMapContent = readFileSync(opts.voiceMapPath, 'utf-8');
  const voiceMap = yaml.load(voiceMapContent) as Record<string, string>;
  const catalog = await loadVoicesCatalog().catch(() => ({ voices: [] }));

  // Generate hash based on study text and voice map
  const hashInput = JSON.stringify({ text: normalizedText, voices: voiceMap });
  const hash = hashStudyText(hashInput);
  const fileName = `${hash}.mp3`;
  const outputDir = resolve(opts.outPath || dirname(mdPath));
  const targetPath = resolve(outputDir, fileName);

  if (opts.preview) {
    return {
      path: targetPath,
      hash,
      duration: undefined,
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
        };
      }
    } catch {
      // File doesn't exist, proceed with generation
    }
  }

  // Generate TTS for each line or chunk
  const audioFiles: string[] = [];
  const eleven = getElevenClient();

  for (const line of studyText.lines) {
    const voiceId = await getVoiceIdForLine(line, voiceMap as any, studyText.type, catalog);
    if (!voiceId) {
      throw new Error(
        `No ElevenLabs voice could be resolved for line "${line}". ` +
          `Ensure voices.yml defines the speaker, a default voice, or enable auto selection.`
      );
    }

    // Create a temporary file for this line's audio
    const lineHash = createHash('sha256').update(`${line}-${voiceId}`).digest('hex');
    const lineFileName = `${lineHash}.mp3`;
    const lineFilePath = resolve(outputDir, lineFileName);

    const { text } = parseSpeaker(line);
    if (!text) continue;

    if (!opts.force && (await fileExistsNonEmpty(lineFilePath))) {
      audioFiles.push(lineFilePath);
      continue;
    }

    await synthesizeLineWithRetry(eleven, voiceId, text, lineFilePath);
    audioFiles.push(lineFilePath);
  }
  if (audioFiles.length === 0) {
    throw new Error(
      'TTS produced 0 segments. Check voices.yml (default/auto) and study-text content.'
    );
  }

  try {
    if (audioFiles.length === 1) {
      await copyFile(audioFiles[0]!, targetPath);
    } else if (audioFiles.length > 1) {
      await concatMp3Segments(audioFiles, targetPath, true);
    }
  } finally {
    // best-effort cleanup; ignore errors
    await Promise.allSettled(audioFiles.map(p => unlink(p)));
  }

  return {
    path: targetPath,
    duration: await approximateDurationFromFile(targetPath),
    hash,
  };
}

type VoiceMap = {
  // manual overrides:
  [speaker: string]: string;
} & {
  default?: string;
  auto?: boolean;
};

function parseSpeaker(line: string): { speaker?: string; text: string } {
  const idx = line.indexOf(':');
  if (idx > 0 && idx < 40) {
    return { speaker: line.slice(0, idx).trim(), text: line.slice(idx + 1).trim() };
  }
  return { text: line.trim() };
}

async function getVoiceIdForLine(
  line: string,
  voiceMap: VoiceMap,
  mode: 'monologue' | 'dialogue',
  catalog: VoiceCatalog
): Promise<string | undefined> {
  // 1) manual override by exact speaker
  const { speaker } = parseSpeaker(line);
  if (speaker && voiceMap[speaker]) {
    const resolved = resolveVoiceToken(voiceMap[speaker], catalog);
    if (resolved) return resolved;
  }

  // 2) manual default
  if (voiceMap.default) {
    const resolved = resolveVoiceToken(voiceMap.default, catalog);
    if (resolved) return resolved;
  }

  // 3) auto mode (if enabled) — pick by gender/role
  if (voiceMap.auto) {
    const role =
      mode === 'monologue'
        ? 'narrator'
        : speaker?.toLowerCase() === 'narrator'
          ? 'narrator'
          : 'student';
    const picked = await pickVoiceForSpeaker(speaker || 'Narrator', { role: role as any });
    return picked || undefined;
  }

  // 4) final fallback: try catalog’s first voice, or undefined
  return catalog.voices[0]?.id;
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

function resolveVoiceToken(token: string, catalog: VoiceCatalog): string | undefined {
  const trimmed = token.trim();
  if (!trimmed) return undefined;
  const byId = catalog.voices.find(v => v.id === trimmed);
  if (byId) return byId.id;
  const byName = catalog.voices.find(v => v.name?.toLowerCase() === trimmed.toLowerCase());
  if (byName) return byName.id;
  return trimmed;
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
