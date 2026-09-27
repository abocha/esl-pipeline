import { withPgClient } from '../infrastructure/db.js';

export const MCP_READ_SCOPE = 'teaching_context.read';

export interface OAuthWorkspace {
  id: string;
  name: string;
}

export interface BoundOAuthGrant {
  id: string;
  userId: string;
  workspaceId: string;
  clientId: string;
  resource: string;
  scope: string;
}

export async function listOAuthWorkspaces(userId: string): Promise<OAuthWorkspace[]> {
  return withPgClient(async (client) => {
    const result = await client.query<OAuthWorkspace>(
      `SELECT w.id, w.name FROM workspace_memberships m
       JOIN workspaces w ON w.id = m.workspace_id
       JOIN users u ON u.id = m.user_id
       WHERE m.user_id = $1 AND u.is_active = TRUE
       ORDER BY w.name, w.id`,
      [userId],
    );
    return result.rows;
  });
}

export async function bindOAuthGrant(
  input: BoundOAuthGrant,
  lifetimeSeconds: number,
): Promise<boolean> {
  return withPgClient(async (client) => {
    const result = await client.query(
      `INSERT INTO mcp_oauth_grants
         (id, user_id, workspace_id, client_id, resource, scope, expires_at)
       SELECT $1, u.id, w.id, $4, $5, $6, NOW() + $7 * INTERVAL '1 second'
       FROM users u
       JOIN workspace_memberships m ON m.user_id = u.id
       JOIN workspaces w ON w.id = m.workspace_id
       WHERE u.id = $2 AND u.is_active = TRUE AND w.id = $3
       ON CONFLICT (id) DO NOTHING`,
      [
        input.id,
        input.userId,
        input.workspaceId,
        input.clientId,
        input.resource,
        input.scope,
        lifetimeSeconds,
      ],
    );
    return result.rowCount === 1;
  });
}

export async function findValidOAuthGrant(grantId: string): Promise<BoundOAuthGrant | null> {
  return withPgClient(async (client) => {
    const result = await client.query<{
      id: string;
      user_id: string;
      workspace_id: string;
      client_id: string;
      resource: string;
      scope: string;
    }>(
      `SELECT g.id, g.user_id, g.workspace_id, g.client_id, g.resource, g.scope
       FROM mcp_oauth_grants g
       JOIN users u ON u.id = g.user_id AND u.is_active = TRUE
       JOIN workspaces w ON w.id = g.workspace_id
       JOIN workspace_memberships m ON m.user_id = g.user_id AND m.workspace_id = w.id
       WHERE g.id = $1 AND g.revoked_at IS NULL AND g.expires_at > NOW()`,
      [grantId],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          workspaceId: row.workspace_id,
          clientId: row.client_id,
          resource: row.resource,
          scope: row.scope,
        }
      : null;
  });
}

export async function revokeOAuthGrant(grantId: string, userId: string): Promise<boolean> {
  return withPgClient(async (client) => {
    const result = await client.query(
      `UPDATE mcp_oauth_grants SET revoked_at = NOW()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [grantId, userId],
    );
    return result.rowCount === 1;
  });
}
