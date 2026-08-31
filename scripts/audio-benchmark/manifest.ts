import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadBenchmarkEnvironment } from './env';
import { probeMedia } from './media';
import type { BenchmarkCase, BenchmarkManifest, BenchmarkRunMode } from './schema';
import { BENCHMARK_RUNNER_VERSION, BENCHMARK_SCHEMA_VERSION, PREPARATION_VERSION } from './schema';

export type CaseInput = {
  caseId: string;
  relativePath: string;
  absolutePath: string;
  sha256: string;
  bytes: number;
  durationMs: number;
  channels: number;
  sampleRateHz?: number;
  sourceSha256: string;
  sourceDurationMs: number;
  sourceChannels: number;
  preparedSha256?: string;
  inputArtifact: 'prepared_artifact' | 'original_source';
  originalSourceDirect: 'not_tested';
  runMode: BenchmarkRunMode;
};

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const file = await readFile(filePath);
  hash.update(file);
  return hash.digest('hex');
}

export async function snapshotVerifiedFile(
  sourcePath: string,
  snapshotPath: string,
  expectedSha256: string,
): Promise<{ sha256: string; bytes: number }> {
  await mkdir(path.dirname(snapshotPath), { recursive: true });
  try {
    const existing = await stat(snapshotPath);
    const existingHash = await sha256File(snapshotPath);
    if (existingHash !== expectedSha256) {
      throw new Error(`Existing benchmark input snapshot hash does not match: ${snapshotPath}`);
    }
    return { sha256: existingHash, bytes: existing.size };
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }

  await copyFile(sourcePath, snapshotPath);
  const snapshotHash = await sha256File(snapshotPath);
  if (snapshotHash !== expectedSha256) {
    throw new Error(
      `Benchmark input snapshot SHA-256 does not match the expected selected input: ${snapshotPath}`,
    );
  }
  return { sha256: snapshotHash, bytes: (await stat(snapshotPath)).size };
}

export function computeManifestFingerprint(manifest: BenchmarkManifest): string {
  const fingerprintSource = {
    ...manifest,
    corpusHash: undefined,
    cases: [...manifest.cases].sort((left, right) => left.caseId.localeCompare(right.caseId)),
  };
  return sha256Text(canonicalJson(fingerprintSource));
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function assertRelativePath(relativePath: string, fieldName: string): void {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]+/u).some((part) => part === '..')
  ) {
    throw new Error(`${fieldName} must be a relative path inside ESL_AUDIO_BENCHMARK_ROOT.`);
  }
}

export function validateManifest(manifest: BenchmarkManifest): void {
  if (manifest.schemaVersion !== '1.0') {
    throw new Error(`Unsupported benchmark manifest schema: ${manifest.schemaVersion}`);
  }
  if (!manifest.campaignId || !manifest.cases.length) {
    throw new Error('Benchmark manifest requires a campaignId and at least one case.');
  }
  if (
    manifest.corpusHash &&
    (!isSha256(manifest.corpusHash) || computeManifestFingerprint(manifest) !== manifest.corpusHash)
  ) {
    throw new Error('Benchmark manifest corpusHash does not match its contents.');
  }

  const caseIds = new Set<string>();
  for (const benchmarkCase of manifest.cases) {
    if (!benchmarkCase.caseId || caseIds.has(benchmarkCase.caseId)) {
      throw new Error(`Benchmark caseId must be present and unique: ${benchmarkCase.caseId}`);
    }
    caseIds.add(benchmarkCase.caseId);
    validateMedia(benchmarkCase.source, `cases.${benchmarkCase.caseId}.source`);
    if (
      benchmarkCase.topology === 'trusted_split_two_channel' &&
      benchmarkCase.source.channels !== 2
    ) {
      throw new Error(
        `Trusted split case ${benchmarkCase.caseId} must have exactly two source channels.`,
      );
    }
    if (benchmarkCase.prepared) {
      validateMedia(benchmarkCase.prepared, `cases.${benchmarkCase.caseId}.prepared`);
      if (benchmarkCase.prepared.channels !== 1) {
        throw new Error(`Prepared benchmark media must be mono: ${benchmarkCase.caseId}`);
      }
      if (benchmarkCase.prepared.preparationVersion !== manifest.preparationVersion) {
        throw new Error(
          `Prepared media version does not match the manifest: ${benchmarkCase.caseId}`,
        );
      }
    }
  }
}

