import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadBenchmarkEnvironment } from './env';
import { getBenchmarkRoot, resolveUnderBenchmarkRoot, sha256File, writeJsonFile } from './manifest';
import { deriveComparableSegments } from './normalize';
import { getProviderAdapter } from './providers';
import type { BenchmarkRun } from './schema';

export type WebSocketReclassification = {
  schemaVersion: '1.0';
  derivationType: 'logical_stream_completion_reclassification';
  derivedAt: string;
  runId: string;
  providerId: 'inworld-stt-1';
  sourceRunSha256: string;
  sourceRawResponseSha256: string;
  originalStatus: BenchmarkRun['status'];
  supersedingStatus: 'success' | 'uncertain';
  interpretation: 'protocol_complete' | 'insufficient_evidence_for_reclassification';
  physicalAttempts: BenchmarkRun['attempts'];
  basis: {
    finalTranscriptionCount: number;
    usageObserved: boolean;
    logicalTerminalSignal: 'result.usage' | 'not_proven';
    protocolSequenceProven: boolean;
    reason?: string;
  };
  returnedModel?: string;
  providerMetadata?: Record<string, unknown>;
  providerUsage?: BenchmarkRun['providerUsage'];
  nativeSegmentsPath?: string;
  comparableSegmentsPath?: string;
  rawResponsePath: string;
};

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
  run.providerMetadata = parsed.providerMetadata;
  run.providerUsage = parsed.usage;
  run.nativeSegmentsPath = 'native-segments.json';
  run.comparableSegmentsPath = 'comparable-segments.json';
  await writeJsonFile(runRecordPath, run);
  return run;
}

