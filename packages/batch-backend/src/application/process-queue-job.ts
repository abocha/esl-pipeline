// packages/batch-backend/src/application/process-queue-job.ts
// Application service executed by the BullMQ worker.
// Flow:
// 1. Load job from DB.
// 2. If not found or already terminal -> no-op.
// 3. Transition queued -> running.
// 4. If prompt assembly is needed, run ttdg + assemble prompt, then mark awaiting_approval.
// 5. If approved markdown is present, call ESL pipeline via runAssignmentJob.
// 6. On success, transition running -> succeeded with manifestPath.
// 7. On failure, transition running -> failed with error and rethrow so BullMQ can retry.
import fs from 'node:fs/promises';
import path from 'node:path';

import { type BatchBackendConfig, loadConfig } from '../config/env.js';
import { publishJobEvent } from '../domain/job-events.js';
import { getJobById, updateJobPromptData, updateJobStateAndResult } from '../domain/job-repository.js';
import {
  getDecryptedElevenLabsKey,
  getDecryptedNotionToken,
  getSettingsByUserId,
} from '../domain/settings-repository.js';
import { createJobLogger } from '../infrastructure/logger.js';
import { runAssignmentJob } from '../infrastructure/orchestrator-service.js';
import { runTtdg } from '../infrastructure/ttdg-runner.js';
import type { QueueJobPayload } from '../infrastructure/queue-bullmq.js';
import { assemblePromptPayload, resolveRepoPath } from './prompt-assembly.js';
import { resolveProfileRoot, resolveUserProfilePath } from './profile-path.js';

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

  try {
    const config = loadConfig();

    if (running.transcribeWorkdir && !running.promptPayload && !running.transcriptPath) {
      const ttdgInvocation = resolveTtdgInvocation({
        requestedWorkdir: running.transcribeWorkdir,
        recordingsRoot: config.ttdg.recordingsRoot,
        baseExtraArgs: config.ttdg.extraArgs,
      });

      const ttdgResult = await runTtdg({
        command: config.ttdg.runCommand,
        workdir: ttdgInvocation.workdir,
        cwd: config.ttdg.runCwd,
        extraArgs: ttdgInvocation.extraArgs,
      });

      if (ttdgResult.outputs.length === 0) {
        throw new Error('ttdg did not produce any transcript outputs');
      }

      if (ttdgResult.outputs.length > 1) {
        throw new Error(
          `ttdg produced multiple transcripts (${ttdgResult.outputs.length}); narrow the workdir or pattern`,
        );
      }

      const transcriptPath = ttdgResult.outputs[0] ?? '';
      const templatePath = resolvePromptPath(config.prompt.templatePath);
      const profileRoot = await resolveProfileRoot(config.prompt.defaultProfilePath);
      const profilePath = running.profilePath
        ? await resolveUserProfilePath(running.profilePath, profileRoot)
        : resolvePromptPath(config.prompt.defaultProfilePath);

      const prompt = await assemblePromptPayload({
        templatePath,
        profilePath,
        transcriptPath,
        notes: running.promptNotes ?? undefined,
      });

      const awaiting = await updateJobPromptData({
        id: jobId,
        expectedState: 'running',
        nextState: 'awaiting_approval',
        transcriptPath,
        promptPayload: prompt.payload,
        promptNotes: running.promptNotes ?? null,
        profilePath,
      });

      if (awaiting) {
        publishJobEvent({ type: 'job_state_changed', job: awaiting });
      }

      log.info('Prompt package assembled; awaiting approval', {
        transcriptPath,
        templatePath,
        profilePath,
        ttdgWorkdir: ttdgInvocation.workdir,
        ttdgPattern: ttdgInvocation.pattern,
      });

      return;
    }

    if (!running.md) {
      throw new Error('Job is missing an approved markdown path');
    }

    const resolvedMdPath = await resolveMarkdownPath(running.md);
    if (resolvedMdPath !== running.md) {
      log.info('Resolved markdown path for job', {
        original: running.md,
        resolved: resolvedMdPath,
      });
    }

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
        notionDatabase: running.notionDatabase ?? config.orchestrator.notionDatabaseId ?? undefined,
        ttsStrategy: running.ttsStrategy ?? undefined,
        settings: userSettings,
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

function resolvePromptPath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return resolveRepoPath(inputPath);
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

function resolveTtdgInvocation(options: {
  requestedWorkdir: string;
  recordingsRoot: string;
  baseExtraArgs?: string;
}): { workdir: string; extraArgs?: string; pattern?: string } {
  const trimmedRequest = options.requestedWorkdir?.trim();
  const trimmedRoot = options.recordingsRoot?.trim();
  if (!trimmedRequest) {
    return { workdir: '', extraArgs: options.baseExtraArgs };
  }

  const rootResolved = trimmedRoot ? path.resolve(trimmedRoot) : '';
  const requestResolved = path.resolve(
    trimmedRoot && !path.isAbsolute(trimmedRequest)
      ? path.join(trimmedRoot, trimmedRequest)
      : trimmedRequest,
  );

  if (rootResolved && isSubpath(rootResolved, requestResolved) && rootResolved !== requestResolved) {
    const relative = path.relative(rootResolved, requestResolved).replaceAll('\\', '/');
    const pattern = `${relative.replaceAll(/\/+$/g, '')}/**/*.opus`;
    const extraArgs = appendPatternArg(options.baseExtraArgs, pattern);
    return {
      workdir: rootResolved,
      extraArgs,
      pattern,
    };
  }

  return {
    workdir: requestResolved,
    extraArgs: options.baseExtraArgs,
  };
}

function isSubpath(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function appendPatternArg(extraArgs: string | undefined, pattern: string): string {
  const hasPattern =
    typeof extraArgs === 'string' && /(^|\s)(--pattern|-p)(\s|$)/.test(extraArgs);
  if (hasPattern) {
    return extraArgs ?? '';
  }
  const arg = `--pattern "${pattern}"`;
  if (!extraArgs || !extraArgs.trim()) {
    return arg;
  }
  return `${extraArgs.trim()} ${arg}`;
}
