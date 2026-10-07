import type { PoolClient } from 'pg';

/** Session first, then transcript/recording: the same lock order as finish. */
export async function lockMutableTranscriptSource(
  client: PoolClient,
  recordingId: string,
): Promise<void> {
  const owners = await client.query<{ transcript_completed_at: Date | null }>(
    `SELECT s.transcript_completed_at FROM assignment_sessions s
     JOIN assignment_source_bindings b ON b.assignment_session_id = s.id
     WHERE b.recording_id = $1 ORDER BY s.id FOR UPDATE OF s`,
    [recordingId],
  );
  if (owners.rows.some((row) => row.transcript_completed_at !== null)) {
    const error = new Error(
      'Completed transcript source is read-only; create homework before editing.',
    );
    Object.assign(error, { code: 'ASSIGNMENT_SESSION_COMPLETED' });
    throw error;
  }
}
