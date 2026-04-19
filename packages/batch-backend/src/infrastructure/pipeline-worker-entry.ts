import { PipelineError } from '@esl-pipeline/contracts';
import { type NewAssignmentFlags, type RerunFlags } from '@esl-pipeline/orchestrator';

import { type BatchBackendConfig, loadConfig } from '../config/env.js';
import { getFfmpegSemaphore } from './ffmpeg-semaphore.js';
import { logger as rootLogger } from './logger.js';
import {
  getPipeline,
  type RunAssignmentPayload,
  type RunRerunAssignmentPayload,
} from './orchestrator-service.js';
import { applyUserSettingsToEnv } from './pipeline-worker-env.js';
import { toWorkerV2FailureError } from './pipeline-worker-v2.js';

type WorkerExecutionMode = 'new_assignment' | 'rerun';

interface WorkerRunMessage {
  type: 'run';
  executionMode?: WorkerExecutionMode;
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
  runId: string,
  config: BatchBackendConfig,
  signal?: AbortSignal,
) {
  const log = rootLogger.child({ jobId: payload.jobId, runId, component: 'pipeline-worker' });
  const pipeline = getPipeline(config);

  // Initialize FFmpeg semaphore with configured limit
  const ffmpegSemaphore = getFfmpegSemaphore(config.worker.maxConcurrentFfmpeg);

  const requiresTtsSemaphore =
    executionMode === 'rerun'
      ? !((payload as RunRerunAssignmentPayload).republishOnly ?? false)
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
      executionMode === 'rerun'
        ? await runRerunPipeline(
            pipeline,
            payload as RunRerunAssignmentPayload,
            config.worker.ttsCacheDir,
            signal,
          )
        : await runAssignmentPipeline(
            pipeline,
            payload as RunAssignmentPayload,
            config.worker.ttsCacheDir,
            signal,
          );
    const duration = Date.now() - started;

    log.info('Assignment pipeline succeeded (worker)', {
      manifestPath: result.manifestPath,
      durationMs: duration,
    });

    return {
      manifestPath: result.manifestPath,
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
  ttsOutDir: string,
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

  if (payload.forceTts) {
    flags.redoTts = payload.forceTts;
  }

  if (payload.ttsStrategy) {
    flags.ttsStrategy = payload.ttsStrategy;
  }

  if (payload.ttsProvider) {
    flags.ttsProvider = payload.ttsProvider;
  }

  if (payload.studyTextElevenlabsModel) {
    flags.studyTextElevenlabsModel = payload.studyTextElevenlabsModel;
  }

  if (payload.googleTtsModel) {
    flags.googleTtsModel = payload.googleTtsModel;
  }

  const result = await (
    pipeline as {
      executeNewAssignmentV2: (...args: unknown[]) => Promise<{
        ok: boolean;
        data?: PipelineRunResult;
        error?: {
          message?: string;
          code?: string;
          causeName?: string;
          category?: string;
          stage?: string;
          retryable?: boolean;
        };
      }>;
    }
  ).executeNewAssignmentV2({ assignment: flags }, { dependencies: { signal } });
  if (!result.ok) {
    throw toWorkerV2FailureError(result.error, 'orchestrator v2 newAssignment failed');
  }
  return result.data ?? {};
}

async function runRerunPipeline(
  pipeline: ReturnType<typeof getPipeline>,
  payload: RunRerunAssignmentPayload,
  ttsOutDir: string,
  signal?: AbortSignal,
): Promise<PipelineRunResult> {
  const flags: RerunFlags = {
    md: payload.md,
    republishOnly: payload.republishOnly ?? false,
    regenerateStudyTextAudio: payload.regenerateStudyTextAudio ?? false,
    regeneratePronunciationMainAudio: payload.regeneratePronunciationMainAudio ?? false,
    regeneratePronunciationChunkAudio: payload.regeneratePronunciationChunkAudio ?? false,
    upload: payload.upload ?? 's3',
    out: ttsOutDir,
    prefix: payload.prefix,
    publicRead: payload.publicRead,
    presign: payload.presign,
    studyTextVoiceAccent: payload.studyTextVoiceAccent ?? undefined,
    studyTextVoiceId: payload.studyTextVoiceId ?? undefined,
    studyTextTtsStrategy: payload.studyTextTtsStrategy ?? undefined,
    studyTextTtsProvider: payload.studyTextTtsProvider ?? undefined,
    studyTextElevenlabsModel: payload.studyTextElevenlabsModel ?? undefined,
    studyTextGoogleTtsModel: payload.studyTextGoogleTtsModel ?? undefined,
    studyTextDialogueLanguage: payload.studyTextDialogueLanguage ?? undefined,
    studyTextDialogueStability: payload.studyTextDialogueStability ?? undefined,
    studyTextDialogueSeed: payload.studyTextDialogueSeed ?? undefined,
    pronunciationMainVoiceAccent: payload.pronunciationMainVoiceAccent ?? undefined,
    pronunciationMainVoiceId: payload.pronunciationMainVoiceId ?? undefined,
    pronunciationMainTtsProvider: payload.pronunciationMainTtsProvider ?? undefined,
    pronunciationMainElevenlabsModel: payload.pronunciationMainElevenlabsModel ?? undefined,
    pronunciationMainGoogleTtsModel: payload.pronunciationMainGoogleTtsModel ?? undefined,
    pronunciationChunkVoiceAccent: payload.pronunciationChunkVoiceAccent ?? undefined,
    pronunciationChunkVoiceId: payload.pronunciationChunkVoiceId ?? undefined,
    pronunciationChunkTtsProvider: payload.pronunciationChunkTtsProvider ?? undefined,
    pronunciationChunkElevenlabsModel: payload.pronunciationChunkElevenlabsModel ?? undefined,
    pronunciationChunkGoogleTtsModel: payload.pronunciationChunkGoogleTtsModel ?? undefined,
    pronunciationChunkEdgeVoice: payload.pronunciationChunkEdgeVoice ?? undefined,
  };
  if (payload.manifestMd) {
    (flags as RerunFlags & { manifestMd?: string }).manifestMd = payload.manifestMd;
  }

  const result = await (
    pipeline as {
      executeRerunAssignmentV2: (...args: unknown[]) => Promise<{
        ok: boolean;
        data?: PipelineRunResult;
        error?: {
          message?: string;
          code?: string;
          causeName?: string;
          category?: string;
          stage?: string;
          retryable?: boolean;
        };
      }>;
    }
  ).executeRerunAssignmentV2({ assignment: flags }, { dependencies: { signal } });
  if (!result.ok) {
    throw toWorkerV2FailureError(result.error, 'orchestrator v2 rerunAssignment failed');
  }
  return result.data ?? {};
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
      msg.executionMode === 'rerun' ? 'rerun' : 'new_assignment';
    const log = rootLogger.child({ jobId: payload.jobId, runId, component: 'pipeline-worker' });
    const config = loadConfig();
    const abortController = new AbortController();
    currentAbortController = abortController;

    // Apply user settings overrides
    if (payload.settings?.elevenLabsApiKey) {
      config.orchestrator.elevenLabsApiKey = payload.settings.elevenLabsApiKey;
    }

    applyUserSettingsToEnv(payload.settings, config.orchestrator.elevenLabsApiKey);

    try {
      const result = await executePipeline(
        payload,
        executionMode,
        runId,
        config,
        abortController.signal,
      );
      process.send!({ type: 'success', result });
      process.exit(0);
    } catch (error) {
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
    } finally {
      currentAbortController = null;
    }
  });
}

main().catch((error) => {
  console.error('Worker main failed', error);
  process.exit(1);
});