export async function rederiveWebSocketRunArtifacts(options: {
  runPath: string;
  benchmarkRoot?: string;
}): Promise<WebSocketReclassification> {
  const benchmarkRoot = options.benchmarkRoot ?? getBenchmarkRoot(loadBenchmarkEnvironment());
  const runDirectory = resolveUnderBenchmarkRoot(options.runPath, benchmarkRoot);
  const runRecordPath = path.join(runDirectory, 'run.json');
  const run = JSON.parse(await readFile(runRecordPath, 'utf8')) as BenchmarkRun;
  if (run.providerId !== 'inworld-stt-1' || run.requestMode !== 'websocket') {
    throw new Error('WebSocket reclassification supports Inworld STT-1 runs only.');
  }
  if (run.status !== 'uncertain') {
    throw new Error(`Only uncertain Inworld runs can be reclassified: ${run.runId}`);
  }
  const attempt = run.attempts.find(
    (item) => item.phase === 'transcribe' && typeof item.responsePath === 'string',
  );
  if (!attempt?.responsePath) {
    throw new Error('Inworld reclassification requires saved raw WebSocket evidence.');
  }
  const rawResponsePath = resolveUnderBenchmarkRoot(
    path.join(options.runPath, attempt.responsePath),
    benchmarkRoot,
  );
  const savedEvidence = JSON.parse(await readFile(rawResponsePath, 'utf8')) as unknown;
  const chronology = extractStructuredChronology(savedEvidence, run.requestedModel);
  if (!chronology) {
    return writeInsufficientReclassification({
      run,
      runRecordPath,
      rawResponsePath,
      reason:
        'Structured client/server chronology proving closeStream before final and usage is absent.',
    });
  }
  let parsed;
  try {
    parsed = getProviderAdapter(run.providerId).parseResponse(chronology.logicalResultMessages);
  } catch {
    return writeInsufficientReclassification({
      run,
      runRecordPath,
      rawResponsePath,
      reason:
        'Saved logical result events cannot be parsed as a valid Inworld final transcription and usage sequence.',
      usageObserved: chronology.validUsageObserved,
    });
  }
  const counts = parsed.providerMetadata?.responseEventCounts;
  const finalTranscriptionCount =
    counts && typeof counts === 'object' && !Array.isArray(counts)
      ? (counts as Record<string, unknown>).finalTranscription
      : undefined;
  if (
    typeof finalTranscriptionCount !== 'number' ||
    finalTranscriptionCount < 1 ||
    parsed.usage?.rawUsage === undefined ||
    !chronology.protocolSequenceProven
  ) {
    return writeInsufficientReclassification({
      run,
      runRecordPath,
      rawResponsePath,
      reason:
        'Saved Inworld evidence does not prove closeStream, valid final transcription, then valid usage in that order.',
      finalTranscriptionCount:
        typeof finalTranscriptionCount === 'number' ? finalTranscriptionCount : 0,
      usageObserved: parsed.usage?.rawUsage !== undefined,
    });
  }

  const nativeSegmentsPath = 'rederived-native-segments.json';
  const comparableSegmentsPath = 'rederived-comparable-segments.json';
  await writeJsonFile(path.join(runDirectory, nativeSegmentsPath), {
    providerId: run.providerId,
    derivation: 'logical_stream_completion_reclassification',
    segments: parsed.nativeSegments,
  });
  await writeJsonFile(path.join(runDirectory, comparableSegmentsPath), {
    providerId: run.providerId,
    derivation: 'logical_stream_completion_reclassification',
    segments: deriveComparableSegments(parsed.nativeSegments, run.providerId),
  });

  const result: WebSocketReclassification = {
    schemaVersion: '1.0',
    derivationType: 'logical_stream_completion_reclassification',
    derivedAt: new Date().toISOString(),
    runId: run.runId,
    providerId: run.providerId,
    sourceRunSha256: await sha256File(runRecordPath),
    sourceRawResponseSha256: await sha256File(rawResponsePath),
    originalStatus: run.status,
    supersedingStatus: 'success',
    interpretation: 'protocol_complete',
    physicalAttempts: run.attempts,
    basis: {
      finalTranscriptionCount,
      usageObserved: true,
      logicalTerminalSignal: 'result.usage',
      protocolSequenceProven: true,
    },
    returnedModel: parsed.returnedModel,
    providerMetadata: parsed.providerMetadata,
    providerUsage: parsed.usage,
    nativeSegmentsPath,
    comparableSegmentsPath,
    rawResponsePath: attempt.responsePath,
  };
  await writeJsonFile(path.join(runDirectory, 'rederived-run.json'), result);
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runPath = required(args, 'run');
  const benchmarkRoot = getBenchmarkRoot(loadBenchmarkEnvironment());
  const sourceRun = JSON.parse(
    await readFile(
      resolveUnderBenchmarkRoot(path.join(runPath, 'run.json'), benchmarkRoot),
      'utf8',
    ),
  ) as BenchmarkRun;
  if (sourceRun.providerId === 'inworld-stt-1' && sourceRun.requestMode === 'websocket') {
    const result = await rederiveWebSocketRunArtifacts({ runPath, benchmarkRoot });
    console.log(
      JSON.stringify(
        {
          runId: result.runId,
          providerId: result.providerId,
          originalStatus: result.originalStatus,
          supersedingStatus: result.supersedingStatus,
          nativeSegmentsPath: result.nativeSegmentsPath,
          comparableSegmentsPath: result.comparableSegmentsPath,
          networkRequests: 0,
        },
        null,
        2,
      ),
    );
    return;
  }
  const run = await rederiveDirectRunArtifacts({ runPath, benchmarkRoot });
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

type StructuredChronology = {
  logicalResultMessages: string[];
  protocolSequenceProven: boolean;
  validUsageObserved: boolean;
};

function extractStructuredChronology(
  value: unknown,
  expectedModel?: string,
): StructuredChronology | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const events = record.events;
  const logicalResultMessages = Array.isArray(record.logicalResultMessages)
    ? record.logicalResultMessages
    : record.summary && typeof record.summary === 'object' && !Array.isArray(record.summary)
      ? (record.summary as Record<string, unknown>).logicalResultMessages
      : undefined;
  if (
    !Array.isArray(events) ||
    !Array.isArray(logicalResultMessages) ||
    !logicalResultMessages.every((item) => typeof item === 'string')
  ) {
    return undefined;
  }
  const normalizedEvents = events
    .filter((event): event is Record<string, unknown> => {
      if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
      const record = event as Record<string, unknown>;
      return (
        Number.isInteger(record.sequence) &&
        Number(record.sequence) >= 0 &&
        typeof record.kind === 'string' &&
        ['client', 'server', 'transport'].includes(String(record.direction))
      );
    })
    .sort((left, right) => Number(left.sequence) - Number(right.sequence));
  if (normalizedEvents.length !== events.length) return undefined;
  if (new Set(normalizedEvents.map((event) => event.sequence)).size !== normalizedEvents.length) {
    return undefined;
  }
  const serverMessages = normalizedEvents.filter(
    (event) => event.direction === 'server' && event.kind === 'server_message',
  );
  if (serverMessages.some((event) => typeof event.rawMessage !== 'string')) return undefined;
  const usageIndex = serverMessages.findIndex((event) =>
    isValidUsageMessage(event.rawMessage, expectedModel),
  );
  const finalIndex = serverMessages.findIndex((event) => isValidFinalMessage(event.rawMessage));
  const closeIndex = normalizedEvents.findIndex(
    (event) =>
      event.direction === 'client' &&
      event.kind === 'close_stream' &&
      event.rawMessage === JSON.stringify({ closeStream: {} }),
  );
  const finalEvent = finalIndex < 0 ? undefined : serverMessages[finalIndex];
  const usageEvent = usageIndex < 0 ? undefined : serverMessages[usageIndex];
  const finalEventIndex = finalEvent === undefined ? -1 : normalizedEvents.indexOf(finalEvent);
  const usageEventIndex = usageEvent === undefined ? -1 : normalizedEvents.indexOf(usageEvent);
  const expectedLogical =
    usageIndex < 0
      ? []
      : serverMessages.slice(0, usageIndex + 1).map((event) => event.rawMessage as string);
  const protocolSequenceProven =
    closeIndex >= 0 &&
    finalEventIndex >= 0 &&
    usageEventIndex >= 0 &&
    closeIndex < finalEventIndex &&
    finalEventIndex < usageEventIndex &&
    JSON.stringify(logicalResultMessages) === JSON.stringify(expectedLogical);
  return {
    logicalResultMessages,
    protocolSequenceProven,
    validUsageObserved: usageIndex >= 0,
  };
}

