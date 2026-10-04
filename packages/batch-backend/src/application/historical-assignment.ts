import type { PoolClient } from 'pg';

import type { AssignmentSessionRecord } from '../domain/assignment-session-model.js';
import { withPgClient } from '../infrastructure/db.js';

/** ABO-30: historical Markdown is evidence, never executable assignment authority. */
export const HISTORICAL_ASSIGNMENT_ERROR = 'legacy_assignment_read_only';
export class HistoricalAssignmentReadOnlyError extends Error {
  readonly code = HISTORICAL_ASSIGNMENT_ERROR;
  readonly statusCode = 410;
  constructor() {
    super(
      'Historical Markdown assignments are read-only. Create a new AssignmentV1 assignment to process new work.',
    );
    this.name = 'HistoricalAssignmentReadOnlyError';
  }
}
export function requireTypedAssignment(artifact: unknown): asserts artifact {
  if (!artifact) throw new HistoricalAssignmentReadOnlyError();
}

export async function isHistoricalAssignmentSession(
  session: AssignmentSessionRecord,
  client?: PoolClient,
): Promise<boolean> {
  if (session.confirmed.create && !session.confirmed.create.artifact) return true;
  if (!session.draftId && !session.promptPackageId) return false;
  const read = async (connection: PoolClient) => {
    const result = await connection.query<{ historical: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM drafts WHERE id = $1 AND format <> 'assignment_v1')
        OR EXISTS (SELECT 1 FROM prompt_packages WHERE id = $2
          AND (request_envelope ->> 'promptVersion') IS DISTINCT FROM 'assignment_v1') AS historical`,
      [session.draftId, session.promptPackageId],
    );
    return result.rows[0]?.historical === true;
  };
  return client ? read(client) : withPgClient(read);
}
export async function isHistoricalAssignmentSessionId(sessionId: string): Promise<boolean> {
  return withPgClient(async (client) => {
    const result = await client.query<{ historical: boolean }>(
      `SELECT historical_assignment_session(s) AS historical FROM assignment_sessions s WHERE id = $1`,
      [sessionId],
    );
    return result.rows[0]?.historical === true;
  });
}
