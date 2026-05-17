#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const envFiles = ['.env.batch-backend', '.env'];
const defaultIntervalHours = 24;
const defaultVoicesOut = 'packages/orchestrator/configs/elevenlabs.voices.json';

interface CliOptions {
  out?: string;
  watch: boolean;
  intervalHours: number;
}

function printUsage(): void {
  console.log(`Usage: pnpm voices:sync [--out <path>] [--watch] [--interval-hours <hours>]

Loads .env.batch-backend and .env without overriding shell variables, then refreshes the
ElevenLabs voice catalog. Without --out, ESL_TTS_PROVIDER_ELEVENLABS_VOICES_PATH wins over
the default ${defaultVoicesOut}.
`);
}

function parsePositiveNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

function readIntervalHours(): number {
  const raw = process.env.ESL_ELEVENLABS_VOICES_SYNC_INTERVAL_HOURS?.trim();
  return raw
    ? parsePositiveNumber(raw, 'ESL_ELEVENLABS_VOICES_SYNC_INTERVAL_HOURS')
    : defaultIntervalHours;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    watch: false,
    intervalHours: readIntervalHours(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--watch') {
      options.watch = true;
      continue;
    }
    if (arg === '--once') {
      options.watch = false;
      continue;
    }
    if (arg === '--out') {
      const value = argv[index + 1];
      if (!value) throw new Error('--out requires a path.');
      options.out = value;
      index += 1;
      continue;
    }
    if (arg === '--interval-hours') {
      const value = argv[index + 1];
      if (!value) throw new Error('--interval-hours requires a value.');
      options.intervalHours = parsePositiveNumber(value, '--interval-hours');
      index += 1;
      continue;
    }
    if (arg.startsWith('--interval-hours=')) {
      options.intervalHours = parsePositiveNumber(
        arg.slice('--interval-hours='.length),
        '--interval-hours',
      );
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function loadEnvFiles(): Promise<string[]> {
  const loaded: string[] = [];
  for (const rel of envFiles) {
    const abs = path.resolve(repoRoot, rel);
    try {
      const parsed = parseEnv(await readFile(abs, 'utf8'));
      loaded.push(rel);
      for (const [key, value] of Object.entries(parsed)) {
        if (value !== undefined && process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
  }
  return loaded;
}

function resolveOutPath(options: CliOptions): string {
  return (
    options.out?.trim() ||
    process.env.ESL_TTS_PROVIDER_ELEVENLABS_VOICES_PATH?.trim() ||
    defaultVoicesOut
  );
}

async function runSync(options: CliOptions): Promise<void> {
  const { syncVoices } = await import('../syncVoices.js');
  const result = await syncVoices(resolveOutPath(options));
  console.log(
    `Synced ${result.count} ElevenLabs voices to ${path.relative(repoRoot, result.outPath) || result.outPath}.`,
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const loaded = await loadEnvFiles();
  if (loaded.length > 0) {
    console.log(`Loaded env from ${loaded.join(', ')}.`);
  }

  if (!options.watch) {
    await runSync(options);
    return;
  }

  const intervalMs = options.intervalHours * 60 * 60 * 1000;
  console.log(`Starting ElevenLabs voice sync loop every ${options.intervalHours} hour(s).`);

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  while (!stopping) {
    try {
      await runSync(options);
    } catch (error) {
      console.error(`Voice sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!stopping) {
      await sleep(intervalMs);
    }
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
