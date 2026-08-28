import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { loadBenchmarkEnvironment } from './env';
import {
  findCase,
  getBenchmarkRoot,
  readManifest,
  resolveUnderBenchmarkRoot,
  sha256File,
  writeManifest,
} from './manifest';
import { probeMedia } from './media';
import type { BenchmarkManifest, PreparedMedia } from './schema';
import { PREPARATION_VERSION } from './schema';

const execFile = promisify(execFileCallback);

export type DownmixPlan = {
  command: 'ffmpeg';
  args: string[];
  preparationVersion: string;
};

export function buildDownmixPlan(input: {
  inputPath: string;
  outputPath: string;
  sourceChannels: number;
}): DownmixPlan {
  if (input.sourceChannels !== 2) {
    throw new Error('Controlled downmix requires a source with exactly two channels.');
  }
  return {
    command: 'ffmpeg',
    args: [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      input.inputPath,
      '-map_metadata',
      '-1',
      '-vn',
      '-af',
      'pan=mono|c0=0.5*c0+0.5*c1',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      input.outputPath,
    ],
    preparationVersion: PREPARATION_VERSION,
  };
}

export { probeMedia } from './media';

export async function prepareCase(options: {
  manifestPath: string;
  caseId: string;
  benchmarkRoot?: string;
  outputRelativePath?: string;
}): Promise<BenchmarkManifest> {
  const benchmarkRoot = options.benchmarkRoot ?? getBenchmarkRoot();
  const manifestPath = resolveUnderBenchmarkRoot(options.manifestPath, benchmarkRoot);
  const manifest = await readManifest(manifestPath);
  const benchmarkCase = findCase(manifest, options.caseId);
  const inputPath = resolveUnderBenchmarkRoot(benchmarkCase.source.relativePath, benchmarkRoot);
  const actualSourceHash = await sha256File(inputPath);
  if (actualSourceHash !== benchmarkCase.source.sha256) {
    throw new Error(
      `Source SHA-256 does not match the manifest for ${options.caseId}; refusing to prepare it.`,
    );
  }
  const outputRelativePath =
    options.outputRelativePath ??
    path.join('prepared', manifest.campaignId, options.caseId, 'downmix-mono.wav');
  const outputPath = resolveUnderBenchmarkRoot(outputRelativePath, benchmarkRoot);
  const normalizedOutputRelativePath = path
    .relative(benchmarkRoot, outputPath)
    .split(path.sep)
    .join('/');
  const plan = buildDownmixPlan({
    inputPath,
    outputPath,
    sourceChannels: benchmarkCase.source.channels,
  });

  let outputExists = false;
  try {
    await stat(outputPath);
    outputExists = true;
  } catch {
    outputExists = false;
  }
  if (outputExists) {
    const existingHash = await sha256File(outputPath);
    if (
      benchmarkCase.prepared?.relativePath === normalizedOutputRelativePath &&
      benchmarkCase.prepared.sha256 === existingHash
    ) {
      return manifest;
    }
    throw new Error(`Refusing to overwrite an existing preparation artifact: ${outputPath}`);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await execFile(plan.command, plan.args, { windowsHide: true });
  const fileStat = await stat(outputPath);
  const metadata = await probeMedia(outputPath);
  if (metadata.channels !== 1 || metadata.sampleRateHz !== 16000) {
    throw new Error(`Preparation did not produce mono 16 kHz audio: ${outputPath}`);
  }

  benchmarkCase.prepared = {
    relativePath: normalizedOutputRelativePath,
    sha256: await sha256File(outputPath),
    bytes: fileStat.size,
    durationMs: metadata.durationMs,
    channels: metadata.channels,
    sampleRateHz: metadata.sampleRateHz,
    preparationVersion: PREPARATION_VERSION,
    kind: 'controlled_downmix_to_mono',
  } satisfies PreparedMedia;
  await writeManifest(manifestPath, manifest);
  return manifest;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const environment = loadBenchmarkEnvironment();
  const benchmarkRoot = getBenchmarkRoot(environment);
  const manifestPath = args.manifest;
  const caseId = args.case;
  if (!manifestPath || !caseId) {
    throw new Error('Usage: pnpm run audio-benchmark:prepare -- --manifest <path> --case <caseId>');
  }
  const manifest = await prepareCase({
    manifestPath: resolveUnderBenchmarkRoot(manifestPath, benchmarkRoot),
    caseId,
    benchmarkRoot,
    outputRelativePath: args.output,
  });
  console.log(
    JSON.stringify(
      { campaignId: manifest.campaignId, caseId, prepared: findCase(manifest, caseId).prepared },
      null,
      2,
    ),
  );
}

function parseArgs(argv: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument?.startsWith('--')) {
      const key = argument.slice(2);
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      values[key] = value;
      index += 1;
    }
  }
  return values;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
