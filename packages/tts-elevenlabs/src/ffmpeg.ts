import { spawn } from 'node:child_process';
import { writeFile, unlink, copyFile } from 'node:fs/promises';
import { homedir, platform, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const isWindows = platform() === 'win32';
const PATH_SEPARATOR = isWindows ? ';' : ':';
const BINARY_CANDIDATES = isWindows ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg'];

let cachedBinary: string | null = null;

import { FfmpegNotFoundError } from '@esl-pipeline/contracts';
export { FfmpegNotFoundError };

async function canSpawn(command: string): Promise<boolean> {
  return new Promise(resolve => {
    const proc = spawn(command, ['-version'], { stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('exit', code => resolve(code === 0));
  });
}

function cachePathCandidates(): string[] {
  const base =
    process.env.ESL_PIPELINE_FFMPEG_CACHE && process.env.ESL_PIPELINE_FFMPEG_CACHE.length > 0
      ? process.env.ESL_PIPELINE_FFMPEG_CACHE
      : join(homedir(), '.cache', 'esl-pipeline', 'ffmpeg');
  return BINARY_CANDIDATES.map(name => join(base, `${platform()}-${process.arch}`, name));
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
  // Also allow bare command for spawn when PATH is configured
  return candidates.concat(BINARY_CANDIDATES);
}

async function resolveCandidateList(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (await canSpawn(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function resolveFfmpegPath(explicit?: string): Promise<string> {
  const tryExplicit = explicit ?? process.env.FFMPEG_PATH;
  if (tryExplicit && (await canSpawn(tryExplicit))) {
    cachedBinary = tryExplicit;
    return tryExplicit;
  }

  if (cachedBinary && (await canSpawn(cachedBinary))) {
    return cachedBinary;
  }

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

  const instructions = [
    'FFmpeg is required to stitch ElevenLabs audio but no executable was found.',
    'Install FFmpeg and ensure it is available on your PATH, or set the FFMPEG_PATH environment variable.',
    '',
    'Quick install guides:',
    '  • macOS:   brew install ffmpeg',
    '  • Ubuntu:  sudo apt-get install ffmpeg',
    '  • Windows: choco install ffmpeg',
    '',
    'We will ship an optional auto-download in a future release; for now please install FFmpeg manually.',
  ].join('\n');

  throw new FfmpegNotFoundError(instructions);
}

/** Run ffmpeg with args; rejects on non-zero exit. */
export async function runFfmpeg(
  args: string[],
  label = 'ffmpeg',
  explicitPath?: string
): Promise<void> {
  const bin = await resolveFfmpegPath(explicitPath);
  await new Promise<void>((resolvePromise, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('exit', code => {
      if (code === 0) {
        resolvePromise();
      } else {
        const parts = [`${label} exited with code ${code}`];
        const trimmedStdout = stdout.trim();
        const trimmedStderr = stderr.trim();
        if (trimmedStdout) parts.push(`stdout:\n${trimmedStdout}`);
        if (trimmedStderr) parts.push(`stderr:\n${trimmedStderr}`);
        reject(new Error(parts.join('\n\n')));
      }
    });
  });
}

/**
 * Concatenate MP3 segments using the concat demuxer.
 * If `reencode` is true, re-encodes to MP3 (slower but tolerant).
 */
export async function concatMp3Segments(
  segmentPaths: string[],
  outFile: string,
  reencode = false,
  ffmpegPath?: string
): Promise<void> {
  if (segmentPaths.length === 0) throw new Error('No segments to concatenate');
  const abs = segmentPaths.map(p => resolve(p));

  const listFile = join(tmpdir(), `ffconcat_${Date.now()}.txt`);
  const lines = abs.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await writeFile(listFile, lines, 'utf8');

  const argsFast = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outFile];
  const argsReenc = [
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
  ];

  try {
    if (reencode) {
      await runFfmpeg(argsReenc, 'ffmpeg-concat-reencode', ffmpegPath);
    } else {
      try {
        await runFfmpeg(argsFast, 'ffmpeg-concat-fast', ffmpegPath);
      } catch {
        await runFfmpeg(argsReenc, 'ffmpeg-concat-reencode', ffmpegPath);
      }
    }
  } finally {
    try {
      await unlink(listFile);
    } catch { }
  }
}

/**
 * Update the ID3 title frame for an MP3 by replaying the file through FFmpeg.
 * We copy the metadata-tagged temp file back on top of the original so we
 * never leave the file in a partially-updated state in case of failure.
 */
export async function setMp3TitleMetadata(
  filePath: string,
  title: string,
  ffmpegPath?: string
): Promise<void> {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return;

  const tempPath = join(
    tmpdir(),
    `ffmeta-title-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`
  );
  const args = [
    '-y',
    '-i',
    filePath,
    '-metadata',
    `title=${trimmedTitle}`,
    '-codec',
    'copy',
    tempPath,
  ];

  try {
    await runFfmpeg(args, 'ffmpeg-set-metadata-title', ffmpegPath);
    await copyFile(tempPath, filePath);
  } finally {
    await unlink(tempPath).catch(() => { });
  }
}

export async function synthSilenceMp3(
  outFile: string,
  seconds: number,
  ffmpegPath?: string
): Promise<void> {
  const dur = Math.max(0.3, Math.min(seconds, 10)); // keep sane bounds
  const args = [
    '-y',
    '-f',
    'lavfi',
    '-t',
    String(dur),
    '-i',
    'anullsrc=channel_layout=mono:sample_rate=22050',
    '-c:a',
    'libmp3lame',
    '-q:a',
    '7',
    outFile,
  ];
  await runFfmpeg(args, 'ffmpeg-synth-silence', ffmpegPath);
}
