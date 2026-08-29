import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadBenchmarkEnvironment } from './env';
import { getBenchmarkRoot, resolveUnderBenchmarkRoot, writeJsonFile } from './manifest';
import { deriveComparableSegments } from './normalize';
import { getProviderAdapter } from './providers';
import type { BenchmarkRun } from './schema';

export async function rederiveDirectRunArtifacts(options: {
  runPath: string;
  benchmarkRoot?: string;
}): Promise<BenchmarkRun> {
  const benchmarkRoot = options.benchmarkRoot ?? getBenchmarkRoot(loadBenchmarkEnvironment());
  const runDirectory = resolveUnderBenchmarkRoot(options.runPath, benchmarkRoot);
  const runRecordPath = path.join(runDirectory, 'run.json');
  const run = JSON.parse(await readFile(runRecordPath, 'utf8')) as BenchmarkRun;

  if (run.status !== 'success') {
    throw new Error(`Only successful runs can be re-derived: ${run.runId}`);
  }
  const [rawResponseRelativePath] = run.rawResponsePaths ?? [];
  if (
    run.requestMode !== 'direct' ||
    run.rawResponsePaths?.length !== 1 ||
    !rawResponseRelativePath
  ) {
    throw new Error(
      'Re-derivation currently supports one raw response from a direct provider run only.',
    );
  }

  const rawResponsePath = resolveUnderBenchmarkRoot(
    path.join(options.runPath, rawResponseRelativePath),
    benchmarkRoot,
  );
  const adapter = getProviderAdapter(run.providerId);
  const parsed = adapter.parseResponse(
    JSON.parse(await readFile(rawResponsePath, 'utf8')) as unknown,
  );

  await writeJsonFile(path.join(runDirectory, 'native-segments.json'), {
    providerId: run.providerId,
    segments: parsed.nativeSegments,
  });
  await writeJsonFile(path.join(runDirectory, 'comparable-segments.json'), {
    providerId: run.providerId,
    segments: deriveComparableSegments(parsed.nativeSegments, run.providerId),
  });

  run.returnedModel = parsed.returnedModel;
  run.providerUsage = parsed.usage;
  run.nativeSegmentsPath = 'native-segments.json';
  run.comparableSegmentsPath = 'comparable-segments.json';
  await writeJsonFile(runRecordPath, run);
  return run;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const run = await rederiveDirectRunArtifacts({ runPath: required(args, 'run') });
  console.log(
    JSON.stringify(
      {
        runId: run.runId,
        providerId: run.providerId,
        returnedModel: run.returnedModel,
        nativeSegmentsPath: run.nativeSegmentsPath,
        comparableSegmentsPath: run.comparableSegmentsPath,
        networkRequests: 0,
      },
      null,
      2,
    ),
  );
}

function parseArgs(argv: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith('--')) continue;
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    values[key] = value;
    index += 1;
  }
  return values;
}

function required(args: Record<string, string>, name: string): string {
  const value = args[name];
  if (!value) throw new Error(`Missing required --${name}`);
  return value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
