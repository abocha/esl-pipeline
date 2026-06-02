import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Mp3Metadata {
  title?: string;
  artist?: string;
}

export function buildMp3MetadataArgs(
  inputPath: string,
  outputPath: string,
  metadata: Mp3Metadata,
): string[] {
  const args = ['-y', '-i', inputPath];
  const title = metadata.title?.trim();
  const artist = metadata.artist?.trim();
  if (title) args.push('-metadata', `title=${title}`);
  if (artist) args.push('-metadata', `artist=${artist}`);
  return [...args, '-codec', 'copy', outputPath];
}

async function remuxMp3Metadata(
  inputPath: string,
  outputPath: string,
  metadata: Mp3Metadata,
): Promise<void> {
  const args = buildMp3MetadataArgs(inputPath, outputPath, metadata);
  const command = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `ffmpeg-set-mp3-metadata exited with code ${code}${stderr.trim() ? `\n${stderr.trim()}` : ''}`,
          ),
        );
      }
    });
  });
}

export async function withMp3MetadataExport<T>(
  inputPath: string,
  metadata: Mp3Metadata | undefined,
  operation: (exportPath: string) => Promise<T>,
): Promise<T> {
  if (!metadata?.title?.trim() && !metadata?.artist?.trim()) {
    return operation(inputPath);
  }

  const exportPath = join(tmpdir(), `esl-student-audio-${randomUUID()}.mp3`);
  try {
    await remuxMp3Metadata(inputPath, exportPath, metadata);
    return await operation(exportPath);
  } finally {
    await unlink(exportPath).catch(() => {});
  }
}