function validateMedia(
  media: {
    relativePath: string;
    sha256: string;
    bytes: number;
    wallClockDurationMs?: number;
    durationMs?: number;
    channels: number;
    sampleRateHz?: number;
  },
  fieldName: string,
): void {
  assertRelativePath(media.relativePath, `${fieldName}.relativePath`);
  if (!isSha256(media.sha256)) {
    throw new Error(`${fieldName}.sha256 must be a lowercase SHA-256 hex digest.`);
  }
  if (
    !Number.isSafeInteger(media.bytes) ||
    media.bytes < 0 ||
    !Number.isInteger(media.channels) ||
    media.channels < 1
  ) {
    throw new Error(`${fieldName} has invalid byte or channel metadata.`);
  }
  const durationMs = media.wallClockDurationMs ?? media.durationMs;
  if (!Number.isFinite(durationMs) || durationMs === undefined || durationMs < 0) {
    throw new Error(`${fieldName} requires a non-negative duration in milliseconds.`);
  }
  if (
    media.sampleRateHz !== undefined &&
    (!Number.isInteger(media.sampleRateHz) || media.sampleRateHz < 1)
  ) {
    throw new Error(`${fieldName}.sampleRateHz must be a positive integer.`);
  }
}

export function getBenchmarkRoot(
  environment: NodeJS.ProcessEnv = process.env,
  repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
): string {
  const root = environment.ESL_AUDIO_BENCHMARK_ROOT;
  if (!root) {
    throw new Error('ESL_AUDIO_BENCHMARK_ROOT is required for private benchmark material.');
  }
  return assertExternalBenchmarkRoot(root, repositoryRoot);
}

function assertExternalBenchmarkRoot(root: string, repositoryRoot: string): string {
  let realRoot: string;
  let realRepositoryRoot: string;
  try {
    realRoot = realpathSync.native(path.resolve(root));
    realRepositoryRoot = realpathSync.native(path.resolve(repositoryRoot));
    if (!statSync(realRoot).isDirectory()) throw new Error('Benchmark root is not a directory.');
  } catch {
    throw new Error(
      'ESL_AUDIO_BENCHMARK_ROOT must be an existing directory whose real path can be verified outside the repository.',
    );
  }
  const relationship = path.relative(realRepositoryRoot, realRoot);
  if (
    relationship === '' ||
    (relationship !== '..' &&
      !relationship.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relationship))
  ) {
    throw new Error('ESL_AUDIO_BENCHMARK_ROOT must resolve outside the repository checkout.');
  }
  return realRoot;
}

