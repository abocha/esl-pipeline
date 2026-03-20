import type { GenerationProvider } from '@esl-pipeline/contracts';
import type { PoolClient } from 'pg';

import type { BatchBackendConfig } from '../config/env.js';
import { withPgClient } from '../infrastructure/db.js';
import { resolveGenerationCandidates } from './generation-policy.js';
import { requestHomeworkMemoryGeneration } from './request-homework-memory-generation.js';

export type HomeworkMemoryBackfillSelection = 'missing' | 'failed' | 'all';

interface HomeworkReplayCandidateRow {
  job_id: string;
  student_id: string;
  state: string;
  finished_at: Date | null;
  updated_at: Date;
}

export interface HomeworkMemoryBackfillTarget {
  jobId: string;
  studentId: string;
  publishedAt: string;
}

export interface HomeworkMemoryBackfillTargetWithDecision extends HomeworkMemoryBackfillTarget {
  selectionReason: HomeworkMemoryBackfillSelection;
}

export async function listHomeworkMemoryBackfillTargets(args: {
  limit: number;
  selection: HomeworkMemoryBackfillSelection;
  studentId?: string;
  jobId?: string;
}): Promise<HomeworkMemoryBackfillTargetWithDecision[]> {
  const rows = await listSucceededHomeworkReplayCandidates(args);

  return rows.map((row) => ({
    jobId: row.job_id,
    studentId: row.student_id,
    publishedAt: (row.finished_at ?? row.updated_at).toISOString(),
    selectionReason: args.selection,
  }));
}

export async function requestHomeworkMemoryBackfill(args: {
  config: BatchBackendConfig;
  targets: HomeworkMemoryBackfillTarget[];
  providerOverride?: GenerationProvider;
  modelOverride?: string;
  forceRegenerate?: boolean;
}): Promise<{
  requested: number;
}> {
  let requested = 0;

  for (const target of args.targets) {
    await requestHomeworkMemoryGeneration({
      config: args.config,
      params: {
        jobId: target.jobId,
        studentId: target.studentId,
        providerOverride: args.providerOverride,
        modelOverride: args.modelOverride,
        forceRegenerate: args.forceRegenerate ?? false,
      },
    });
    requested += 1;
  }

  return { requested };
}

export function resolveHomeworkMemoryBackfillCandidate(args: {
  config: BatchBackendConfig;
  providerOverride?: GenerationProvider;
  modelOverride?: string;
}): { provider: GenerationProvider; model: string } {
  const candidate = resolveGenerationCandidates({
    config: args.config.generation,
    providerOverride: args.providerOverride,
    modelOverride: args.modelOverride,
  })[0];

  if (!candidate) {
    throw new Error('No generation candidate is available for homework-memory backfill');
  }

  return candidate;
}

async function listSucceededHomeworkReplayCandidates(args: {
  limit: number;
  selection: HomeworkMemoryBackfillSelection;
  studentId?: string;
  jobId?: string;
}): Promise<HomeworkReplayCandidateRow[]> {
  return withPgClient(async (client: PoolClient) => {
    const values: Array<string | number> = [];
    const filters = [
      `j.state = 'succeeded'`,
      'j.student_id IS NOT NULL',
      '(j.md IS NOT NULL OR j.md_storage_uri IS NOT NULL)',
    ];

    if (args.studentId) {
      values.push(args.studentId);
      filters.push(`j.student_id = $${values.length}`);
    }

    if (args.jobId) {
      values.push(args.jobId);
      filters.push(`j.id = $${values.length}`);
    }

    if (args.selection === 'missing') {
      filters.push(
        `NOT EXISTS (
          SELECT 1
          FROM homework_memory_entries hme
          WHERE hme.job_id = j.id
            AND hme.status = 'ready'
        )`,
      );
    } else if (args.selection === 'failed') {
      filters.push(
        `EXISTS (
          SELECT 1
          FROM homework_memory_entries hme
          WHERE hme.job_id = j.id
            AND hme.status = 'failed'
        )`,
      );
    }

    values.push(args.limit);
    const limitParam = values.length;

    const result = await client.query<HomeworkReplayCandidateRow>(
      `
      SELECT
        j.id AS job_id,
        j.student_id,
        j.state,
        j.finished_at,
        j.updated_at
      FROM jobs j
      WHERE ${filters.join(' AND ')}
      ORDER BY COALESCE(j.finished_at, j.updated_at) DESC, j.id DESC
      LIMIT $${limitParam}
      `,
      values,
    );

    return result.rows;
  });
}
