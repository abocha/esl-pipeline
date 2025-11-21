// packages/batch-backend/src/application/process-queue-job.ts
// Application service executed by the BullMQ worker.
// Flow:
// 1. Load job from DB.
// 2. If not found or already terminal -> no-op.
// 3. Transition queued -> running.
// 4. Call ESL pipeline via runAssignmentJob.
// 5. On success, transition running -> succeeded with manifestPath.
// 6. On failure, transition running -> failed with error and rethrow so BullMQ can retry.
import fs from 'node:fs/promises';
import path from 'node:path';

import { type BatchBackendConfig, loadConfig } from '../config/env.js';
import { publishJobEvent } from '../domain/job-events.js';
import { getJobById, updateJobStateAndResult } from '../domain/job-repository.js';
import { createJobLogger } from '../infrastructure/logger.js';
import { runAssignmentJob } from '../infrastructure/orchestrator-service.js';
import type { QueueJobPayload } from '../infrastructure/queue-bullmq.js';

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

  try {
    const resolvedMdPath = await resolveMarkdownPath(running.md);
    if (resolvedMdPath !== running.md) {
      log.info('Resolved markdown path for job', {
        original: running.md,
        resolved: resolvedMdPath,
      });
    }

    const config = loadConfig();
    const uploadFlag = resolveUploadTarget(running.upload, config.storage.provider);

    const result = await runAssignmentJob(
      {
        jobId,
        md: resolvedMdPath,
        preset: running.preset ?? undefined,
        withTts: running.withTts ?? undefined,
        // Only forward upload flag values supported by orchestrator.
        // Any other persisted value (e.g. 'none' or null) is treated as "no override".
        upload: uploadFlag,
        forceTts: running.forceTts ?? undefined,
        notionDatabase: running.notionDatabase ?? undefined,
        mode: running.mode ?? undefined,
      },
      runId,
    );

    const succeeded = await updateJobStateAndResult({
      id: jobId,
      expectedState: 'running',
      nextState: 'succeeded',
      manifestPath: result.manifestPath ?? null,
      notionUrl: result.notionUrl ?? null,
      finishedAt: new Date(),
    });

    if (succeeded) {
      publishJobEvent({ type: 'job_state_changed', job: succeeded });
    }

    log.info('Job processed successfully', {
      manifestPath: result.manifestPath,
    });
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
    }

    // Propagate so BullMQ can apply retry/backoff policy.
    throw error;
  }
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
