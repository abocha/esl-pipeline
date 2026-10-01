import type { PoolClient } from 'pg';

import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import { buildEligibleStudentMemorySnapshotLineageSqlPredicate } from '../domain/student-memory-snapshot-repository.js';
import { withPgClient } from '../infrastructure/db.js';
import { resolveGenerationTarget } from './generation-policy.js';
import { requestStudentMemorySnapshotRefresh } from './request-student-memory-snapshot-refresh.js';
import type { StudentMemorySnapshotRefreshStrategy } from './student-memory-snapshot-generation-notes.js';

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
  strategy: Extract<
    StudentMemorySnapshotRefreshStrategy,
    'manual_rebuild_v1_1' | 'full_rebuild_v1'
  >;
  operatorReason: string;
  requestCandidateRefresh?: boolean;
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
        strategy: args.strategy,
        operatorReason: args.operatorReason,
        requestCandidateRefresh: args.requestCandidateRefresh === true,
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
  const target = resolveGenerationTarget({
    config: args.config.generation,
    workload: 'student_memory_snapshot',
    providerOverride: args.providerOverride,
    modelOverride: args.modelOverride,
  });

  return target;
}

async function listSnapshotReplayCandidates(args: {
  limit: number;
  selection: StudentMemorySnapshotBackfillSelection;
  studentId?: string;
}): Promise<StudentMemorySnapshotCandidateRow[]> {
  const eligibleLineage = buildEligibleStudentMemorySnapshotLineageSqlPredicate('snapshot_row');
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
          snapshot_row.student_id,
          BOOL_OR(
            snapshot_row.status = 'ready'
            AND ${eligibleLineage}
          ) AS has_ready_snapshot,
          BOOL_OR(snapshot_row.status = 'failed') AS has_failed_snapshot,
          MAX(snapshot_row.generated_at) FILTER (
            WHERE snapshot_row.status = 'ready'
              AND ${eligibleLineage}
          ) AS latest_ready_snapshot_at
        FROM student_memory_snapshots AS snapshot_row
        GROUP BY snapshot_row.student_id
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
