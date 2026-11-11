import type { PoolClient } from 'pg';
import { z } from 'zod';

import { postgresUuidSchema } from './postgres-uuid.js';

export function readProfileWritePrecondition(body: unknown): string | null {
  const parsed = z
    .object({ expectedActiveRevisionId: postgresUuidSchema.nullable().optional() })
    .parse(body ?? {});
  if (parsed.expectedActiveRevisionId === undefined)
    throw new ProfileWriteConflictError('profile_revision_precondition_required', null);
  return parsed.expectedActiveRevisionId;
}

export class ProfileWriteConflictError extends Error {
  constructor(
    readonly code:
      | 'profile_revision_precondition_required'
      | 'profile_revision_conflict'
      | 'profile_change_conflict',
    readonly activeRevisionId: string | null,
    readonly status = code === 'profile_revision_precondition_required' ? 428 : 409,
  ) {
    super(
      code === 'profile_revision_precondition_required'
        ? 'Reload the learner profile before editing. This client did not send its saved revision.'
        : code === 'profile_change_conflict'
          ? 'This field changed after the automatic update. Review the current profile before changing it.'
          : 'The learner profile changed. Your edits have been kept; compare the saved profile before retrying.',
    );
  }
}

/** Call inside the mutation transaction. Source replacement uses the same student lock. */
export async function lockProfileHead(client: PoolClient, studentId: string) {
  await client.query('SELECT id FROM students WHERE id=$1 FOR UPDATE', [studentId]);
  const result = await client.query<{
    id: string;
    content: string;
    content_hash: string;
    structured_content: unknown;
    created_at: Date;
  }>(
    "SELECT id,content,content_hash,structured_content,created_at FROM student_profile_revisions WHERE student_id=$1 AND status='active'",
    [studentId],
  );
  return result.rows[0] ?? null;
}

export function assertProfileHead(expected: string | null | undefined, actual: string | null) {
  if (expected === undefined)
    throw new ProfileWriteConflictError('profile_revision_precondition_required', actual);
  if (expected !== actual) throw new ProfileWriteConflictError('profile_revision_conflict', actual);
}
