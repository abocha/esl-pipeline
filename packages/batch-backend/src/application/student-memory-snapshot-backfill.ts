import type { GenerationProvider } from '@esl-pipeline/contracts';
import type { PoolClient } from 'pg';

import type { BatchBackendConfig } from '../config/env.js';
import { withPgClient } from '../infrastructure/db.js';
import { resolveGenerationCandidates } from './generation-policy.js';
import { requestStudentMemorySnapshotRefresh } from './request-student-memory-snapshot-refresh.js';

export type StudentMemorySnapshotBackfillSelection = 'missing' | 'failed' | 'all';

interface StudentMemorySnapshotCandidateRow {
  student_id: string;
  latest_memory_at: Date;
  has_ready_snapshot: boolean;
  latest_ready_snapshot_at: Date | null;
}

export interface StudentMemorySnapshotBackfillTarget {
  studentId: string;
  latestMemoryAt: string;
  hasReadySnapshot: boolean;
  latestReadySnapshotAt: string | null;
}

export async function listStudentMemorySnapshotBackfillTargets(args: {
  limit: number;
  selection: StudentMemorySnapshotBackfillSelection;
  studentId?: string;
}): Promise<StudentMemorySnapshotBackfillTarget[]> {
  const rows = await listSnapshotReplayCandidates(args);
  return rows.map((row) => ({
    studentId: row.student_id,
    latestMemoryAt: row.latest_memory_at.toISOString(),
    hasReadySnapshot: row.has_ready_snapshot,
    latestReadySnapshotAt: row.latest_ready_snapshot_at
      ? row.latest_ready_snapshot_at.toISOString()
      : null,
  }));
}

export async function requestStudentMemorySnapshotBackfill(args: {
  config: BatchBackendConfig;
  targets: StudentMemorySnapshotBackfillTarget[];
  providerOverride?: GenerationProvider;
  modelOverride?: string;
}): Promise<{
  requested: number;
}> {
  let requested = 0;

  for (const target of args.targets) {
    await requestStudentMemorySnapshotRefresh({
      config: args.config,
      params: {
        studentId: target.studentId,
        trigger: 'manual-replay',
        providerOverride: args.providerOverride,
        modelOverride: args.modelOverride,
      },
    });
    requested += 1;
  }

  return { requested };
}

export function resolveStudentMemorySnapshotBackfillCandidate(args: {
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
    throw new Error('No generation candidate is available for student-memory snapshot refresh');
  }

  return candidate;
}

async function listSnapshotReplayCandidates(args: {
  limit: number;
  selection: StudentMemorySnapshotBackfillSelection;
  studentId?: string;
}): Promise<StudentMemorySnapshotCandidateRow[]> {
  return withPgClient(async (client: PoolClient) => {
    const values: (string | number)[] = [];
    const filters: string[] = [];

    if (args.studentId) {
      values.push(args.studentId);
      filters.push(`memory.student_id = $${values.length}`);
    }

    if (args.selection === 'missing') {
      filters.push(
        '(snapshot.has_ready_snapshot = false OR snapshot.latest_ready_snapshot_at IS NULL OR snapshot.latest_ready_snapshot_at < memory.latest_memory_at)',
      );
    } else if (args.selection === 'failed') {
      filters.push('snapshot.has_failed_snapshot = true');
    }

    values.push(args.limit);
    const limitParam = values.length;
    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    const result = await client.query<StudentMemorySnapshotCandidateRow>(
      `
      WITH memory AS (
        SELECT
          student_id,
          MAX(generated_at) AS latest_memory_at
        FROM (
          SELECT student_id, generated_at
          FROM lesson_memory_entries
          WHERE status = 'ready'
          UNION ALL
          SELECT student_id, generated_at
          FROM homework_memory_entries
          WHERE status = 'ready'
        ) ready_memory
        GROUP BY student_id
      ),
      snapshot AS (
        SELECT
          student_id,
          BOOL_OR(status = 'ready') AS has_ready_snapshot,
          BOOL_OR(status = 'failed') AS has_failed_snapshot,
          MAX(generated_at) FILTER (WHERE status = 'ready') AS latest_ready_snapshot_at
        FROM student_memory_snapshots
        GROUP BY student_id
      )
      SELECT
        memory.student_id,
        memory.latest_memory_at,
        COALESCE(snapshot.has_ready_snapshot, false) AS has_ready_snapshot,
        snapshot.latest_ready_snapshot_at
      FROM memory
      LEFT JOIN snapshot ON snapshot.student_id = memory.student_id
      ${whereClause}
      ORDER BY memory.latest_memory_at DESC, memory.student_id DESC
      LIMIT $${limitParam}
      `,
      values,
    );

    return result.rows;
  });
}
