import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import { buildCanonicalLessonMemoryAuthoritySqlPredicate } from './lesson-memory-repository.js';

export interface StudentMemoryCurrentness {
  sourceState: string;
  latestReadySnapshotId: string | null;
}

// Caller holds the student lock. Canonical memory writes acquire that same lock
// through migration 0061; no contributing-row locks (and inverted lock order) are needed.
export async function readStudentMemoryCurrentness(
  client: PoolClient,
  studentId: string,
): Promise<StudentMemoryCurrentness> {
  const sources = await client.query(
    `SELECT 'lesson' AS kind, id, updated_at::text, source_content_hash AS hash
     FROM lesson_memory_entries
     WHERE student_id = $1 AND status = 'ready' AND source_content_hash IS NOT NULL
       AND ${buildCanonicalLessonMemoryAuthoritySqlPredicate('lesson_memory_entries')}
     UNION ALL
     SELECT 'homework', id, updated_at::text, content_hash
     FROM homework_memory_entries WHERE student_id = $1 AND status = 'ready'
     ORDER BY kind, id`,
    [studentId],
  );
  const latest = await client.query<{ id: string }>(
    `SELECT id FROM student_memory_snapshots WHERE student_id = $1 AND status = 'ready'
     ORDER BY generated_at DESC, created_at DESC, id DESC LIMIT 1`,
    [studentId],
  );
  return {
    sourceState: createHash('sha256').update(JSON.stringify(sources.rows)).digest('hex'),
    latestReadySnapshotId: latest.rows[0]?.id ?? null,
  };
}

export async function captureStudentMemoryCurrentness(studentId: string) {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query('SELECT id FROM students WHERE id = $1 FOR UPDATE', [studentId]);
      const state = await readStudentMemoryCurrentness(client, studentId);
      await client.query('COMMIT');
      return state;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
