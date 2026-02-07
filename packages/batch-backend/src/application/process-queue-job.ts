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

import { type BatchBackendConfig, loadConfig } from '../config/env.js';
import { publishJobEvent } from '../domain/job-events.js';
import { getJobById, updateJobStateAndResult } from '../domain/job-repository.js';
import {
  getDecryptedElevenLabsKey,
  getDecryptedNotionToken,
  getSettingsByUserId,
} from '../domain/settings-repository.js';
import { createJobLogger } from '../infrastructure/logger.js';
import {
  runAssignmentJob,
  runRerunAssignmentJob,
} from '../infrastructure/orchestrator-service.js';
import {
  registerRunningJob,
  unregisterRunningJob,
} from '../infrastructure/job-cancellation.js';
import type { QueueJobPayload } from '../infrastructure/queue-bullmq.js';
import { createTranscriptionStorageForUri } from '../infrastructure/transcription-storage.js';

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
    const config = loadConfig();

    const markdownInput = await resolveMarkdownInput(running);

    const uploadFlag = resolveUploadTarget(running.upload, config.storage.provider);

    // Fetch user settings if job is linked to a user
    let userSettings: { elevenLabsApiKey?: string | null; notionToken?: string | null } | undefined;
    if (running.userId) {
      const settings = await getSettingsByUserId(running.userId);
      if (settings) {
        const elevenLabsApiKey = await getDecryptedElevenLabsKey(running.userId);
        const notionToken = await getDecryptedNotionToken(running.userId);

        if (elevenLabsApiKey || notionToken) {
          userSettings = {
            elevenLabsApiKey: elevenLabsApiKey ?? null,
            notionToken: notionToken ?? null,
          };
          log.info('Using user-specific settings for job', {
            userId: running.userId,
            hasElevenLabsKey: !!elevenLabsApiKey,
            hasNotionToken: !!notionToken,
          });
        }
      }
    }

    let result: { manifestPath?: string; notionUrl?: string; anytypeUrl?: string };
    try {
      result =
        payload.executionMode === 'rerun_audio'
          ? await runRerunAssignmentJob(
              {
                jobId,
                md: markdownInput.mdPath,
                steps: payload.rerun?.steps ?? ['tts', 'upload', 'add-audio'],
                upload: payload.rerun?.upload ?? 's3',
                force: payload.rerun?.force ?? running.forceTts ?? true,
                prefix: payload.rerun?.prefix,
                publicRead: payload.rerun?.publicRead,
                presign: payload.rerun?.presign,
                accentPreference:
                  payload.rerun?.accentPreference ?? running.voiceAccent ?? undefined,
                voiceId: payload.rerun?.voiceId ?? running.voiceId ?? undefined,
                ttsStrategy: payload.rerun?.ttsStrategy ?? running.ttsStrategy ?? undefined,
                dialogueLanguage: payload.rerun?.dialogueLanguage,
                dialogueStability: payload.rerun?.dialogueStability,
                dialogueSeed: payload.rerun?.dialogueSeed,
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
                withTts: running.withTts ?? undefined,
                // Only forward upload flag values supported by orchestrator.
                // Any other persisted value (e.g. 'none' or null) is treated as "no override".
                upload: uploadFlag,
                forceTts: running.forceTts ?? undefined,
                notionDatabase:
                  running.notionDatabase ?? config.orchestrator.notionDatabaseId ?? undefined,
                publishTarget: running.publishTarget ?? undefined,
                ttsStrategy: running.ttsStrategy ?? undefined,
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

    const succeeded = await updateJobStateAndResult({
      id: jobId,
      expectedState: 'running',
      nextState: 'succeeded',
      manifestPath: result.manifestPath ?? null,
      notionUrl: result.notionUrl ?? null,
      anytypeUrl: result.anytypeUrl ?? null,
      finishedAt: new Date(),
    });

    if (succeeded) {
      publishJobEvent({ type: 'job_state_changed', job: succeeded });
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

async function resolveMarkdownPath(mdPath: string): Promise<string> {
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

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Markdown file not found: ${sanitized}`);
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
