import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { FfmpegNotFoundError } from '@esl-pipeline/contracts';
import { type TtsRequestControl, throwIfTtsCancelled } from '@esl-pipeline/tts-core';

import { GeminiTtsError } from './client.js';

/** Temporary output plus rename prevents partial provider output becoming a cache hit. */
export async function encodeGeminiMp3(
  audio: Buffer,
  target: string,
  options: TtsRequestControl & { ffmpegPath?: string },
): Promise<void> {
  throwIfTtsCancelled(options);
  await mkdir(dirname(target), { recursive: true });
  const stem = `${target}.${randomUUID()}`;
  const wav = `${stem}.wav`;
  const mp3 = `${stem}.mp3`;
  try {
    await writeFile(wav, audio);
    throwIfTtsCancelled(options);
    const remaining =
      options.deadlineAtMs === undefined
        ? 180000
        : Math.min(180000, options.deadlineAtMs - Date.now());
    const signal = AbortSignal.any([
      AbortSignal.timeout(Math.max(1, remaining)),
      ...(options.signal ? [options.signal] : []),
    ]);
    await new Promise<void>((resolveRun, reject) => {
      const proc = spawn(
        options.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg',
        [
          '-nostdin',
          '-v',
          'error',
          '-y',
          '-i',
          wav,
          '-vn',
          '-ar',
          '24000',
          '-ac',
          '1',
          '-codec:a',
          'libmp3lame',
          '-b:a',
          '128k',
          mp3,
        ],
        { windowsHide: true, stdio: 'ignore', signal },
      );
      let spawnError: Error | undefined;
      proc.on('error', (error: NodeJS.ErrnoException) => {
        spawnError =
          error.code === 'ENOENT'
            ? new FfmpegNotFoundError(
                'FFmpeg is required for Gemini TTS MP3 output. Install it or set FFMPEG_PATH.',
              )
            : new Error('Gemini TTS audio encoding failed.');
      });
      proc.on('close', (code) => {
        try {
          throwIfTtsCancelled(options);
        } catch (error) {
          reject(error);
          return;
        }
        if (signal.aborted) {
          reject(new GeminiTtsError('provider_timeout'));
          return;
        }
        if (spawnError || code !== 0) {
          reject(spawnError ?? new Error('Gemini TTS audio encoding failed.'));
          return;
        }
        resolveRun();
      });
    });
    throwIfTtsCancelled(options);
    await rename(mp3, target);
  } finally {
    await Promise.all([unlink(wav).catch(() => {}), unlink(mp3).catch(() => {})]);
  }
}
