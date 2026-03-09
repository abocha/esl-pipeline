import { PipelineError } from '@esl-pipeline/contracts';
import { type NewAssignmentFlags, type RerunFlags } from '@esl-pipeline/orchestrator';

import { type BatchBackendConfig, loadConfig } from '../config/env.js';
import { getFfmpegSemaphore } from './ffmpeg-semaphore.js';
import { logger as rootLogger } from './logger.js';
import { applyUserSettingsToEnv } from './pipeline-worker-env.js';
import {
  type RunAssignmentPayload,
  type RunRerunAssignmentPayload,
  getPipeline,
  isManifestBucketMissingError,
} from './orchestrator-service.js';

type WorkerExecutionMode = 'new_assignment' | 'rerun_assignment';
type OrchestratorApiVersion = 'v1' | 'v2';

interface WorkerRunMessage {
  type: 'run';
  executionMode?: WorkerExecutionMode;
  apiVersion?: OrchestratorApiVersion;
  payload: RunAssignmentPayload | RunRerunAssignmentPayload;
  runId: string;
}

interface WorkerAbortMessage {
  type: 'abort';
  reason?: string;
}

type WorkerMessage = WorkerRunMessage | WorkerAbortMessage;

let currentAbortController: AbortController | null = null;

interface PipelineRunResult {
  manifestPath?: string;
  pageUrl?: string;
  anytypeUrl?: string;
  htmlUrl?: string;
}

function isPipelineCancelledErrorLike(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'PipelineCancelledError' ||
    error.message.toLowerCase() === 'cancelled' ||
    error.message.toLowerCase().startsWith('cancelled:')
  );
}

async function executePipeline(
  payload: RunAssignmentPayload | RunRerunAssignmentPayload,
  executionMode: WorkerExecutionMode,
  apiVersion: OrchestratorApiVersion,
  runId: string,
  config: BatchBackendConfig,
  signal?: AbortSignal,
) {
  const log = rootLogger.child({ jobId: payload.jobId, runId, component: 'pipeline-worker' });
  const pipeline = getPipeline(config);

  // Initialize FFmpeg semaphore with configured limit
  const ffmpegSemaphore = getFfmpegSemaphore(config.worker.maxConcurrentFfmpeg);

  const requiresTtsSemaphore =
    executionMode === 'rerun_assignment'
      ? ((payload as RunRerunAssignmentPayload).steps ?? ['tts', 'upload', 'add-audio']).includes(
          'tts',
        )
      : Boolean((payload as RunAssignmentPayload).withTts);

  // Acquire semaphore before TTS operations if TTS is enabled
  let semaphoreAcquired = false;
  const operationId = `job-${payload.jobId}-${runId}`;

  if (requiresTtsSemaphore) {
    await ffmpegSemaphore.acquire(operationId);
    semaphoreAcquired = true;
    log.debug('Acquired FFmpeg semaphore', { operationId });
  }

  try {
    const started = Date.now();
    const result =
      executionMode === 'rerun_assignment'
        ? await runRerunPipeline(
            pipeline,
            payload as RunRerunAssignmentPayload,
            apiVersion,
            config.worker.ttsCacheDir,
            config.orchestrator.notionDatabaseId,
            signal,
          )
        : await runAssignmentPipeline(
            pipeline,
            payload as RunAssignmentPayload,
            apiVersion,
            config.worker.ttsCacheDir,
            config.orchestrator.notionDatabaseId,
            signal,
          );
    const duration = Date.now() - started;

    log.info('Assignment pipeline succeeded (worker)', {
      manifestPath: result.manifestPath,
      durationMs: duration,
    });

    return {
      manifestPath: result.manifestPath,
      notionUrl: result.pageUrl,
      anytypeUrl: result.anytypeUrl,
      htmlUrl: result.htmlUrl,
    };
  } finally {
    // Release semaphore after TTS operations complete
    if (semaphoreAcquired) {
      await ffmpegSemaphore.release(operationId);
      log.debug('Released FFmpeg semaphore', { operationId });
    }
  }
}

