// packages/batch-backend/src/application/process-queue-job.ts
// Application service executed by the BullMQ worker.
// Flow:
// 1. Load job from DB.
// 2. If not found or already terminal -> no-op.
// 3. Transition queued -> running.
// 4. If approved markdown is present, call ESL pipeline via runAssignmentJob.
// 5. On success, transition running -> succeeded with manifestPath.
// 6. On failure, transition running -> failed with error and rethrow so BullMQ can retry.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { manifestPathFor } from '@esl-pipeline/orchestrator';

import { type BatchBackendConfig, loadConfig } from '../config/env.js';
import { publishJobEvent } from '../domain/job-events.js';
import { getJobById, updateJobStateAndResult } from '../domain/job-repository.js';
import {
  getDecryptedElevenLabsKey,
  getDecryptedNotionToken,
  getSettingsByUserId,
} from '../domain/settings-repository.js';
import { registerRunningJob, unregisterRunningJob } from '../infrastructure/job-cancellation.js';
import { createJobLogger } from '../infrastructure/logger.js';
import { runAssignmentJob, runRerunAssignmentJob } from '../infrastructure/orchestrator-service.js';
import type { QueueJobPayload } from '../infrastructure/queue-bullmq.js';
import { createTranscriptionStorageForUri } from '../infrastructure/transcription-storage.js';
import {
  maybeRunTtsCacheMaintenanceWithPgLock,
  withTtsCacheActivitySharedLock,
} from '../infrastructure/tts-cache-maintenance-coordinator.js';
import { requestHomeworkMemoryGeneration } from './request-homework-memory-generation.js';

function resolveInheritedVoiceIdForProviderChange(args: {
  explicitVoiceId?: string;
  explicitProvider?: 'elevenlabs' | 'google' | 'edge-tts';
  persistedProvider?: 'elevenlabs' | 'google';
  persistedVoiceId?: string | null;
}): string | undefined {
  if (args.explicitVoiceId !== undefined) {
    return args.explicitVoiceId;
  }

  if (args.explicitProvider !== undefined && args.explicitProvider !== args.persistedProvider) {
    return undefined;
  }

  return args.persistedVoiceId ?? undefined;
}

