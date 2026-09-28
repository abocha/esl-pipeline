import type { FindStudentResultDto } from '@esl-pipeline/contracts';

import { withPgClient } from '../infrastructure/db.js';

const MAX_CANDIDATES = 5;

/** Search only active learners in the credential-bound workspace. */
export async function findStudent(args: {
  workspaceId: string;
  name: string;
}): Promise<FindStudentResultDto> {
  const name = args.name.trim();
  if (!name || name.length > 100) return { status: 'none', candidates: [], hasMore: false };
  const rows = await withPgClient(async (client) => {
    const result = await client.query<{ id: string; student: string }>(
      `SELECT id, student FROM students
       WHERE workspace_id = $1::uuid AND archived_at IS NULL
         AND position(lower($2) in lower(student)) > 0
       ORDER BY CASE WHEN lower(student) = lower($2) THEN 0
                     WHEN lower(student) LIKE lower($2) || '%' THEN 1 ELSE 2 END,
                lower(student), id
       LIMIT $3`,
      [args.workspaceId, name, MAX_CANDIDATES + 1],
    );
    return result.rows;
  });
  const candidates = rows.slice(0, MAX_CANDIDATES).map((row) => ({
    studentId: row.id,
    name: row.student,
  }));
  return {
    status: candidates.length === 0 ? 'none' : candidates.length === 1 ? 'single' : 'ambiguous',
    candidates,
    hasMore: rows.length > MAX_CANDIDATES,
  };
}