async function runAssignmentPipeline(
  pipeline: ReturnType<typeof getPipeline>,
  payload: RunAssignmentPayload,
  apiVersion: OrchestratorApiVersion,
  ttsOutDir: string,
  defaultNotionDatabaseId?: string,
  signal?: AbortSignal,
): Promise<PipelineRunResult> {
  const flags: NewAssignmentFlags = {
    md: payload.md,
    preset: payload.preset,
    learningPresetId: payload.learningPresetId,
    withTts: payload.withTts,
    upload: payload.upload,
    publishTarget: payload.publishTarget,
    out: ttsOutDir,
  };

  if (payload.notionDatabase) {
    flags.dbId = payload.notionDatabase;
  } else if (defaultNotionDatabaseId) {
    flags.dbId = defaultNotionDatabaseId;
  }

  if (payload.forceTts) {
    flags.redoTts = payload.forceTts;
  }

  if (payload.ttsStrategy) {
    flags.ttsStrategy = payload.ttsStrategy;
  }

  if (payload.ttsProvider) {
    flags.ttsProvider = payload.ttsProvider;
  }

  if (payload.googleTtsModel) {
    flags.googleTtsModel = payload.googleTtsModel;
  }

  if (apiVersion === 'v2') {
    const result = await (
      pipeline as {
        executeNewAssignmentV2: (...args: unknown[]) => Promise<{
          ok: boolean;
          data?: PipelineRunResult;
          error?: { message?: string; code?: string };
        }>;
      }
    ).executeNewAssignmentV2(
      { assignment: flags },
      { dependencies: { signal } },
    );
    if (!result.ok) {
      const error = new Error(result.error?.message || 'orchestrator v2 newAssignment failed');
      error.name = result.error?.code || 'ORCHESTRATOR_V2_ERROR';
      throw error;
    }
    return result.data ?? {};
  }

  return (pipeline as { newAssignment: (...args: unknown[]) => Promise<PipelineRunResult> })
    .newAssignment(
      flags,
      undefined,
      {
        signal,
      },
    );
}

async function runRerunPipeline(
  pipeline: ReturnType<typeof getPipeline>,
  payload: RunRerunAssignmentPayload,
  apiVersion: OrchestratorApiVersion,
  ttsOutDir: string,
  _defaultNotionDatabaseId?: string,
  signal?: AbortSignal,
): Promise<PipelineRunResult> {
  const flags: RerunFlags = {
    md: payload.md,
    steps:
      payload.steps && payload.steps.length > 0
        ? payload.steps
        : (['tts', 'upload', 'add-audio'] as NonNullable<RerunFlags['steps']>),
    upload: payload.upload ?? 's3',
    force: payload.force ?? false,
    out: ttsOutDir,
    prefix: payload.prefix,
    publicRead: payload.publicRead,
    presign: payload.presign,
    accentPreference: payload.accentPreference ?? undefined,
    voiceId: payload.voiceId ?? undefined,
    ttsStrategy: payload.ttsStrategy ?? undefined,
    ttsProvider: payload.ttsProvider ?? undefined,
    googleTtsModel: payload.googleTtsModel ?? undefined,
    dialogueLanguage: payload.dialogueLanguage ?? undefined,
    dialogueStability: payload.dialogueStability ?? undefined,
    dialogueSeed: payload.dialogueSeed ?? undefined,
  };
  if (payload.manifestMd) {
    (flags as RerunFlags & { manifestMd?: string }).manifestMd = payload.manifestMd;
  }

  if (apiVersion === 'v2') {
    const result = await (
      pipeline as {
        executeRerunAssignmentV2: (...args: unknown[]) => Promise<{
          ok: boolean;
          data?: PipelineRunResult;
          error?: { message?: string; code?: string };
        }>;
      }
    ).executeRerunAssignmentV2(
      { assignment: flags },
      { dependencies: { signal } },
    );
    if (!result.ok) {
      const error = new Error(result.error?.message || 'orchestrator v2 rerunAssignment failed');
      error.name = result.error?.code || 'ORCHESTRATOR_V2_ERROR';
      throw error;
    }
    return result.data ?? {};
  }

  return (pipeline as { rerunAssignment: (...args: unknown[]) => Promise<PipelineRunResult> })
    .rerunAssignment(
      flags,
      { signal },
    );
}

