
import {
    getPipeline,
    isManifestBucketMissingError,
    type RunAssignmentPayload,
} from './orchestrator-service.js';
import { loadConfig, type BatchBackendConfig } from '../config/env';
import { logger as rootLogger } from './logger.js';
import { PipelineError } from '@esl-pipeline/contracts';
import type { NewAssignmentFlags, OrchestratorDependencies } from '@esl-pipeline/orchestrator';
import { getFfmpegSemaphore } from './ffmpeg-semaphore.js';

interface WorkerMessage {
    payload: RunAssignmentPayload;
    runId: string;
}

async function executePipeline(
    payload: RunAssignmentPayload,
    runId: string,
    config: BatchBackendConfig
) {
    const log = rootLogger.child({ jobId: payload.jobId, runId, component: 'pipeline-worker' });
    const pipeline = getPipeline(config);

    // Initialize FFmpeg semaphore with configured limit
    const ffmpegSemaphore = getFfmpegSemaphore(config.worker.maxConcurrentFfmpeg);

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

    // Acquire semaphore before TTS operations if TTS is enabled
    let semaphoreAcquired = false;
    const operationId = `job-${payload.jobId}-${runId}`;

    if (payload.withTts) {
        await ffmpegSemaphore.acquire(operationId);
        semaphoreAcquired = true;
        log.debug('Acquired FFmpeg semaphore', { operationId });
    }

    const dependencies: OrchestratorDependencies = {
        runId,
    };

    try {
        const started = Date.now();
        // Cast to any because newAssignment is protected/internal in some contexts or types might be strict
        // but orchestrator-service.ts was doing it, so we follow suit.
        const result = await (pipeline as any).newAssignment(flags as any, dependencies as any);
        const duration = Date.now() - started;

        log.info('Assignment pipeline succeeded (worker)', {
            manifestPath: result.manifestPath,
            durationMs: duration,
        });

        return { manifestPath: result.manifestPath, notionUrl: result.pageUrl };
    } finally {
        // Release semaphore after TTS operations complete
        if (semaphoreAcquired) {
            await ffmpegSemaphore.release(operationId);
            log.debug('Released FFmpeg semaphore', { operationId });
        }
    }
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
        const { payload, runId } = msg;
        const log = rootLogger.child({ jobId: payload.jobId, runId, component: 'pipeline-worker' });
        const config = loadConfig();

        try {
            const result = await executePipeline(payload, runId, config);
            process.send!({ type: 'success', result });
            process.exit(0);
        } catch (err) {
            // Handle fallback logic here
            if (isManifestBucketMissingError(err) && config.orchestrator.manifestStore === 's3') {
                log.warn(
                    'Manifest bucket missing; falling back to filesystem manifest store for this worker session',
                    {
                        bucket: config.orchestrator.manifestBucket,
                    }
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

                    const result = await executePipeline(payload, runId, fallbackConfig);
                    process.send!({ type: 'success', result });
                    process.exit(0);
                } catch (fallbackErr) {
                    const fallbackErrorMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
                    const fallbackErrorStack = fallbackErr instanceof Error ? fallbackErr.stack : undefined;
                    const fallbackErrorName = fallbackErr instanceof Error ? fallbackErr.name : 'UnknownError';

                    log.error(fallbackErr instanceof Error ? fallbackErr : String(fallbackErr), {
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
                const errorMessage = err instanceof Error ? err.message : String(err);
                const errorStack = err instanceof Error ? err.stack : undefined;
                const errorName = err instanceof Error ? err.name : 'UnknownError';

                // Enhanced logging for PipelineError
                if (err instanceof PipelineError) {
                    log.error(`[Worker] PipelineError: ${errorMessage}`, {
                        name: errorName,
                        stack: errorStack,
                    });
                } else {
                    log.error(`[Worker] Unhandled error: ${errorMessage}`, { error: err });
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
        }
    });
}

main().catch((err) => {
    console.error('Worker main failed', err);
    process.exit(1);
});
