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
import { loadConfig } from '../config/env';
import { logger as rootLogger, Logger } from './logger';
import { metrics } from './metrics';

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
    manifestStore = new S3ManifestStore({
      bucket: config.orchestrator.manifestBucket!,
      prefix: config.orchestrator.manifestPrefix,
      region: process.env.AWS_REGION,
      rootDir: config.orchestrator.manifestRoot,
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
  voiceAccent?: string | null;
  forceTts?: boolean | null;
  notionDatabase?: string | null;
  mode?: 'auto' | 'dialogue' | 'monologue' | null;
}

// runAssignmentJob.declaration()
export async function runAssignmentJob(
  payload: RunAssignmentPayload,
  runId: string
): Promise<{ manifestPath?: string; notionUrl?: string }> {
  const pipeline = getPipeline();
  const log = rootLogger.child({ jobId: payload.jobId, runId });

  const flags: NewAssignmentFlags = {
    md: payload.md,
    preset: payload.preset,
    withTts: payload.withTts,
    upload: payload.upload,
  };

  if (payload.voiceAccent) {
    flags.accentPreference = payload.voiceAccent;
  }

  if (payload.notionDatabase) {
    flags.dbId = payload.notionDatabase;
  }

  // TODO: Forward forceTts/mode once orchestrator exposes the corresponding flags.

  const dependencies: OrchestratorDependencies = {
    runId,
  };

  try {
    const started = Date.now();
    // Call orchestrator's newAssignment via pipeline wrapper.
    // The orchestrator's public signature accepts at most (flags, callbacksOrDeps),
    // so we pass dependencies (including runId) as the second argument.
    const result = await (pipeline as any).newAssignment(flags as any, dependencies as any);
    const duration = Date.now() - started;

    log.info('Assignment pipeline succeeded', {
      manifestPath: result.manifestPath,
      durationMs: duration,
    });

    return { manifestPath: result.manifestPath, notionUrl: result.pageUrl };
  } catch (err) {
    log.error(err instanceof Error ? err : String(err), {
      message: 'Assignment pipeline failed',
    });
    throw err;
  }
}
