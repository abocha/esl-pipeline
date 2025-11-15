// packages/batch-backend/src/infrastructure/orchestrator-service.ts

// Orchestrator integration:
// - Wraps createPipeline from @esl-pipeline/orchestrator.
// - Configured via env (see config/env).
// - Keeps ESL pipeline wiring in one place so workers/controllers stay simple.

import {
  createPipeline,
  S3ManifestStore,
  RemoteConfigProvider,
  type NewAssignmentFlags,
  type OrchestratorDependencies,
} from '@esl-pipeline/orchestrator';
import { S3Client } from '@aws-sdk/client-s3';
import { loadConfig, type BatchBackendConfig } from '../config/env';
import { logger as rootLogger, Logger } from './logger';
import { metrics } from './metrics';
import type { JobMode } from '../domain/job-model';

// Lazily initialized, module-local cache.
// Populated only inside getPipeline(), never at import time.
let cachedPipeline: ReturnType<typeof createPipeline> | null = null;

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

  cachedPipeline = createPipeline({
    cwd: process.env.PIPELINE_CWD || process.cwd(),
    logger: orchestratorLogger,
    metrics: orchestratorMetrics,
    manifestStore,
    configProvider,
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
  const config = loadConfig();
  const log = rootLogger.child({ jobId: payload.jobId, runId });

  const execute = async (activeConfig: BatchBackendConfig) => {
    const pipeline = getPipeline(activeConfig);
    const flags: NewAssignmentFlags = {
      md: payload.md,
      preset: payload.preset,
      withTts: payload.withTts,
      upload: payload.upload,
    };

    if (payload.notionDatabase) {
      flags.dbId = payload.notionDatabase;
    }

    if (payload.forceTts) {
      flags.redoTts = payload.forceTts;
    }

    if (payload.mode) {
      flags.ttsMode = payload.mode;
    }

    const dependencies: OrchestratorDependencies = {
      runId,
    };

    const started = Date.now();
    const result = await (pipeline as any).newAssignment(flags as any, dependencies as any);
    const duration = Date.now() - started;

    log.info('Assignment pipeline succeeded', {
      manifestPath: result.manifestPath,
      durationMs: duration,
    });

    return { manifestPath: result.manifestPath, notionUrl: result.pageUrl };
  };

  try {
    return await execute(config);
  } catch (err) {
    if (isManifestBucketMissingError(err) && config.orchestrator.manifestStore === 's3') {
      log.warn(
        'Manifest bucket missing; falling back to filesystem manifest store for this worker session',
        {
          bucket: config.orchestrator.manifestBucket,
        }
      );
      cachedPipeline = null;
      const fallbackConfig: BatchBackendConfig = {
        ...config,
        orchestrator: {
          ...config.orchestrator,
          manifestStore: 'filesystem',
          manifestBucket: undefined,
        },
      };
      return execute(fallbackConfig);
    }

    log.error(err instanceof Error ? err : String(err), {
      message: 'Assignment pipeline failed',
    });
    throw err;
  }
}

function isManifestBucketMissingError(error: unknown): boolean {
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
