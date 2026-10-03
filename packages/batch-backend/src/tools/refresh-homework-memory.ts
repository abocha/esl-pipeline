import type { GenerationProvider } from '@esl-pipeline/contracts';

import {
  type HomeworkMemoryBackfillSelection,
  listHomeworkMemoryBackfillTargets,
  requestHomeworkMemoryBackfill,
  resolveHomeworkMemoryBackfillCandidate,
} from '../application/homework-memory-backfill.js';
import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { loadConfig } from '../config/env.js';
import { cancelMemoryReplayIntent } from '../domain/memory-replay-delivery.js';
import { closeStudentMemoryQueue } from '../infrastructure/student-memory-queue.js';

interface CliOptions {
  limit: number;
  selection: HomeworkMemoryBackfillSelection;
  provider?: GenerationProvider;
  model?: string;
  studentId?: string;
  jobId?: string;
  dryRun: boolean;
  replayKey?: string;
  cancelIntent?: string;
  reason?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: 80,
    selection: 'missing',
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--replay-key' || arg === '--cancel-intent' || arg === '--reason') {
      const value = argv[++index]?.trim();
      if (!value) throw new Error(`Missing value for ${arg}`);
      if (arg === '--replay-key') options.replayKey = value;
      else if (arg === '--cancel-intent') options.cancelIntent = value;
      else options.reason = value;
      continue;
    }
    if (!arg || arg === '--') {
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--limit') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --limit');
      }
      options.limit = Math.max(1, Number.parseInt(value, 10) || 80);
      index += 1;
      continue;
    }

    if (arg === '--selection') {
      const value = argv[index + 1]?.trim().toLowerCase();
      if (!value) {
        throw new Error('Missing value for --selection');
      }
      if (value !== 'missing' && value !== 'failed' && value !== 'all') {
        throw new Error('Invalid --selection. Use missing, failed, or all');
      }
      options.selection = value;
      index += 1;
      continue;
    }

    if (arg === '--provider') {
      const value = argv[index + 1]?.trim().toLowerCase();
      if (!value) {
        throw new Error('Missing value for --provider');
      }
      if (value !== 'openai' && value !== 'google_ai_studio' && value !== 'openrouter') {
        throw new Error('Invalid --provider. Use openai, google_ai_studio, or openrouter');
      }
      options.provider = value;
      index += 1;
      continue;
    }

    if (arg === '--model') {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error('Missing value for --model');
      }
      options.model = value;
      index += 1;
      continue;
    }

    if (arg === '--student-id') {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error('Missing value for --student-id');
      }
      options.studentId = value;
      index += 1;
      continue;
    }

    if (arg === '--job-id') {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error('Missing value for --job-id');
      }
      options.jobId = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printDryRunTargets(
  targets: Awaited<ReturnType<typeof listHomeworkMemoryBackfillTargets>>,
) {
  for (const target of targets) {
    console.log(
      [
        '[homework-memory-refresh][dry-run]',
        `job=${target.jobId}`,
        `student=${target.studentId}`,
        `publishedAt=${target.publishedAt}`,
        `selection=${target.selectionReason}`,
      ].join(' '),
    );
  }
}

async function run(): Promise<void> {
  loadBatchBackendEnv(import.meta.url, 'batch-backend-tool-refresh-homework-memory');
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();

  if (!config.pg.enabled) {
    throw new Error('PG_ENABLED=true is required');
  }
  if (options.cancelIntent) {
    if (!options.studentId || !options.reason)
      throw new Error('--student-id and --reason are required for cancellation');
    console.log(
      options.dryRun
        ? '[homework] cancellation dry run'
        : await cancelMemoryReplayIntent({
            family: 'homework',
            studentId: options.studentId,
            pendingEntryId: options.cancelIntent,
            reason: options.reason,
          }),
    );
    return;
  }
  if (!options.dryRun && !options.replayKey)
    throw new Error('--replay-key is required; reuse it to resume, change it for new regeneration');

  const candidate = resolveHomeworkMemoryBackfillCandidate({
    config,
    providerOverride: options.provider,
    modelOverride: options.model,
  });
  const targets = await listHomeworkMemoryBackfillTargets({
    limit: options.limit,
    selection: options.selection,
    studentId: options.studentId,
    jobId: options.jobId,
  });

  if (targets.length === 0) {
    console.log('[homework-memory-refresh] no succeeded publish jobs matched the requested scope');
    return;
  }

  if (options.dryRun) {
    printDryRunTargets(targets);
    console.log(
      `[homework-memory-refresh] provider=${candidate.provider} model=${candidate.model}`,
    );
    console.log(
      `[homework-memory-refresh] selection=${options.selection} processed=${targets.length} requested=0`,
    );
    console.log('[homework-memory-refresh] dryRun=true');
    return;
  }

  const result = await requestHomeworkMemoryBackfill({
    replayKey: options.replayKey!,
    config,
    targets,
    providerOverride: options.provider,
    modelOverride: options.model,
    forceRegenerate: options.selection !== 'missing',
  });

  console.log(`[homework-memory-refresh] provider=${candidate.provider} model=${candidate.model}`);
  console.log(
    `[homework-memory-refresh] selection=${options.selection} processed=${targets.length} requested=${result.requested}`,
  );
  console.log('[homework-memory-refresh] dryRun=false');
}

void run()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[homework-memory-refresh] failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(closeStudentMemoryQueue);
