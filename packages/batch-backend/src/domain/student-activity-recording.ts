import type { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';

/** Audit attribution only: this setting never grants database access. */
export async function setStudentActivityActor(
  client: PoolClient,
  actorUserId?: string | null,
): Promise<void> {
  await client.query("SELECT set_config('app.activity_actor_id', $1, true)", [actorUserId ?? '']);
}

/** Single-statement owners need a transaction to scope their known actor. */
export async function withStudentActivityTransaction<T>(
  actorUserId: string | null | undefined,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      await setStudentActivityActor(client, actorUserId);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
