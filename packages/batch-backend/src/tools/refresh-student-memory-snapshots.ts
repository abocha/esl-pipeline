import type { GenerationProvider } from '@esl-pipeline/contracts';

import {
  listStudentMemorySnapshotBackfillTargets,
  requestStudentMemorySnapshotBackfill,
  resolveStudentMemorySnapshotBackfillCandidate,
  type StudentMemorySnapshotBackfillSelection,
} from '../application/student-memory-snapshot-backfill.js';
import type { StudentMemorySnapshotRefreshStrategy } from '../application/student-memory-snapshot-generation-notes.js';
import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { loadConfig } from '../config/env.js';
import { cancelMemoryReplayIntent } from '../domain/memory-replay-delivery.js';
import { closeStudentMemoryQueue } from '../infrastructure/student-memory-queue.js';

type ManualSnapshotRefreshStrategy = Extract<
  StudentMemorySnapshotRefreshStrategy,
  'manual_rebuild_v1_1' | 'full_rebuild_v1'
>;

interface CliOptions {
  limit: number;
  selection: StudentMemorySnapshotBackfillSelection;
  strategy: ManualSnapshotRefreshStrategy;
  reason?: string;
  provider?: GenerationProvider;
  model?: string;
  studentId?: string;
  requestCandidateRefresh: boolean;
  dryRun: boolean;
  replayKey?: string;
  cancelIntent?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: 80,
    selection: 'missing',
    strategy: 'manual_rebuild_v1_1',
    requestCandidateRefresh: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--replay-key' || arg === '--cancel-intent') {
      const value = argv[++index]?.trim();
      if (!value) throw new Error(`Missing value for ${arg}`);
      if (arg === '--replay-key') options.replayKey = value;
      else options.cancelIntent = value;
      continue;
    }
    if (!arg || arg === '--') {
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--candidate-refresh') {
      options.requestCandidateRefresh = true;
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

    if (arg === '--strategy') {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error('Missing value for --strategy');
      }
      if (value !== 'manual_rebuild_v1_1' && value !== 'full_rebuild_v1') {
        throw new Error('Invalid --strategy. Use manual_rebuild_v1_1 or full_rebuild_v1');
      }
      options.strategy = value;
      index += 1;
      continue;
    }

    if (arg === '--reason') {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error('Missing value for --reason');
      }
      options.reason = value;
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

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printDryRunTargets(
  targets: Awaited<ReturnType<typeof listStudentMemorySnapshotBackfillTargets>>,
) {
  for (const target of targets) {
    console.log(
      [
        '[student-memory-snapshot-refresh][dry-run]',
        `student=${target.studentId}`,
        `latestMemoryAt=${target.latestMemoryAt}`,
        `hasReadySnapshot=${target.hasReadySnapshot}`,
        `latestReadySnapshotAt=${target.latestReadySnapshotAt ?? 'none'}`,
      ].join(' '),
    );
  }
}

async function run(): Promise<void> {
  loadBatchBackendEnv(import.meta.url, 'batch-backend-tool-refresh-student-memory-snapshots');
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
        ? '[snapshot] cancellation dry run'
        : await cancelMemoryReplayIntent({
            family: 'snapshot',
            studentId: options.studentId,
            pendingEntryId: options.cancelIntent,
            reason: options.reason,
          }),
    );
    return;
  }
  if (!options.dryRun && !options.replayKey)
    throw new Error('--replay-key is required; reuse it to resume, change it for new regeneration');

  const candidate = resolveStudentMemorySnapshotBackfillCandidate({
    config,
    providerOverride: options.provider,
    modelOverride: options.model,
  });
  if (!options.dryRun && !options.reason?.trim()) {
    throw new Error('--reason is required when requesting manual student-memory snapshot replay');
  }

  const targets = await listStudentMemorySnapshotBackfillTargets({
    limit: options.limit,
    selection: options.selection,
    studentId: options.studentId,
  });

  if (targets.length === 0) {
    console.log(
      '[student-memory-snapshot-refresh] no students with canonical memory matched the requested scope',
    );
    return;
  }

  if (options.dryRun) {
    printDryRunTargets(targets);
    console.log(
      `[student-memory-snapshot-refresh] provider=${candidate.provider} model=${candidate.model}`,
    );
    console.log(
      `[student-memory-snapshot-refresh] strategy=${options.strategy} reason=${options.reason ?? 'none'}`,
    );
    console.log(
      `[student-memory-snapshot-refresh] candidateRefresh=${options.requestCandidateRefresh}`,
    );
    console.log(
      `[student-memory-snapshot-refresh] selection=${options.selection} processed=${targets.length} requested=0`,
    );
    console.log('[student-memory-snapshot-refresh] dryRun=true');
    return;
  }

  const result = await requestStudentMemorySnapshotBackfill({
    replayKey: options.replayKey!,
    config,
    targets,
    strategy: options.strategy,
    operatorReason: options.reason?.trim() ?? '',
    requestCandidateRefresh: options.requestCandidateRefresh,
    providerOverride: options.provider,
    modelOverride: options.model,
  });

  console.log(
    `[student-memory-snapshot-refresh] provider=${candidate.provider} model=${candidate.model}`,
  );
  console.log(
    `[student-memory-snapshot-refresh] strategy=${options.strategy} reason=${options.reason}`,
  );
  console.log(
    `[student-memory-snapshot-refresh] candidateRefresh=${options.requestCandidateRefresh}`,
  );
  console.log(
    `[student-memory-snapshot-refresh] selection=${options.selection} processed=${targets.length} requested=${result.requested}`,
  );
  console.log('[student-memory-snapshot-refresh] dryRun=false');
}

void run()
  .finally(() => closeStudentMemoryQueue())
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[student-memory-snapshot-refresh] failed: ${message}`);
    process.exitCode = 1;
  });
