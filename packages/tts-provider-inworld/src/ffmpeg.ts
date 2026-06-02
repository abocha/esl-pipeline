import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { homedir, platform, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { FfmpegNotFoundError } from '@esl-pipeline/contracts';

const isWindows = platform() === 'win32';
const PATH_SEPARATOR = isWindows ? ';' : ':';
const BINARY_CANDIDATES = isWindows ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg'];

let cachedBinary: string | null = null;

async function canSpawn(command: string): Promise<boolean> {
  return new Promise((resolveSpawn) => {
    const proc = spawn(command, ['-version'], { stdio: 'ignore' });
    proc.on('error', () => resolveSpawn(false));
    proc.on('exit', (code) => resolveSpawn(code === 0));
  });
}

function cachePathCandidates(): string[] {
  const base =
    process.env.ESL_PIPELINE_FFMPEG_CACHE && process.env.ESL_PIPELINE_FFMPEG_CACHE.length > 0
      ? process.env.ESL_PIPELINE_FFMPEG_CACHE
      : join(homedir(), '.cache', 'esl-pipeline', 'ffmpeg');
  return BINARY_CANDIDATES.map((name) => join(base, `${platform()}-${process.arch}`, name));
}

function systemPathCandidates(): string[] {
  const pathValue = process.env.PATH ?? '';
  const dirs = pathValue.split(PATH_SEPARATOR).filter(Boolean);
  const candidates: string[] = [];
  for (const dir of dirs) {
    for (const name of BINARY_CANDIDATES) {
      candidates.push(join(dir, name));
    }
  }
  return [...candidates, ...BINARY_CANDIDATES];
}

async function resolveCandidateList(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (await canSpawn(candidate)) return candidate;
  }
  return null;
}

export async function resolveFfmpegPath(explicit?: string): Promise<string> {
  const tryExplicit = explicit ?? process.env.FFMPEG_PATH;
  if (tryExplicit && (await canSpawn(tryExplicit))) {
    cachedBinary = tryExplicit;
    return tryExplicit;
  }
  if (cachedBinary && (await canSpawn(cachedBinary))) return cachedBinary;
  const cacheCandidate = await resolveCandidateList(cachePathCandidates());
  if (cacheCandidate) {
    cachedBinary = cacheCandidate;
    return cacheCandidate;
  }
  const pathCandidate = await resolveCandidateList(systemPathCandidates());
  if (pathCandidate) {
    cachedBinary = pathCandidate;
    return pathCandidate;
  }
  throw new FfmpegNotFoundError(
    'FFmpeg is required to stitch Inworld TTS audio but no executable was found. Install FFmpeg or set FFMPEG_PATH.',
  );
}

async function runFfmpeg(args: string[], label: string, explicitPath?: string): Promise<void> {
  const bin = await resolveFfmpegPath(explicitPath);
  await new Promise<void>((resolveRun, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        reject(
          new Error(
            `${label} exited with code ${code}${stderr.trim() ? `\n${stderr.trim()}` : ''}`,
          ),
        );
      }
    });
  });
}

export async function concatMp3Segments(
  segmentPaths: string[],
  outFile: string,
  reencode = false,
  ffmpegPath?: string,
  gapDurationsMs: number[] = [],
): Promise<void> {
  if (segmentPaths.length === 0) throw new Error('No segments to concatenate');
  if (gapDurationsMs.length > 0 && gapDurationsMs.length !== segmentPaths.length - 1) {
    throw new Error('Gap durations must describe every boundary between segments');
  }
  const listFile = join(tmpdir(), `ffconcat-inworld-${Date.now()}.txt`);
  const silenceFiles: string[] = [];
  const pathsWithMargins: string[] = [];
  for (const [index, segmentPath] of segmentPaths.entries()) {
    pathsWithMargins.push(segmentPath);
    const durationMs = gapDurationsMs[index];
    if (!durationMs) continue;
    const silencePath = join(tmpdir(), `ffconcat-inworld-silence-${randomUUID()}.mp3`);
    await runFfmpeg(
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=48000:cl=mono',
        '-t',
        String(durationMs / 1000),
        '-c:a',
        'libmp3lame',
        '-b:a',
        '128k',
        silencePath,
      ],
      'ffmpeg-generate-silence',
      ffmpegPath,
    );
    silenceFiles.push(silencePath);
    pathsWithMargins.push(silencePath);
  }
  const lines = pathsWithMargins
    .map((p) => `file '${resolve(p).replaceAll("'", String.raw`'\''`)}'`)
    .join('\n');
  await writeFile(listFile, lines, 'utf8');
  const args = reencode
    ? [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listFile,
        '-c:a',
        'libmp3lame',
        '-b:a',
        '128k',
        outFile,
      ]
    : ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outFile];
  try {
    await runFfmpeg(args, reencode ? 'ffmpeg-concat-reencode' : 'ffmpeg-concat-fast', ffmpegPath);
  } finally {
    await unlink(listFile).catch(() => {});
    await Promise.all(silenceFiles.map((path) => unlink(path).catch(() => {})));
  }
}

export { FfmpegNotFoundError };