// processQueueJob.declaration()
export async function processQueueJob(payload: QueueJobPayload): Promise<void> {
  const { jobId } = payload;
  const log = createJobLogger(jobId);

  const job = await getJobById(jobId);
  if (!job) {
    log.warn('Job not found; skipping', { event: 'job_missing' });
    return;
  }

  if (job.state === 'succeeded' || job.state === 'failed') {
    log.info('Job already terminal; skipping', { state: job.state });
    return;
  }

  if (job.state === 'awaiting_approval') {
    log.info('Job awaiting approval; skipping', { state: job.state });
    return;
  }

  const running = await updateJobStateAndResult({
    id: jobId,
    expectedState: 'queued',
    nextState: 'running',
    startedAt: new Date(),
  });

  if (!running) {
    log.warn('Failed to mark job running; likely race; skipping', {
      event: 'state_conflict',
    });
    return;
  }

  publishJobEvent({ type: 'job_state_changed', job: running });

  const runId = jobId;
  const cancellationController = new AbortController();
  registerRunningJob(jobId, cancellationController);

  try {
    if (running.sourceJobId && (payload.executionMode !== 'rerun' || !payload.rerun)) {
      throw new Error(
        'Corrupted rerun queue payload: rerun jobs must include executionMode="rerun" and rerun metadata.',
      );
    }

    const config = loadConfig();

    try {
      const maintenance = await maybeRunTtsCacheMaintenanceWithPgLock({
        cacheDir: config.worker.ttsCacheDir,
        maxAgeDays: config.worker.ttsCacheMaxAgeDays,
        maxBytes: config.worker.ttsCacheMaxBytes,
        intervalMinutes: config.worker.ttsCacheMaintenanceIntervalMinutes,
        lockKey: config.worker.ttsCacheMaintenanceLockKey,
      });
      if (maintenance.ran && maintenance.deletedFiles > 0) {
        log.info('TTS cache maintenance pruned stale artifacts', {
          deletedFiles: maintenance.deletedFiles,
          reclaimedBytes: maintenance.reclaimedBytes,
          remainingBytes: maintenance.remainingBytes,
        });
      }
    } catch (error) {
      log.warn('TTS cache maintenance failed; continuing job execution', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const markdownInput = await resolveMarkdownInput(running);

    const uploadFlag = resolveUploadTarget(running.upload, config.storage.provider);

    // Fetch user settings if job is linked to a user
    let userSettings:
      | {
          elevenLabsApiKey?: string | null;
          notionToken?: string | null;
          ttsProvider?: 'elevenlabs' | 'google' | null;
        }
      | undefined;
    if (running.userId) {
      const settings = await getSettingsByUserId(running.userId);
      if (settings) {
        const elevenLabsApiKey = await getDecryptedElevenLabsKey(running.userId);
        const notionToken = await getDecryptedNotionToken(running.userId);

        if (elevenLabsApiKey || notionToken || settings.ttsProvider) {
          userSettings = {
            elevenLabsApiKey: elevenLabsApiKey ?? null,
            notionToken: notionToken ?? null,
          };
          if (settings.ttsProvider) {
            userSettings.ttsProvider = settings.ttsProvider;
          }
          log.info('Using user-specific settings for job', {
            userId: running.userId,
            hasElevenLabsKey: !!elevenLabsApiKey,
            hasNotionToken: !!notionToken,
            ttsProvider: settings.ttsProvider,
          });
        }
      }
    }
    const userSettingsTtsProvider =
      userSettings?.ttsProvider === 'elevenlabs' || userSettings?.ttsProvider === 'google'
        ? userSettings.ttsProvider
        : undefined;
    const persistedStudyTextProvider =
      running.ttsProvider === 'elevenlabs' || running.ttsProvider === 'google'
        ? running.ttsProvider
        : userSettingsTtsProvider;

    const isRerunExecution = payload.executionMode === 'rerun';
    const rerunRequestsGeneration =
      !payload.rerun?.republishOnly &&
      Boolean(
        payload.rerun?.regenerateStudyTextAudio ||
          payload.rerun?.regeneratePronunciationMainAudio ||
          payload.rerun?.regeneratePronunciationChunkAudio,
      );
    const shouldHoldTtsCacheActivityLock =
      config.worker.ttsCacheMaintenanceIntervalMinutes > 0 &&
      (isRerunExecution ? rerunRequestsGeneration : running.withTts === true);

    const canonicalManifestMd = isRerunExecution
      ? await resolveManifestMdPath(payload.rerun?.manifestMd, markdownInput.mdPath)
      : await resolveManifestMdPath(running.md, markdownInput.mdPath);

    const executePipeline = async () => {
      try {
        return isRerunExecution
          ? await runRerunAssignmentJob(
              {
                jobId,
                md: markdownInput.mdPath,
                manifestMd: canonicalManifestMd,
                upload: payload.rerun?.upload ?? 's3',
                republishOnly: payload.rerun?.republishOnly ?? false,
                regenerateStudyTextAudio: payload.rerun?.regenerateStudyTextAudio ?? false,
                regeneratePronunciationMainAudio:
                  payload.rerun?.regeneratePronunciationMainAudio ?? false,
                regeneratePronunciationChunkAudio:
                  payload.rerun?.regeneratePronunciationChunkAudio ?? false,
                prefix: payload.rerun?.prefix,
                publicRead: payload.rerun?.publicRead,
                presign: payload.rerun?.presign,
                studyTextVoiceAccent:
                  payload.rerun?.studyTextVoiceAccent ?? running.voiceAccent ?? undefined,
                studyTextVoiceId: resolveInheritedVoiceIdForProviderChange({
                  explicitVoiceId: payload.rerun?.studyTextVoiceId,
                  explicitProvider: payload.rerun?.studyTextTtsProvider,
                  persistedProvider: persistedStudyTextProvider,
                  persistedVoiceId: running.voiceId,
                }),
                studyTextTtsStrategy:
                  payload.rerun?.studyTextTtsStrategy ?? running.ttsStrategy ?? undefined,
                studyTextTtsProvider:
                  payload.rerun?.studyTextTtsProvider ??
                  running.ttsProvider ??
                  userSettingsTtsProvider ??
                  undefined,
                studyTextElevenlabsModel:
                  payload.rerun?.studyTextElevenlabsModel ??
                  running.studyTextElevenlabsModel ??
                  undefined,
                studyTextGoogleTtsModel:
                  payload.rerun?.studyTextGoogleTtsModel ?? running.googleTtsModel ?? undefined,
                studyTextDialogueLanguage: payload.rerun?.studyTextDialogueLanguage,
                studyTextDialogueStability: payload.rerun?.studyTextDialogueStability,
                studyTextDialogueSeed: payload.rerun?.studyTextDialogueSeed,
                pronunciationMainVoiceAccent:
                  payload.rerun?.pronunciationMainVoiceAccent ?? running.voiceAccent ?? undefined,
                pronunciationMainVoiceId: resolveInheritedVoiceIdForProviderChange({
                  explicitVoiceId: payload.rerun?.pronunciationMainVoiceId,
                  explicitProvider: payload.rerun?.pronunciationMainTtsProvider,
                  persistedProvider: persistedStudyTextProvider,
                  persistedVoiceId: running.voiceId,
                }),
                pronunciationMainTtsProvider: payload.rerun?.pronunciationMainTtsProvider,
                pronunciationMainElevenlabsModel: payload.rerun?.pronunciationMainElevenlabsModel,
                pronunciationMainGoogleTtsModel: payload.rerun?.pronunciationMainGoogleTtsModel,
                pronunciationChunkVoiceAccent:
                  payload.rerun?.pronunciationChunkVoiceAccent ?? running.voiceAccent ?? undefined,
                pronunciationChunkVoiceId: resolveInheritedVoiceIdForProviderChange({
                  explicitVoiceId: payload.rerun?.pronunciationChunkVoiceId,
                  explicitProvider: payload.rerun?.pronunciationChunkTtsProvider,
                  persistedProvider: persistedStudyTextProvider,
                  persistedVoiceId: running.voiceId,
                }),
                pronunciationChunkTtsProvider: payload.rerun?.pronunciationChunkTtsProvider,
                pronunciationChunkElevenlabsModel: payload.rerun?.pronunciationChunkElevenlabsModel,
                pronunciationChunkGoogleTtsModel: payload.rerun?.pronunciationChunkGoogleTtsModel,
                pronunciationChunkEdgeVoice: payload.rerun?.pronunciationChunkEdgeVoice,
                settings: userSettings,
              },
              runId,
              { signal: cancellationController.signal },
            )
          : await runAssignmentJob(
              {
                jobId,
                md: markdownInput.mdPath,
                preset: running.preset ?? undefined,
                learningPresetId: running.learningPresetId ?? undefined,
                withTts: running.withTts ?? undefined,
                // Only forward upload flag values supported by orchestrator.
                // Any other persisted value (e.g. 'none' or null) is treated as "no override".
                upload: uploadFlag,
                forceTts: running.forceTts ?? undefined,
                notionDatabase:
                  running.notionDatabase ?? config.orchestrator.notionDatabaseId ?? undefined,
                publishTarget: running.publishTarget ?? undefined,
                ttsStrategy: running.ttsStrategy ?? undefined,
                ttsProvider: running.ttsProvider ?? userSettingsTtsProvider ?? undefined,
                studyTextElevenlabsModel: running.studyTextElevenlabsModel ?? undefined,
                googleTtsModel: running.googleTtsModel ?? undefined,
                settings: userSettings,
              },
              runId,
              { signal: cancellationController.signal },
            );
      } finally {
        try {
          await markdownInput.cleanup();
        } catch (cleanupError) {
          log.warn('Failed to clean up temporary markdown input', {
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }
      }
    };

    const rawResult = shouldHoldTtsCacheActivityLock
      ? await withTtsCacheActivitySharedLock(
          { lockKey: config.worker.ttsCacheMaintenanceLockKey },
          executePipeline,
        )
      : await executePipeline();
    const durableManifestPath =
      config.orchestrator.manifestStore === 'filesystem'
        ? await promoteFilesystemManifestPath(rawResult.manifestPath, canonicalManifestMd)
        : rawResult.manifestPath;
    const result = {
      ...rawResult,
      manifestPath: durableManifestPath,
    };

    const succeeded = await updateJobStateAndResult({
      id: jobId,
      expectedState: 'running',
      nextState: 'succeeded',
      manifestPath: result.manifestPath ?? null,
      notionUrl: result.notionUrl ?? null,
      anytypeUrl: result.anytypeUrl ?? null,
      htmlUrl: result.htmlUrl ?? null,
      finishedAt: new Date(),
    });

    if (succeeded) {
      publishJobEvent({ type: 'job_state_changed', job: succeeded });
      if (
        !isRerunExecution &&
        succeeded.studentId &&
        (config as { generation?: unknown }).generation
      ) {
        void requestHomeworkMemoryGeneration({
          config,
          params: {
            jobId,
            studentId: succeeded.studentId ?? null,
          },
        }).catch((enqueueError) => {
          log.warn('Homework-memory enqueue failed after publish success; continuing', {
            event: 'homework_memory_enqueue_failed_non_blocking',
            error: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
          });
        });
      }
      log.info('Job processed successfully', {
        manifestPath: result.manifestPath,
      });
      return;
    }

    const postSuccessAttempt = await getJobById(jobId);
    if (!postSuccessAttempt) {
      log.warn('Success transition lost due to missing job row', {
        event: 'job_missing_success_transition',
      });
      return;
    }
    if (postSuccessAttempt.state === 'failed' && isCancellationError(postSuccessAttempt.error)) {
      log.info('Job was cancelled before success transition could persist', {
        event: 'job_cancelled_before_success',
      });
      return;
    }

    log.warn('Success transition skipped due to state race', {
      event: 'job_success_state_conflict',
      state: postSuccessAttempt.state,
    });
    return;
  } catch (error) {
    log.error(error instanceof Error ? error : String(error), {
      event: 'job_failed',
    });

    const failed = await updateJobStateAndResult({
      id: jobId,
      expectedState: 'running',
      nextState: 'failed',
      error: error instanceof Error ? error.message : String(error),
      finishedAt: new Date(),
    });

    if (failed) {
      publishJobEvent({ type: 'job_state_changed', job: failed });
      throw error;
    }

    const latest = await getJobById(jobId);
    if (latest?.state === 'failed' && isCancellationError(latest.error)) {
      log.info('Job failure transition skipped because job was cancelled', {
        event: 'job_cancelled_during_failure',
      });
      return;
    }

    // Propagate so BullMQ can apply retry/backoff policy.
    throw error;
  } finally {
    unregisterRunningJob(jobId);
  }
}

function isCancellationError(error: string | null | undefined): boolean {
  return typeof error === 'string' && error.toLowerCase().startsWith('cancelled');
}

function buildMarkdownPathCandidates(mdPath: string): string[] {
  const sanitized = mdPath?.trim();
  if (!sanitized) {
    throw new Error('Markdown path is empty');
  }

  const candidates = new Set<string>();

  if (path.isAbsolute(sanitized)) {
    candidates.add(sanitized);
  } else {
    candidates.add(path.resolve(process.cwd(), sanitized));
  }

  const uploadDir = process.env.FILESYSTEM_UPLOAD_DIR || './uploads';
  const uploadRoot = path.resolve(uploadDir);
  const repoRoot = path.resolve(import.meta.dirname, '../../..');
  const normalizedMd = sanitized.replace(/^\.?[\\/]/, '');
  const normalizedWithoutUploadsPrefix = normalizedMd.replace(/^uploads[\\/]/, '');

  for (const base of [uploadRoot, repoRoot]) {
    candidates.add(path.join(base, normalizedMd));
    if (normalizedWithoutUploadsPrefix !== normalizedMd) {
      candidates.add(path.join(base, normalizedWithoutUploadsPrefix));
    }
  }

  return [...candidates];
}

async function resolveMarkdownPath(mdPath: string): Promise<string> {
  const candidates = buildMarkdownPathCandidates(mdPath);
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Markdown file not found: ${mdPath.trim()}`);
}

async function resolveManifestMdPath(
  rawManifestMd: string | null | undefined,
  fallbackMdPath: string,
): Promise<string> {
  const sanitized = rawManifestMd?.trim();
  if (!sanitized) {
    return fallbackMdPath;
  }

  const candidates = buildMarkdownPathCandidates(sanitized);
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0] ?? fallbackMdPath;
}

async function promoteFilesystemManifestPath(
  rawManifestPath: string | null | undefined,
  canonicalManifestMd: string,
): Promise<string | undefined> {
  const manifestPath = rawManifestPath?.trim();
  if (!manifestPath || manifestPath.startsWith('s3://')) {
    return manifestPath ?? undefined;
  }

  const durableManifestPath = manifestPathFor(canonicalManifestMd);
  if (manifestPath === durableManifestPath) {
    return manifestPath;
  }

  if (!(await fileExists(manifestPath))) {
    return manifestPath;
  }

  await fs.mkdir(path.dirname(durableManifestPath), { recursive: true });
  await fs.copyFile(manifestPath, durableManifestPath);
  return durableManifestPath;
}

interface ResolvedMarkdownInput {
  mdPath: string;
  cleanup: () => Promise<void>;
}

async function resolveMarkdownInput(job: {
  id: string;
  md: string | null;
  mdStorageUri?: string | null;
}): Promise<ResolvedMarkdownInput> {
  if (job.mdStorageUri) {
    return materializeMarkdownFromStorage(job.id, job.mdStorageUri);
  }

  if (job.md) {
    const resolvedMdPath = await resolveMarkdownPath(job.md);
    return {
      mdPath: resolvedMdPath,
      cleanup: async () => {},
    };
  }

  throw new Error('Job is missing an approved markdown source');
}

async function materializeMarkdownFromStorage(
  jobId: string,
  storageUri: string,
): Promise<ResolvedMarkdownInput> {
  const storage = createTranscriptionStorageForUri(storageUri);
  const contents = await storage.getText(storageUri);
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), `esl-job-${sanitizeForFs(jobId)}-`));
  const mdPath = path.join(baseDir, 'assignment.md');
  await fs.writeFile(mdPath, contents, 'utf8');

  return {
    mdPath,
    cleanup: async () => {
      await fs.rm(baseDir, { recursive: true, force: true });
    },
  };
}

function sanitizeForFs(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, '_');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveUploadTarget(
  upload: string | null | undefined,
  provider: BatchBackendConfig['storage']['provider'],
): 's3' | undefined {
  if (upload === 'none') {
    return undefined;
  }
  if (upload === 's3') {
    return 's3';
  }
  if (upload === 'auto' || upload == null) {
    return provider === 'filesystem' ? undefined : 's3';
  }
  return undefined;
}
