// packages/batch-backend/src/infrastructure/orchestrator-service.ts
// Orchestrator integration:
// - Wraps createPipeline from @esl-pipeline/orchestrator.
// - Configured via env (see config/env).
// - Keeps ESL pipeline wiring in one place so workers/controllers stay simple.
import { S3Client } from '@aws-sdk/client-s3';
import { fork } from 'node:child_process';
import path from 'node:path';

import {
  type ConfigProvider,
  type JobOptionsPayload,
  type ManifestStore,
  type PipelineLogEvent,
  type PipelineLogger,
  type RerunFlags,
  RemoteConfigProvider,
  S3ManifestStore,
  createPipeline,
  resolveConfigPaths,
  resolveJobOptions,
} from '@esl-pipeline/orchestrator';

import { loadConfig } from '../config/env.js';
import type { TtsStrategy } from '../domain/job-model.js';
import { Logger, logger as rootLogger } from './logger.js';
import { metrics } from './metrics.js';

// Lazily initialized, module-local cache.
// Populated only inside getPipeline(), never at import time.
let cachedPipeline: ReturnType<typeof createPipeline> | null = null;

export interface StudentProfile {
  student: string;
  dbId?: string | null;
  pageParentId?: string | null;
  colorPreset?: string | null;
  voices?: Record<string, string>;
  manifestPreset?: string | null;
  accentPreference?: string | null;
  profileId?: string | null;
}

export function resetPipelineCache() {
  cachedPipeline = null;
}

// getPipeline.declaration()
export function getPipeline(configOverride?: ReturnType<typeof loadConfig>) {
  if (cachedPipeline) {
    return cachedPipeline;
  }

  const config = configOverride ?? loadConfig();

  const orchestratorLogger: PipelineLogger = {
    log(event: PipelineLogEvent) {
      const level = (event && event.level) || 'info';
      const msg = (event as { msg?: string }).msg || event.message || 'orchestrator';
      const data = { ...(event as unknown as Record<string, unknown>) };
      delete data.level;
      delete data.message;
      delete data.msg;

      const logFn =
        level in rootLogger && typeof rootLogger[level as keyof Logger] === 'function'
          ? (rootLogger[level as keyof Logger] as (msg: string, data: unknown) => void)
          : rootLogger.info;

      logFn.call(rootLogger, msg, data);
    },
  };

  const orchestratorMetrics = {
    increment: metrics.increment.bind(metrics),
    timing: metrics.timing.bind(metrics),
  };

  let manifestStore: ManifestStore | undefined;
  if (config.orchestrator.manifestStore === 's3') {
    const manifestRegion = process.env.AWS_REGION || process.env.S3_REGION || 'us-east-1';

    const manifestEndpoint = process.env.S3_ENDPOINT;

    let manifestCredentials: { accessKeyId: string; secretAccessKey: string } | undefined;
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      manifestCredentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      };
    } else if (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) {
      manifestCredentials = {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      };
    }

    const s3Client = new S3Client({
      region: manifestRegion,
      endpoint: manifestEndpoint,
      forcePathStyle: manifestEndpoint ? true : undefined,
      credentials: manifestCredentials,
    });

    manifestStore = new S3ManifestStore({
      bucket: config.orchestrator.manifestBucket!,
      prefix: config.orchestrator.manifestPrefix,
      rootDir: config.orchestrator.manifestRoot,
      client: s3Client,
    });
  }

  let configProvider: ConfigProvider | undefined;
  if (config.orchestrator.configProvider === 'http') {
    configProvider = new RemoteConfigProvider({
      baseUrl: config.orchestrator.configEndpoint!,
      token: config.orchestrator.configToken,
    });
  }

  const configPaths = resolveConfigPaths({
    configDir: config.orchestrator.configDir,
    cwd: process.env.PIPELINE_CWD || process.cwd(),
  });

  cachedPipeline = createPipeline({
    cwd: process.env.PIPELINE_CWD || process.cwd(),
    logger: orchestratorLogger,
    metrics: orchestratorMetrics,
    manifestStore,
    configProvider,
    presetsPath: configPaths.presetsPath,
    voicesPath: configPaths.voicesPath,
    studentsDir: configPaths.studentsDir,
  });

  return cachedPipeline;
}

export interface RunAssignmentPayload {
  jobId: string;
  md: string;
  preset?: string;
  withTts?: boolean;
  // Upload backend flag is constrained by orchestrator API:
  // currently only 's3' is supported as an explicit option.
  upload?: 's3';
  forceTts?: boolean | null;
  notionDatabase?: string | null;
  publishTarget?: 'notion' | 'anytype' | 'html';
  ttsStrategy?: TtsStrategy | null;
  settings?: RunJobSettings;
}

interface RunJobSettings {
  elevenLabsApiKey?: string | null;
  notionToken?: string | null;
}

export interface RunRerunAssignmentPayload {
  jobId: string;
  md: string;
  steps?: NonNullable<RerunFlags['steps']>;
  upload?: 's3';
  force?: boolean;
  prefix?: string;
  publicRead?: boolean;
  presign?: number;
  accentPreference?: string | null;
  voiceId?: string | null;
  ttsStrategy?: TtsStrategy | null;
  dialogueLanguage?: string | null;
  dialogueStability?: number | null;
  dialogueSeed?: number | null;
  settings?: RunJobSettings;
}

type WorkerExecutionMode = 'new_assignment' | 'rerun_assignment';

