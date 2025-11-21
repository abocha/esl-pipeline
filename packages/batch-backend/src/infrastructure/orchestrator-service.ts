// packages/batch-backend/src/infrastructure/orchestrator-service.ts

// Orchestrator integration:
// - Wraps createPipeline from @esl-pipeline/orchestrator.
// - Configured via env (see config/env).
// - Keeps ESL pipeline wiring in one place so workers/controllers stay simple.

import { fork } from 'node:child_process';
import path from 'node:path';
import {
  createPipeline,
  S3ManifestStore,
  RemoteConfigProvider,
  resolveJobOptions,
  resolveConfigPaths,
  type JobOptionsPayload,
} from '@esl-pipeline/orchestrator';
import { S3Client } from '@aws-sdk/client-s3';
import { loadConfig } from '../config/env.js';
import { logger as rootLogger, Logger } from './logger.js';
import { metrics } from './metrics.js';
import type { JobMode } from '../domain/job-model.js';

// Lazily initialized, module-local cache.
// Populated only inside getPipeline(), never at import time.
let cachedPipeline: ReturnType<typeof createPipeline> | null = null;

export function resetPipelineCache() {
  cachedPipeline = null;
}

// getPipeline.declaration()
export function getPipeline(configOverride?: ReturnType<typeof loadConfig>) {
  if (cachedPipeline) {
    return cachedPipeline;
  }

  const config = configOverride ?? loadConfig();

  // Adapt orchestrator's logger contract into our Logger.
  const orchestratorLogger = {
    log(event: any) {
      const level = (event && event.level) || 'info';
      const msg = event.message || event.msg || 'orchestrator';
      const data = { ...event };
      delete (data as any).level;
      delete (data as any).message;
      delete (data as any).msg;

      const logFn =
        (rootLogger as any)[level] && typeof (rootLogger as any)[level] === 'function'
          ? (rootLogger as any)[level].bind(rootLogger)
          : (rootLogger as Logger).info.bind(rootLogger);

      logFn(msg, data);
    },
  };

  const orchestratorMetrics = {
    increment: metrics.increment.bind(metrics),
    timing: metrics.timing.bind(metrics),
  };

  let manifestStore: any | undefined;
  if (config.orchestrator.manifestStore === 's3') {
    const manifestRegion =
      process.env.AWS_REGION || process.env.S3_REGION || process.env.MINIO_REGION || 'us-east-1';

    const manifestEndpoint =
      process.env.S3_ENDPOINT ||
      (config.minio.enabled
        ? `${config.minio.useSSL ? 'https' : 'http'}://${config.minio.endpoint}:${config.minio.port}`
        : undefined);

    const preferMinioCreds = Boolean(manifestEndpoint) || config.minio.enabled;
    let manifestCredentials: { accessKeyId: string; secretAccessKey: string } | undefined;
    if (preferMinioCreds) {
      manifestCredentials = {
        accessKeyId: config.minio.accessKey,
        secretAccessKey: config.minio.secretKey,
      };
    } else if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      manifestCredentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
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

  let configProvider: any | undefined;
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
  mode?: JobMode | null;
}

// runAssignmentJob.declaration()
export async function runAssignmentJob(
  payload: RunAssignmentPayload,
  runId: string
): Promise<{ manifestPath?: string; notionUrl?: string }> {
  const log = rootLogger.child({ jobId: payload.jobId, runId });

  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'pipeline-worker-entry');
    const child = fork(workerPath);

    let resolved = false;

    child.on('message', (msg: any) => {
      if (msg.type === 'success') {
        resolved = true;
        resolve(msg.result);
      } else if (msg.type === 'error') {
        resolved = true;
        const err = new Error(msg.error.message || String(msg.error));
        if (msg.error.stack) {
          err.stack = msg.error.stack;
        }
        if (msg.error.name) {
          err.name = msg.error.name;
        }
        reject(err);
      }
    });

    child.on('error', (err) => {
      log.error(err, { message: 'Pipeline worker process error' });
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    child.on('exit', (code) => {
      if (code !== 0 && !resolved) {
        const err = new Error(`Pipeline worker exited with code ${code}`);
        log.error(err, { message: 'Pipeline worker exited abnormally' });
        reject(err);
      }
    });

    child.send({ payload, runId });
  });
}

export async function getJobOptionsFromOrchestrator(): Promise<JobOptionsPayload> {
  const pipeline = getPipeline();
  return resolveJobOptions(pipeline);
}

export function isManifestBucketMissingError(error: unknown): boolean {
  if (!error) return false;
  if (
    error instanceof Error &&
    (error.name === 'NoSuchBucket' || error.name === 'PermanentRedirect')
  ) {
    return true;
  }
  const message = typeof error === 'object' && 'message' in error ? (error as any).message : undefined;
  if (typeof message === 'string' && message.toLowerCase().includes('no such bucket')) {
    return true;
  }
  return false;
}
