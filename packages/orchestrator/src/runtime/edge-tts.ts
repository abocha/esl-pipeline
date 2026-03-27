import { createHash } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { InfrastructureError, ValidationError, noopLogger, type PipelineLogger } from '@esl-pipeline/contracts';

export interface EdgeTtsSynthesisOptions {
  text: string;
  outPath: string;
  preview?: boolean;
  force?: boolean;
  voice?: string;
  rate?: string;
  pitch?: string;
  volume?: string;
  fileStem?: string;
  kind?: string;
  logger?: PipelineLogger;
}

export interface EdgeTtsSynthesisResult {
  path: string;
  hash: string;
  generatedCharacters: number;
  cachedCharacters: number;
  voice: string;
}

const DEFAULT_EDGE_TTS_VOICE = process.env.ESL_EDGE_TTS_VOICE?.trim() || 'en-US-AriaNeural';

async function fileExistsNonEmpty(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.size > 0;
  } catch {
    return false;
  }
}

type SpawnFunction = typeof import('node:child_process').spawn;

function resolveEdgeTtsCommand(): { command: string; argsPrefix: string[] } {
  const explicitBin = process.env.ESL_EDGE_TTS_BIN?.trim();
  if (explicitBin) {
    return { command: explicitBin, argsPrefix: [] };
  }

  const explicitPython = process.env.ESL_EDGE_TTS_PYTHON?.trim();
  if (explicitPython) {
    return { command: explicitPython, argsPrefix: ['-m', 'edge_tts'] };
  }

  return { command: 'edge-tts', argsPrefix: [] };
}

function sanitizeFileStem(value: string | undefined): string {
  const stem = value?.trim().replaceAll(/[^a-z0-9-]+/gi, '-').replaceAll(/^-+|-+$/g, '');
  return stem || 'pronunciation-edge';
}

async function spawnProcess(
  command: string,
  args: string[],
  logger: PipelineLogger,
): Promise<void> {
  const { spawn }: { spawn: SpawnFunction } = await import('node:child_process');
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TMPDIR: process.env.TMPDIR || '/tmp',
        TMP: process.env.TMP || process.env.TMPDIR || '/tmp',
        TEMP: process.env.TEMP || process.env.TMPDIR || '/tmp',
      },
    });

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    proc.on('error', (error) => {
      reject(error);
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      logger.log({
        level: 'warn',
        stage: 'tts',
        message: 'edge-tts command failed',
        detail: { command, args, code, stderr: stderr.trim() || null },
      });
      reject(
        new InfrastructureError(
          `edge-tts failed with exit code ${code ?? 'unknown'}${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
        ),
      );
    });
  });
}

export async function synthesizeEdgeTtsClip(
  options: EdgeTtsSynthesisOptions,
): Promise<EdgeTtsSynthesisResult> {
  const logger = options.logger ?? noopLogger;
  const text = String(options.text || '').trim();
  if (!text) {
    throw new ValidationError('edge-tts text is empty.');
  }

  const outputDir = resolve(options.outPath);
  await mkdir(outputDir, { recursive: true });

  const voice = options.voice?.trim() || DEFAULT_EDGE_TTS_VOICE;
  const fileStem = sanitizeFileStem(options.fileStem);
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        kind: options.kind ?? 'edge_pronunciation',
        text,
        voice,
        rate: options.rate ?? null,
        pitch: options.pitch ?? null,
        volume: options.volume ?? null,
        fileStem,
      }),
    )
    .digest('hex');

  const path = resolve(outputDir, `${hash}-${fileStem}.mp3`);
  const generatedCharacters = text.length;

  if (options.preview) {
    return { path, hash, generatedCharacters, cachedCharacters: 0, voice };
  }

  if (!options.force && (await fileExistsNonEmpty(path))) {
    return { path, hash, generatedCharacters: 0, cachedCharacters: generatedCharacters, voice };
  }

  const { command, argsPrefix } = resolveEdgeTtsCommand();
  const args = [
    ...argsPrefix,
    '--voice',
    voice,
    '--text',
    text,
    '--write-media',
    path,
  ];
  if (options.rate?.trim()) {
    args.push('--rate', options.rate.trim());
  }
  if (options.pitch?.trim()) {
    args.push('--pitch', options.pitch.trim());
  }
  if (options.volume?.trim()) {
    args.push('--volume', options.volume.trim());
  }

  logger.log({
    level: 'info',
    stage: 'tts',
    message: 'Generating edge-tts pronunciation audio',
    detail: { voice, fileStem },
  });
  await spawnProcess(command, args, logger);

  if (!(await fileExistsNonEmpty(path))) {
    throw new InfrastructureError(`edge-tts did not produce an audio file at ${path}.`);
  }

  return { path, hash, generatedCharacters, cachedCharacters: 0, voice };
}