export function resolveUnderBenchmarkRoot(
  relativeOrAbsolutePath: string,
  benchmarkRoot: string,
): string {
  const root = getBenchmarkRoot({ ESL_AUDIO_BENCHMARK_ROOT: benchmarkRoot });
  const candidate = path.resolve(root, relativeOrAbsolutePath);
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path must remain inside ESL_AUDIO_BENCHMARK_ROOT: ${relativeOrAbsolutePath}`);
  }
  try {
    const realCandidate = realpathSync.native(candidate);
    assertPathInsideRoot(root, realCandidate, relativeOrAbsolutePath);
    return realCandidate;
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    let existingParent = candidate;
    while (true) {
      const parent = path.dirname(existingParent);
      if (parent === existingParent) {
        throw new Error(`Unable to verify path safety: ${relativeOrAbsolutePath}`);
      }
      existingParent = parent;
      try {
        const realParent = realpathSync.native(existingParent);
        assertPathInsideRoot(root, realParent, relativeOrAbsolutePath);
        return candidate;
      } catch (parentError: unknown) {
        if (
          !(parentError instanceof Error && 'code' in parentError && parentError.code === 'ENOENT')
        ) {
          throw parentError;
        }
      }
    }
  }
}

function assertPathInsideRoot(root: string, candidate: string, originalPath: string): void {
  const relationship = path.relative(root, candidate);
  if (
    relationship === '..' ||
    relationship.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relationship)
  ) {
    throw new Error(`Path resolves outside ESL_AUDIO_BENCHMARK_ROOT: ${originalPath}`);
  }
}

export function defaultManifestPath(benchmarkRoot: string, campaignId: string): string {
  return resolveUnderBenchmarkRoot(
    path.join('corpora', campaignId, 'manifest.json'),
    benchmarkRoot,
  );
}

export function findCase(manifest: BenchmarkManifest, caseId: string): BenchmarkCase {
  const benchmarkCase = manifest.cases.find((item) => item.caseId === caseId);
  if (!benchmarkCase) {
    throw new Error(`Unknown benchmark case: ${caseId}`);
  }
  return benchmarkCase;
}

export function resolveCaseInput(
  manifest: BenchmarkManifest,
  caseId: string,
  runMode: BenchmarkRunMode,
  benchmarkRoot: string,
): CaseInput {
  validateManifest(manifest);
  const benchmarkCase = findCase(manifest, caseId);
  const prepared = benchmarkCase.prepared;

  if (runMode === 'mixed_diarized' && !prepared) {
    throw new Error(`Mixed diarized mode requires prepared media for case ${caseId}.`);
  }
  if (
    runMode === 'trusted_split_control' &&
    benchmarkCase.topology !== 'trusted_split_two_channel'
  ) {
    throw new Error(`Trusted split control requires a trusted two-channel case: ${caseId}.`);
  }

  const selected = runMode === 'mixed_diarized' ? prepared! : benchmarkCase.source;
  return {
    caseId,
    relativePath: selected.relativePath,
    absolutePath: resolveUnderBenchmarkRoot(selected.relativePath, benchmarkRoot),
    sha256: selected.sha256,
    bytes: selected.bytes,
    durationMs: 'durationMs' in selected ? selected.durationMs : selected.wallClockDurationMs,
    channels: selected.channels,
    sampleRateHz: selected.sampleRateHz,
    sourceSha256: benchmarkCase.source.sha256,
    sourceDurationMs: benchmarkCase.source.wallClockDurationMs,
    sourceChannels: benchmarkCase.source.channels,
    preparedSha256: prepared?.sha256,
    inputArtifact: runMode === 'mixed_diarized' ? 'prepared_artifact' : 'original_source',
    originalSourceDirect: 'not_tested',
    runMode,
  };
}

export async function readManifest(manifestPath: string): Promise<BenchmarkManifest> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BenchmarkManifest;
  validateManifest(manifest);
  return manifest;
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

export async function writeManifest(
  manifestPath: string,
  manifest: BenchmarkManifest,
): Promise<void> {
  const manifestWithoutStoredHash = { ...manifest, corpusHash: '' };
  validateManifest(manifestWithoutStoredHash);
  await writeJsonFile(manifestPath, {
    ...manifestWithoutStoredHash,
    corpusHash: computeManifestFingerprint(manifestWithoutStoredHash),
  });
}

export async function addManifestCase(options: {
  benchmarkRoot: string;
  campaignId: string;
  caseId: string;
  sourcePath: string;
  topology: BenchmarkCase['topology'];
  wallClockDurationMs: number;
  channels: number;
  sampleRateHz?: number;
  container?: string;
  codec?: string;
  manifestPath?: string;
}): Promise<{ manifestPath: string; manifest: BenchmarkManifest }> {
  const manifestPath =
    options.manifestPath ?? defaultManifestPath(options.benchmarkRoot, options.campaignId);
  const sourceAbsolutePath = resolveUnderBenchmarkRoot(options.sourcePath, options.benchmarkRoot);
  const sourceStat = await stat(sourceAbsolutePath);
  const observed = await probeMedia(sourceAbsolutePath);
  assertObservedMedia(options, observed);
  const relativePath = path.relative(
    getBenchmarkRoot({ ESL_AUDIO_BENCHMARK_ROOT: options.benchmarkRoot }),
    sourceAbsolutePath,
  );
  const normalizedRelativePath = relativePath.split(path.sep).join('/');
  const existing = await readOptionalManifest(manifestPath);
  const manifest: BenchmarkManifest = existing ?? {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    campaignId: options.campaignId,
    runnerVersion: BENCHMARK_RUNNER_VERSION,
    createdAt: new Date().toISOString(),
    corpusHash: '',
    preparationVersion: PREPARATION_VERSION,
    cases: [],
  };
  if (manifest.campaignId !== options.campaignId) {
    throw new Error(`Manifest campaignId does not match: ${manifest.campaignId}`);
  }
  if (manifest.cases.some((benchmarkCase) => benchmarkCase.caseId === options.caseId)) {
    throw new Error(`Benchmark case already exists: ${options.caseId}`);
  }
  const benchmarkCase: BenchmarkCase = {
    caseId: options.caseId,
    topology: options.topology,
    tags: [],
    source: {
      relativePath: normalizedRelativePath,
      sha256: await sha256File(sourceAbsolutePath),
      bytes: sourceStat.size,
      container: observed.container,
      codec: observed.codec,
      wallClockDurationMs: observed.durationMs,
      channels: observed.channels,
      sampleRateHz: observed.sampleRateHz,
    },
  };
  manifest.cases.push(benchmarkCase);
  await writeManifest(manifestPath, manifest);
  return { manifestPath, manifest: await readManifest(manifestPath) };
}

function assertObservedMedia(
  options: {
    wallClockDurationMs: number;
    channels: number;
    sampleRateHz?: number;
    container?: string;
    codec?: string;
  },
  observed: Awaited<ReturnType<typeof probeMedia>>,
): void {
  const mismatch = (field: string, expected: unknown, actual: unknown): never => {
    throw new Error(
      `ffprobe ${field} mismatch: expected ${String(expected)}, observed ${String(actual)}.`,
    );
  };
  if (options.wallClockDurationMs !== observed.durationMs)
    mismatch('durationMs', options.wallClockDurationMs, observed.durationMs);
  if (options.channels !== observed.channels)
    mismatch('channels', options.channels, observed.channels);
  if (options.sampleRateHz !== undefined && options.sampleRateHz !== observed.sampleRateHz)
    mismatch('sampleRateHz', options.sampleRateHz, observed.sampleRateHz);
  if (
    options.container !== undefined &&
    options.container.toLowerCase() !== observed.container?.toLowerCase()
  )
    mismatch('container', options.container, observed.container);
  if (options.codec !== undefined && options.codec.toLowerCase() !== observed.codec?.toLowerCase())
    mismatch('codec', options.codec, observed.codec);
}

async function readOptionalManifest(manifestPath: string): Promise<BenchmarkManifest | undefined> {
  try {
    return await readManifest(manifestPath);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const environment = loadBenchmarkEnvironment();
  const benchmarkRoot = getBenchmarkRoot(environment);
  const campaignId = required(args, 'campaign');
  const result = await addManifestCase({
    benchmarkRoot,
    campaignId,
    caseId: required(args, 'case'),
    sourcePath: required(args, 'file'),
    topology: (args.topology ?? 'mixed_recording') as BenchmarkCase['topology'],
    wallClockDurationMs: numberArg(args, 'wall-clock-duration-ms'),
    channels: numberArg(args, 'channels'),
    sampleRateHz: args['sample-rate-hz'] ? numberArg(args, 'sample-rate-hz') : undefined,
    container: args.container,
    codec: args.codec,
    manifestPath: args.manifest
      ? resolveUnderBenchmarkRoot(args.manifest, benchmarkRoot)
      : undefined,
  });
  console.log(
    JSON.stringify(
      {
        manifestPath: result.manifestPath,
        corpusHash: result.manifest.corpusHash,
        caseId: args.case,
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

function required(args: Record<string, string>, name: string): string {
  const value = args[name];
  if (!value) throw new Error(`Missing required --${name}`);
  return value;
}

function numberArg(args: Record<string, string>, name: string): number {
  const value = Number(required(args, name));
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`--${name} must be a non-negative number`);
  return value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