async function main() {
  if (!process.send) {
    console.error('This script must be run as a child process with IPC channel open.');
    process.exit(1);
  }

  process.on('disconnect', () => {
    console.log('Parent process disconnected; exiting worker.');
    process.exit(0);
  });

  process.on('message', async (msg: WorkerMessage) => {
    if (msg.type === 'abort') {
      currentAbortController?.abort(msg.reason);
      return;
    }
    if (msg.type !== 'run') {
      return;
    }

    const { payload, runId } = msg;
    const executionMode: WorkerExecutionMode =
      msg.executionMode === 'rerun_assignment' ? 'rerun_assignment' : 'new_assignment';
    const log = rootLogger.child({ jobId: payload.jobId, runId, component: 'pipeline-worker' });
    const config = loadConfig();
    const apiVersion: OrchestratorApiVersion =
      msg.apiVersion === 'v2' ? 'v2' : config.orchestrator.apiVersion;
    const abortController = new AbortController();
    currentAbortController = abortController;

    // Apply user settings overrides
    if (payload.settings?.elevenLabsApiKey) {
      config.orchestrator.elevenLabsApiKey = payload.settings.elevenLabsApiKey;
    }
    if (payload.settings?.notionToken) {
      config.orchestrator.notionToken = payload.settings.notionToken;
    }

    applyUserSettingsToEnv(payload.settings, config.orchestrator.elevenLabsApiKey);

    try {
      const result = await executePipeline(
        payload,
        executionMode,
        apiVersion,
        runId,
        config,
        abortController.signal,
      );
      process.send!({ type: 'success', result });
      process.exit(0);
    } catch (error) {
      // Handle fallback logic here
      if (isManifestBucketMissingError(error) && config.orchestrator.manifestStore === 's3') {
        log.warn(
          'Manifest bucket missing; falling back to filesystem manifest store for this worker session',
          {
            bucket: config.orchestrator.manifestBucket,
          },
        );

        const fallbackConfig: BatchBackendConfig = {
          ...config,
          orchestrator: {
            ...config.orchestrator,
            manifestStore: 'filesystem',
            manifestBucket: undefined,
          },
        };

        try {
          // The pipeline instance is cached in the module scope of orchestrator-service.
          // Since we've already initialized it with the original config, we must explicitly
          // reset the cache to force a re-initialization with the fallback config.

          const { resetPipelineCache } = await import('./orchestrator-service.js');
          resetPipelineCache();

          const result = await executePipeline(
            payload,
            executionMode,
            apiVersion,
            runId,
            fallbackConfig,
            abortController.signal,
          );
          process.send!({ type: 'success', result });
          process.exit(0);
        } catch (error_) {
          const fallbackErrorMessage = error_ instanceof Error ? error_.message : String(error_);
          const fallbackErrorStack = error_ instanceof Error ? error_.stack : undefined;
          const fallbackErrorName = error_ instanceof Error ? error_.name : 'UnknownError';

          log.error(error_ instanceof Error ? error_ : String(error_), {
            message: 'Assignment pipeline failed (after fallback)',
          });
          process.send!({
            type: 'error',
            error: {
              message: fallbackErrorMessage,
              stack: fallbackErrorStack,
              name: fallbackErrorName,
            },
          });
          process.exit(1);
        }
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        const errorName = error instanceof Error ? error.name : 'UnknownError';

        // Enhanced logging for PipelineError
        if (error instanceof PipelineError) {
          log.error(`[Worker] PipelineError: ${errorMessage}`, {
            name: errorName,
            stack: errorStack,
          });
        } else if (isPipelineCancelledErrorLike(error)) {
          log.warn('[Worker] Pipeline cancelled', {
            name: errorName,
            message: errorMessage,
          });
        } else {
          log.error(`[Worker] Unhandled error: ${errorMessage}`, { error: error });
        }

        process.send!({
          type: 'error',
          error: {
            message: errorMessage,
            stack: errorStack,
            name: errorName,
          },
        });
        process.exit(1);
      }
    } finally {
      currentAbortController = null;
    }
  });
}

main().catch((error) => {
  console.error('Worker main failed', error);
  process.exit(1);
});
