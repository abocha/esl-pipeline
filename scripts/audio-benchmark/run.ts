import { randomUUID } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadBenchmarkEnvironment } from './env';
import type { FetchLike } from './http';
import { BenchmarkHttpError, executeHttpRequest } from './http';
import {
  canonicalJson,
  findCase,
  getBenchmarkRoot,
  readManifest,
  resolveCaseInput,
  resolveUnderBenchmarkRoot,
  sha256File,
  sha256Text,
  writeJsonFile,
} from './manifest';
import { probeMedia } from './media';
import { deriveComparableSegments } from './normalize';
import { getProviderAdapter } from './providers';
import type {
  ProviderInput,
  ProviderRequest,
  ProviderRequestClient,
  RequestIntent,
} from './providers/types';
import { ProviderExecutionError } from './providers/types';
import type {
  AttemptPhase,
  AttemptRecord,
  BenchmarkManifest,
  BenchmarkRun,
  BenchmarkRunMode,
  ExternalReference,
  OutputPaths,
  ProviderId,
} from './schema';
import { BENCHMARK_SCHEMA_VERSION, benchmarkRunModes, providerIds } from './schema';

export type DryRunPlan = {
  networkRequests: 0;
  providerId: ProviderId;
  runMode: BenchmarkRunMode;
  credentialEnv: string;
  credentialConfigured: boolean;
  input: {
    relativePath: string;
    absolutePath: string;
    sha256: string;
    bytes: number;
    durationMs: number;
    channels: number;
    sourceSha256: string;
    sourceDurationMs: number;
    sourceChannels: number;
    preparedSha256?: string;
    inputArtifact: 'prepared_artifact' | 'original_source';
    originalSourceDirect: 'not_tested';
  };
  outputPaths: OutputPaths;
  requestIntent: RequestIntent;
};

export function buildDryRunPlan(options: {
  manifest: BenchmarkManifest;
  caseId: string;
  providerId: ProviderId;
  runMode: BenchmarkRunMode;
  benchmarkRoot: string;
  environment?: NodeJS.ProcessEnv;
}): DryRunPlan {
  const adapter = getProviderAdapter(options.providerId);
  assertRunMode(options.providerId, options.runMode);
  const input = resolveCaseInput(
    options.manifest,
    options.caseId,
    options.runMode,
    options.benchmarkRoot,
  );
  assertTrustedSplitTopology(input, options.runMode);
  const benchmarkCase = findCase(options.manifest, options.caseId);
  const providerInput = providerInputFromCase(
    options.manifest,
    benchmarkCase,
    input,
    options.providerId,
    options.environment,
    { runId: '<run-id>', selectedInputSha256: input.sha256 },
  );
  const runDirectory = resolveUnderBenchmarkRoot(
    path.join('runs', options.manifest.campaignId, '<run-id>'),
    options.benchmarkRoot,
  );
  const outputPaths = outputPathsFor(runDirectory);
  return {
    networkRequests: 0,
    providerId: options.providerId,
    runMode: options.runMode,
    credentialEnv: adapter.credentialEnv,
    credentialConfigured: Boolean((options.environment ?? process.env)[adapter.credentialEnv]),
    input,
    outputPaths,
    requestIntent: adapter.buildIntent(providerInput),
  };
}

