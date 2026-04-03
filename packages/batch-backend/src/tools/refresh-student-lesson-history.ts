import type { PoolClient } from 'pg';

import type { GenerationProvider } from '@esl-pipeline/contracts';

import { resolveGenerationCandidates } from '../application/generation-policy.js';
import { requestLessonMemoryGeneration } from '../application/request-lesson-memory-generation.js';
import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { type BatchBackendConfig, loadConfig } from '../config/env.js';
import { withPgClient } from '../infrastructure/db.js';

interface ReplayTargetRow {
  transcript_id: string;
  recording_id: string;
  student_id: string;
  created_at: Date;
  has_ready: boolean;
  has_pending: boolean;
  has_failed: boolean;
}

type SelectionMode = 'missing' | 'failed' | 'all';

interface CliOptions {
  limit: number;
  selection: SelectionMode;
  provider?: GenerationProvider;
  model?: string;
  studentId?: string;
  transcriptId?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: 80,
    selection: 'missing',
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
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

    if (arg === '--transcript-id') {
      const value = argv[index + 1]?.trim();
      if (!value) {
        throw new Error('Missing value for --transcript-id');
      }
      options.transcriptId = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function listReplayTargets(args: {
  selection: SelectionMode;
  limit: number;
  studentId?: string;
  transcriptId?: string;
}): Promise<ReplayTargetRow[]> {
  return withPgClient(async (client: PoolClient) => {
    const values: (string | number)[] = [];
    const whereClauses = ['r.student_id IS NOT NULL'];

    if (args.studentId) {
      values.push(args.studentId);
      whereClauses.push(`r.student_id = $${values.length}`);
    }

    if (args.transcriptId) {
      values.push(args.transcriptId);
      whereClauses.push(`t.id = $${values.length}`);
    }

    if (!args.transcriptId) {
      if (args.selection === 'missing') {
        whereClauses.push(`NOT EXISTS (
          SELECT 1
          FROM lesson_memory_entries lme
          WHERE lme.transcript_id = t.id
            AND lme.status = 'ready'
        )`);
      } else if (args.selection === 'failed') {
        whereClauses.push(
          `NOT EXISTS (
            SELECT 1
            FROM lesson_memory_entries lme
            WHERE lme.transcript_id = t.id
              AND lme.status = 'ready'
          )`,
          `EXISTS (
            SELECT 1
            FROM lesson_memory_entries lme
            WHERE lme.transcript_id = t.id
              AND lme.status = 'failed'
          )`,
        );
      }
    }

    values.push(args.limit);
    const limitParam = values.length;

    const result = await client.query<ReplayTargetRow>(
      `
      SELECT
        t.id AS transcript_id,
        t.recording_id,
        r.student_id,
        t.created_at,
        EXISTS (
          SELECT 1
          FROM lesson_memory_entries lme
          WHERE lme.transcript_id = t.id
            AND lme.status = 'ready'
        ) AS has_ready,
        EXISTS (
          SELECT 1
          FROM lesson_memory_entries lme
          WHERE lme.transcript_id = t.id
            AND lme.status = 'pending'
        ) AS has_pending,
        EXISTS (
          SELECT 1
          FROM lesson_memory_entries lme
          WHERE lme.transcript_id = t.id
            AND lme.status = 'failed'
        ) AS has_failed
      FROM transcripts t
      INNER JOIN recordings r ON r.id = t.recording_id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $${limitParam}
      `,
      values,
    );

    return result.rows;
  });
}

function resolveModel(config: BatchBackendConfig, provider: GenerationProvider): string {
  return (
    resolveGenerationCandidates({
      config: config.generation,
      workload: 'student_memory_extraction',
      providerOverride: provider,
    })[0]?.model ?? 'openai/gpt-4o-mini'
  );
}

async function run(): Promise<void> {
  loadBatchBackendEnv(import.meta.url, 'batch-backend-tool-refresh-lesson-memory');
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();

  if (!config.pg.enabled) {
    throw new Error('PG_ENABLED=true is required');
  }

  const provider = options.provider ?? config.generation.defaultProvider;
  const model = options.model ?? resolveModel(config, provider);
  const targets = await listReplayTargets({
    selection: options.selection,
    limit: options.limit,
    studentId: options.studentId,
    transcriptId: options.transcriptId,
  });

  if (targets.length === 0) {
    console.log('[lesson-memory-refresh] no transcripts matched the requested scope');
    return;
  }

  let requested = 0;
  let readyExists = 0;
  let pendingExists = 0;

  for (const target of targets) {
    if (options.dryRun) {
      console.log(
        [
          '[lesson-memory-refresh][dry-run]',
          `transcript=${target.transcript_id}`,
          `recording=${target.recording_id}`,
          `student=${target.student_id}`,
          `hasReady=${target.has_ready}`,
          `hasPending=${target.has_pending}`,
          `hasFailed=${target.has_failed}`,
        ].join(' '),
      );
      continue;
    }

    const result = await requestLessonMemoryGeneration({
      config,
      params: {
        studentId: target.student_id,
        transcriptId: target.transcript_id,
        recordingId: target.recording_id,
        trigger: 'replay',
        providerOverride: provider,
        modelOverride: model,
      },
    });

    if (!result) {
      continue;
    }

    if (result.outcome === 'ready_exists') {
      readyExists += 1;
      continue;
    }

    if (result.outcome === 'pending_exists') {
      pendingExists += 1;
      continue;
    }

    requested += 1;
  }

  console.log(`[lesson-memory-refresh] provider=${provider} model=${model}`);
  console.log(
    `[lesson-memory-refresh] selection=${options.selection} processed=${targets.length} requested=${requested} readyExists=${readyExists} pendingExists=${pendingExists}`,
  );
  console.log(`[lesson-memory-refresh] dryRun=${options.dryRun}`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[lesson-memory-refresh] failed: ${message}`);
  process.exitCode = 1;
});