function isValidFinalMessage(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const result = parsed.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
    const transcription = (result as Record<string, unknown>).transcription;
    if (!transcription || typeof transcription !== 'object' || Array.isArray(transcription)) {
      return false;
    }
    const record = transcription as Record<string, unknown>;
    return (
      record.isFinal === true &&
      typeof record.transcript === 'string' &&
      Array.isArray(record.wordTimestamps)
    );
  } catch {
    return false;
  }
}

function isValidUsageMessage(value: unknown, expectedModel?: string): boolean {
  if (typeof value !== 'string') return false;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const result = parsed.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
    const usage = (result as Record<string, unknown>).usage;
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return false;
    const record = usage as Record<string, unknown>;
    return (
      typeof record.modelId === 'string' &&
      record.modelId.length > 0 &&
      (expectedModel === undefined || record.modelId === expectedModel) &&
      typeof record.transcribedAudioMs === 'number' &&
      Number.isFinite(record.transcribedAudioMs) &&
      record.transcribedAudioMs >= 0
    );
  } catch {
    return false;
  }
}

async function writeInsufficientReclassification(options: {
  run: BenchmarkRun;
  runRecordPath: string;
  rawResponsePath: string;
  reason: string;
  finalTranscriptionCount?: number;
  usageObserved?: boolean;
}): Promise<WebSocketReclassification> {
  const runDirectory = path.dirname(options.runRecordPath);
  await rm(path.join(runDirectory, 'rederived-native-segments.json'), { force: true });
  await rm(path.join(runDirectory, 'rederived-comparable-segments.json'), { force: true });
  const result: WebSocketReclassification = {
    schemaVersion: '1.0',
    derivationType: 'logical_stream_completion_reclassification',
    derivedAt: new Date().toISOString(),
    runId: options.run.runId,
    providerId: 'inworld-stt-1',
    sourceRunSha256: await sha256File(options.runRecordPath),
    sourceRawResponseSha256: await sha256File(options.rawResponsePath),
    originalStatus: options.run.status,
    supersedingStatus: 'uncertain',
    interpretation: 'insufficient_evidence_for_reclassification',
    physicalAttempts: options.run.attempts,
    basis: {
      finalTranscriptionCount: options.finalTranscriptionCount ?? 0,
      usageObserved: options.usageObserved ?? false,
      logicalTerminalSignal: 'not_proven',
      protocolSequenceProven: false,
      reason: options.reason,
    },
    rawResponsePath: path.relative(runDirectory, options.rawResponsePath).split(path.sep).join('/'),
  };
  await writeJsonFile(path.join(runDirectory, 'rederived-run.json'), result);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