export async function runBenchmark(options: {
  manifestPath: string;
  caseId: string;
  providerId: ProviderId;
  runMode: BenchmarkRunMode;
  benchmarkRoot?: string;
  environment?: NodeJS.ProcessEnv;
  runId?: string;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  providerOptions?: Record<string, unknown>;
  fetchImpl?: FetchLike;
}): Promise<BenchmarkRun> {
  const benchmarkRoot = options.benchmarkRoot ?? getBenchmarkRoot(options.environment);
  const manifestPath = resolveUnderBenchmarkRoot(options.manifestPath, benchmarkRoot);
  const manifest = await readManifest(manifestPath);
  const adapter = getProviderAdapter(options.providerId);
  assertRunMode(options.providerId, options.runMode);
  const benchmarkCase = findCase(manifest, options.caseId);
  const input = resolveCaseInput(manifest, options.caseId, options.runMode, benchmarkRoot);
  await assertSelectedMedia(input, options.runMode);
  const actualInputHash = await sha256File(input.absolutePath);
  if (actualInputHash !== input.sha256) {
    throw new Error(
      `Input SHA-256 does not match the manifest for ${options.caseId}; refusing to send.`,
    );
  }
  const runId =
    options.runId ??
    `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`;
  const runDirectory = resolveUnderBenchmarkRoot(
    path.join('runs', manifest.campaignId, runId),
    benchmarkRoot,
  );
  const outputPaths = outputPathsFor(runDirectory);
  try {
    await stat(outputPaths.runRecord);
    throw new Error(`Run already exists; refusing to overwrite it: ${runId}`);
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  await mkdir(outputPaths.rawDirectory, { recursive: true });
  const startedAt = new Date().toISOString();
  const run: BenchmarkRun = {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    runId,
    campaignId: manifest.campaignId,
    caseId: options.caseId,
    providerId: options.providerId,
    requestedModel: adapter.model,
    requestMode: adapter.requestMode,
    runMode: options.runMode,
    sourceSha256: input.sourceSha256,
    preparedSha256: input.preparedSha256,
    sourceWallClockDurationMs: input.sourceDurationMs,
    sourceChannels: input.sourceChannels,
    sourceContainer: benchmarkCase.source.container,
    sourceCodec: benchmarkCase.source.codec,
    preparedArtifactDurationMs: benchmarkCase.prepared?.durationMs,
    preparedArtifactChannels: benchmarkCase.prepared?.channels,
    preparedArtifactSampleRateHz: benchmarkCase.prepared?.sampleRateHz,
    mediaIngest: {
      inputArtifact: input.inputArtifact,
      originalSourceDirect: 'not_tested',
    },
    startedAt,
    attempts: [],
    externalReferences: [],
    status: 'failed',
  };
  await writeJsonFile(outputPaths.runRecord, run);
  const ledger = new AttemptLedger(run, outputPaths);
  const providerInput = providerInputFromCase(
    manifest,
    benchmarkCase,
    input,
    options.providerId,
    options.environment,
    {
      pollIntervalMs: options.pollIntervalMs,
      maxWaitMs: options.maxWaitMs,
      providerOptions: options.providerOptions,
      runId,
      selectedInputSha256: input.sha256,
      recordExternalReference: async (reference) => {
        if (
          !run.externalReferences?.some(
            (item) => item.kind === reference.kind && item.id === reference.id,
          )
        ) {
          run.externalReferences?.push(reference);
          await writeJsonFile(outputPaths.runRecord, run);
        }
      },
    },
  );
  const request: ProviderRequestClient = (phase, providerRequest) =>
    ledger.request(phase, providerRequest, options.environment, options.fetchImpl);

  try {
    const result = await adapter.execute(providerInput, request);
    const nativePath = path
      .relative(runDirectory, outputPaths.nativeSegments)
      .split(path.sep)
      .join('/');
    const comparablePath = path
      .relative(runDirectory, outputPaths.comparableSegments)
      .split(path.sep)
      .join('/');
    await writeJsonFile(outputPaths.nativeSegments, {
      providerId: options.providerId,
      segments: result.nativeSegments,
    });
    await writeJsonFile(outputPaths.comparableSegments, {
      providerId: options.providerId,
      segments: deriveComparableSegments(result.nativeSegments, options.providerId),
    });
    run.returnedModel = result.returnedModel;
    run.providerMetadata = result.providerMetadata;
    run.providerUsage = result.usage;
    run.rawResponsePaths = result.rawResponsePaths;
    run.nativeSegmentsPath = nativePath;
    run.comparableSegmentsPath = comparablePath;
    if (run.mediaIngest.inputArtifact === 'original_source') {
      run.mediaIngest.originalSourceDirect = 'accepted';
    }
    run.status = 'success';
  } catch (error: unknown) {
    const classified = classifyError(error);
    const providerSideWork = hasRiskBearingProviderWork(run);
    const effectiveClassification =
      classified.outcome === 'failed' && classified.category === 'harness_error' && providerSideWork
        ? {
            outcome: 'uncertain' as const,
            category: 'post_request_persistence_uncertain',
            message: `Provider-side work may have occurred, but local benchmark evidence persistence failed: ${classified.message}`,
          }
        : classified;
    if (effectiveClassification.category === 'post_request_persistence_uncertain') {
      markLatestRiskBearingAttemptUncertain(run, effectiveClassification.message);
    }
    run.status = effectiveClassification.outcome;
    run.errorCategory = effectiveClassification.category;
    run.errorMessage = effectiveClassification.message;
    if (
      run.mediaIngest.inputArtifact === 'original_source' &&
      classified.category.startsWith('http_')
    ) {
      run.mediaIngest.originalSourceDirect = 'rejected';
    }
  }
  run.finishedAt = new Date().toISOString();
  run.elapsedMs = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  await writeJsonFile(outputPaths.runRecord, run);
  if (run.status !== 'success')
    throw new Error(`${run.status}: ${run.errorCategory}: ${run.errorMessage}`);
  return run;
}

class AttemptLedger {
  constructor(
    private readonly run: BenchmarkRun,
    private readonly outputPaths: OutputPaths,
  ) {}

  async request(
    phase: AttemptPhase,
    request: ProviderRequest,
    environment: NodeJS.ProcessEnv = process.env,
    fetchImpl?: FetchLike,
  ): Promise<{ status: number; body: string; responsePath: string }> {
    const attemptId = `${String(this.run.attempts.length + 1).padStart(3, '0')}-${phase}`;
    const startedAt = new Date().toISOString();
    const attempt: AttemptRecord = {
      attemptId,
      phase,
      startedAt,
      method: request.method,
      endpoint: request.url,
      requestRisk: request.requestRisk ?? 'none',
      requestFingerprint: sha256Text(
        canonicalJson({
          ...request,
          body: request.body ? redactBodyForFingerprint(request.body) : undefined,
        }),
      ),
      outcome: 'started',
    };
    this.run.attempts.push(attempt);
    this.run.status = 'uncertain';
    await writeJsonFile(this.outputPaths.runRecord, this.run);
    let providerSideWork = false;
    try {
      const response = await executeHttpRequest(request, environment, fetchImpl);
      providerSideWork =
        request.requestRisk !== undefined &&
        request.requestRisk !== 'none' &&
        ((response.status >= 200 && response.status < 300) || response.status >= 500);
      const responsePath = path.join(this.outputPaths.rawDirectory, `${attemptId}.response`);
      await writeFile(responsePath, response.body, 'utf8');
      attempt.responsePath = path
        .relative(path.dirname(this.outputPaths.runRecord), responsePath)
        .split(path.sep)
        .join('/');
      attempt.httpStatus = response.status;
      attempt.outcome =
        response.status >= 200 && response.status < 300
          ? 'succeeded'
          : response.status >= 500 && request.requestRisk && request.requestRisk !== 'none'
            ? 'uncertain'
            : 'failed';
      finishAttempt(attempt, startedAt);
      if (attempt.outcome !== 'succeeded') {
        attempt.errorCategory =
          attempt.outcome === 'uncertain' ? 'http_response_uncertain' : `http_${response.status}`;
        attempt.errorMessage = `Provider returned HTTP ${response.status} for ${request.url}.`;
      }
      await writeJsonFile(this.outputPaths.runRecord, this.run);
      if (attempt.outcome !== 'succeeded') {
        throw new BenchmarkHttpError(
          `Provider returned HTTP ${response.status} for ${request.url}.`,
          attempt.outcome,
          attempt.errorCategory!,
        );
      }
      return { ...response, responsePath: attempt.responsePath };
    } catch (error: unknown) {
      const effectiveError =
        providerSideWork && isHarnessError(error)
          ? new BenchmarkHttpError(
              `Provider-side work may have occurred, but local benchmark evidence persistence failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
              'uncertain',
              'post_request_persistence_uncertain',
            )
          : error;
      if (attempt.outcome === 'started' || providerSideWork) {
        const classified = classifyError(effectiveError);
        attempt.outcome = classified.outcome;
        attempt.errorCategory = classified.category;
        attempt.errorMessage = classified.message;
        if (!attempt.finishedAt) finishAttempt(attempt, startedAt);
        try {
          await writeJsonFile(this.outputPaths.runRecord, this.run);
        } catch (persistenceError: unknown) {
          if (!providerSideWork) throw persistenceError;
        }
      }
      throw effectiveError;
    }
  }
}

function providerInputFromCase(
  manifest: BenchmarkManifest,
  benchmarkCase: ReturnType<typeof findCase>,
  input: ReturnType<typeof resolveCaseInput>,
  providerId: ProviderId,
  environment?: NodeJS.ProcessEnv,
  options: ProviderInputOptions = {},
): ProviderInput {
  const {
    runId,
    selectedInputSha256,
    recordExternalReference,
    providerOptions,
    ...requestOptions
  } = options;
  return {
    providerId,
    runMode: input.runMode,
    inputPath: input.absolutePath,
    fileName: path.basename(input.relativePath),
    sourceChannels: input.sourceChannels,
    preparedChannels: benchmarkCase.prepared?.channels ?? 1,
    sourceDurationMs: input.sourceDurationMs,
    preparedDurationMs: benchmarkCase.prepared?.durationMs ?? 0,
    options: {
      campaignId: manifest.campaignId,
      caseId: benchmarkCase.caseId,
      ...requestOptions,
      ...providerOptions,
    },
    environment,
    runId: typeof runId === 'string' ? runId : undefined,
    selectedInputSha256: typeof selectedInputSha256 === 'string' ? selectedInputSha256 : undefined,
    recordExternalReference,
  };
}

type ProviderInputOptions = Record<string, unknown> & {
  runId?: string;
  selectedInputSha256?: string;
  recordExternalReference?: (reference: ExternalReference) => Promise<void>;
  providerOptions?: Record<string, unknown>;
};

function outputPathsFor(runDirectory: string): OutputPaths {
  return {
    runDirectory,
    runRecord: path.join(runDirectory, 'run.json'),
    rawDirectory: path.join(runDirectory, 'raw'),
    nativeSegments: path.join(runDirectory, 'native-segments.json'),
    comparableSegments: path.join(runDirectory, 'comparable-segments.json'),
  };
}

function redactBodyForFingerprint(body: NonNullable<ProviderRequest['body']>): unknown {
  if (body.kind === 'json') return body;
  if (body.kind === 'multipart') return { ...body, filePath: '<file>' };
  return { ...body, filePath: '<file>' };
}

function finishAttempt(attempt: AttemptRecord, startedAt: string): void {
  attempt.finishedAt = new Date().toISOString();
  attempt.elapsedMs = Date.parse(attempt.finishedAt) - Date.parse(startedAt);
}

function classifyError(error: unknown): {
  outcome: 'failed' | 'uncertain';
  category: string;
  message: string;
} {
  if (error instanceof ProviderExecutionError || error instanceof BenchmarkHttpError) {
    return { outcome: error.outcome, category: error.category, message: error.message };
  }
  return {
    outcome: 'failed',
    category: 'harness_error',
    message: error instanceof Error ? error.message : String(error),
  };
}

function isHarnessError(error: unknown): boolean {
  return !(error instanceof ProviderExecutionError || error instanceof BenchmarkHttpError);
}

function hasRiskBearingProviderWork(run: BenchmarkRun): boolean {
  return run.attempts.some(
    (attempt) =>
      attempt.requestRisk !== undefined &&
      attempt.requestRisk !== 'none' &&
      (attempt.outcome === 'succeeded' || attempt.outcome === 'uncertain'),
  );
}

function markLatestRiskBearingAttemptUncertain(run: BenchmarkRun, message: string): void {
  const attempt = [...run.attempts]
    .reverse()
    .find(
      (candidate) =>
        candidate.requestRisk !== undefined &&
        candidate.requestRisk !== 'none' &&
        candidate.outcome === 'succeeded',
    );
  if (!attempt) return;
  attempt.outcome = 'uncertain';
  attempt.errorCategory = 'post_request_persistence_uncertain';
  attempt.errorMessage = message;
}

function assertRunMode(providerId: ProviderId, runMode: BenchmarkRunMode): void {
  if (runMode === 'trusted_split_control' && providerId !== 'deepgram-nova-3') {
    throw new Error('trusted_split_control is only available for deepgram-nova-3.');
  }
}

function assertTrustedSplitTopology(
  input: ReturnType<typeof resolveCaseInput>,
  runMode: BenchmarkRunMode,
): void {
  if (runMode === 'trusted_split_control' && input.channels !== 2) {
    throw new Error('trusted_split_control requires the selected source artifact to be stereo.');
  }
}

async function assertSelectedMedia(
  input: ReturnType<typeof resolveCaseInput>,
  runMode: BenchmarkRunMode,
): Promise<void> {
  assertTrustedSplitTopology(input, runMode);
  if (runMode !== 'trusted_split_control') return;
  const observed = await probeMedia(input.absolutePath);
  if (observed.channels !== 2) {
    throw new Error(
      `trusted_split_control requires exactly two observed source channels; ffprobe found ${observed.channels}.`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const environment = loadBenchmarkEnvironment();
  const benchmarkRoot = getBenchmarkRoot(environment);
  const manifestArgument = required(args.values, 'manifest');
  const manifestPath = resolveUnderBenchmarkRoot(manifestArgument, benchmarkRoot);
  const providerId = asProviderId(required(args.values, 'provider'));
  const runMode = asRunMode(args.values.mode ?? 'mixed_diarized');
  const manifest = await readManifest(manifestPath);
  if (args.flags.has('dry-run')) {
    const dryRunInput = resolveCaseInput(
      manifest,
      required(args.values, 'case'),
      runMode,
      benchmarkRoot,
    );
    await assertSelectedMedia(dryRunInput, runMode);
    const plan = buildDryRunPlan({
      manifest,
      caseId: required(args.values, 'case'),
      providerId,
      runMode,
      benchmarkRoot,
      environment,
    });
    const actualInputHash = await sha256File(plan.input.absolutePath);
    if (actualInputHash !== plan.input.sha256) {
      throw new Error(
        `Input SHA-256 does not match the manifest for ${plan.input.relativePath}; refusing dry-run.`,
      );
    }
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  const run = await runBenchmark({
    manifestPath,
    caseId: required(args.values, 'case'),
    providerId,
    runMode,
    benchmarkRoot,
    environment,
    runId: args.values['run-id'],
    pollIntervalMs: args.values['poll-interval-ms']
      ? Number(args.values['poll-interval-ms'])
      : undefined,
    maxWaitMs: args.values['max-wait-ms'] ? Number(args.values['max-wait-ms']) : undefined,
  });
  console.log(
    JSON.stringify(
      {
        runId: run.runId,
        status: run.status,
        runDirectory: path.dirname(
          resolveUnderBenchmarkRoot(
            path.join('runs', run.campaignId, run.runId, 'run.json'),
            benchmarkRoot,
          ),
        ),
      },
      null,
      2,
    ),
  );
}

function parseArgs(argv: string[]): { values: Record<string, string>; flags: Set<string> } {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith('--')) continue;
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      flags.add(key);
      continue;
    }
    values[key] = value;
    index += 1;
  }
  return { values, flags };
}

function required(values: Record<string, string>, name: string): string {
  const value = values[name];
  if (!value) throw new Error(`Missing required --${name}`);
  return value;
}

function asProviderId(value: string): ProviderId {
  if (!providerIds.includes(value as ProviderId))
    throw new Error(`Unsupported benchmark provider: ${value}`);
  return value as ProviderId;
}

function asRunMode(value: string): BenchmarkRunMode {
  if (!benchmarkRunModes.includes(value as BenchmarkRunMode)) {
    throw new Error(`Unsupported benchmark run mode: ${value}`);
  }
  return value as BenchmarkRunMode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