interface WorkerRunMessagePayload {
  type: 'run';
  executionMode: WorkerExecutionMode;
  payload: RunAssignmentPayload | RunRerunAssignmentPayload;
  runId: string;
}

interface WorkerAbortMessagePayload {
  type: 'abort';
  reason?: string;
}

type WorkerMessagePayload = WorkerRunMessagePayload | WorkerAbortMessagePayload;

interface RunPipelineOptions {
  signal?: AbortSignal;
}

function makeCancellationError(reason?: string): Error {
  const message = reason && reason.trim().length > 0 ? `cancelled: ${reason.trim()}` : 'cancelled';
  const error = new Error(message);
  error.name = 'PipelineCancelledError';
  return error;
}

// runAssignmentJob.declaration()
export async function runAssignmentJob(
  payload: RunAssignmentPayload,
  runId: string,
  options: RunPipelineOptions = {},
): Promise<{ manifestPath?: string; notionUrl?: string; anytypeUrl?: string; htmlUrl?: string }> {
  return runPipelineWorker('new_assignment', payload, runId, options);
}

export async function runRerunAssignmentJob(
  payload: RunRerunAssignmentPayload,
  runId: string,
  options: RunPipelineOptions = {},
): Promise<{ manifestPath?: string; notionUrl?: string; anytypeUrl?: string; htmlUrl?: string }> {
  return runPipelineWorker('rerun_assignment', payload, runId, options);
}

async function runPipelineWorker(
  executionMode: WorkerExecutionMode,
  payload: RunAssignmentPayload | RunRerunAssignmentPayload,
  runId: string,
  options: RunPipelineOptions = {},
): Promise<{ manifestPath?: string; notionUrl?: string; anytypeUrl?: string; htmlUrl?: string }> {
  const log = rootLogger.child({ jobId: payload.jobId, runId });
  const { signal } = options;
  if (signal?.aborted) {
    throw makeCancellationError(
      typeof signal.reason === 'string' ? signal.reason : undefined,
    );
  }

  return new Promise((resolve, reject) => {
    const workerPath = path.join(import.meta.dirname, 'pipeline-worker-entry');
    const child = fork(workerPath);

    let resolved = false;
    let abortFallbackTimer: NodeJS.Timeout | null = null;

    const clearAbortFallbackTimer = () => {
      if (!abortFallbackTimer) return;
      clearTimeout(abortFallbackTimer);
      abortFallbackTimer = null;
    };

    const abortReasonFromSignal = (): string | undefined => {
      if (!signal) return undefined;
      if (typeof signal.reason === 'string') return signal.reason;
      if (signal.reason instanceof Error) return signal.reason.message;
      return undefined;
    };

    const abortHandler = () => {
      if (resolved) return;
      const reason = abortReasonFromSignal();
      resolved = true;
      clearAbortFallbackTimer();
      const cancellationError = makeCancellationError(reason);
      reject(cancellationError);

      try {
        const abortMessage: WorkerAbortMessagePayload = {
          type: 'abort',
          reason,
        };
        child.send(abortMessage);
      } catch {
        // Ignore send failures and rely on process termination below.
      }

      abortFallbackTimer = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {
          // Ignore kill failures during best-effort cancellation cleanup.
        }
      }, 1000);
    };

    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    const finalize = () => {
      clearAbortFallbackTimer();
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
    };

    child.on('message', (msg: unknown) => {
      // Type guard for worker message
      if (typeof msg !== 'object' || msg === null) return;

      const message = msg as {
        type?: string;
        result?: unknown;
        error?: { message?: string; stack?: string; name?: string };
      };

      if (message.type === 'success') {
        if (resolved) return;
        resolved = true;
        finalize();
        resolve(
          message.result as { manifestPath?: string; notionUrl?: string; anytypeUrl?: string; htmlUrl?: string },
        );
      } else if (message.type === 'error') {
        if (resolved) return;
        resolved = true;
        finalize();
        const err = new Error(message.error?.message || String(message.error));
        if (message.error?.stack) {
          err.stack = message.error.stack;
        }
        if (message.error?.name) {
          err.name = message.error.name;
        }
        reject(err);
      }
    });

    child.on('error', (err) => {
      log.error(err, { message: 'Pipeline worker process error' });
      if (!resolved) {
        resolved = true;
        finalize();
        reject(err);
      }
    });

    child.on('exit', (code) => {
      finalize();
      if (code !== 0 && !resolved) {
        const err = new Error(`Pipeline worker exited with code ${code}`);
        log.error(err, { message: 'Pipeline worker exited abnormally' });
        reject(err);
      }
    });

    const message: WorkerMessagePayload = {
      type: 'run',
      executionMode,
      payload,
      runId,
    };
    child.send(message);
  });
}

export async function getJobOptionsFromOrchestrator(): Promise<JobOptionsPayload> {
  const pipeline = getPipeline();
  return resolveJobOptions(pipeline);
}

export async function getStudentProfilesFromOrchestrator(): Promise<StudentProfile[]> {
  const pipeline = getPipeline();
  return pipeline.configProvider.loadStudentProfiles(pipeline.configPaths.studentsDir);
}

export function isManifestBucketMissingError(error: unknown): boolean {
  if (!error) return false;
  if (
    error instanceof Error &&
    (error.name === 'NoSuchBucket' || error.name === 'PermanentRedirect')
  ) {
    return true;
  }
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? (error as { message: unknown }).message
      : undefined;
  if (typeof message === 'string' && message.toLowerCase().includes('no such bucket')) {
    return true;
  }
  return false;
}
