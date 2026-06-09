import { withPgClient } from '../infrastructure/db.js';

export class WorkspaceContextError extends Error {
  status: number;
  code: string;

  constructor(message = 'Workspace membership is required') {
    super(message);
    this.name = 'WorkspaceContextError';
    this.status = 403;
    this.code = 'workspace_required';
  }
}

export async function resolvePrimaryWorkspaceIdForUser(userId: string): Promise<string> {
  const workspaceId = await withPgClient(async (client) => {
    const result = await client.query<{ workspace_id: string }>(
      `
      SELECT workspace_id
      FROM workspace_memberships
      WHERE user_id = $1
      ORDER BY
        CASE role
          WHEN 'owner' THEN 0
          WHEN 'admin' THEN 1
          WHEN 'member' THEN 2
          ELSE 3
        END,
        created_at ASC
      LIMIT 1
      `,
      [userId],
    );
    return result.rows[0]?.workspace_id ?? null;
  });

  if (!workspaceId) {
    throw new WorkspaceContextError();
  }

  return workspaceId;
}
