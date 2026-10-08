import { createHash } from 'node:crypto';
import { type Adapter, type AdapterPayload, errors } from 'oidc-provider';
import type { PoolClient } from 'pg';

import { withPgClient } from './db.js';
import { recordOAuthLifecycle } from './mcp-oauth-diagnostics.js';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

type ArtifactRow = { payload: AdapterPayload; consumed_at: Date | null };

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function lockLiveGrant(client: PoolClient, grantId: string): Promise<boolean> {
  const result = await client.query(
    `SELECT id FROM mcp_oauth_grants
     WHERE id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     FOR UPDATE`,
    [grantId],
  );
  return result.rowCount === 1;
}

async function revokeFamily(client: PoolClient, grantId: string): Promise<void> {
  await client.query(
    'UPDATE mcp_oauth_grants SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = $1',
    [grantId],
  );
  await client.query('DELETE FROM mcp_oauth_artifacts WHERE grant_id = $1', [grantId]);
  await client.query("DELETE FROM mcp_oauth_artifacts WHERE kind = 'Grant' AND id_hash = $1", [
    digest(grantId),
  ]);
}

export class McpOAuthAdapter implements Adapter {
  constructor(private readonly kind: string) {}

  private get bearerArtifact(): boolean {
    return ['AccessToken', 'RefreshToken', 'AuthorizationCode'].includes(this.kind);
  }

  private get grantBoundArtifact(): boolean {
    return this.bearerArtifact;
  }

  async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
    if (!expiresIn || !Number.isSafeInteger(expiresIn) || expiresIn <= 0) {
      throw new Error('OAuth artifact must have a finite positive lifetime');
    }
    const storedPayload = { ...payload };
    if (this.bearerArtifact) delete storedPayload.jti;
    if (this.grantBoundArtifact && typeof payload.grantId !== 'string') {
      throw new errors.InvalidGrant('OAuth token has no Pipeline grant');
    }
    const saved = await inTransaction(async (client) => {
      if (this.grantBoundArtifact) {
        if (!(await lockLiveGrant(client, payload.grantId as string))) return false;
      }
      await client.query(
        `INSERT INTO mcp_oauth_artifacts (kind, id_hash, payload, grant_id, uid, expires_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, NOW() + $6 * INTERVAL '1 second')
         ON CONFLICT (kind, id_hash) DO UPDATE SET
           payload = EXCLUDED.payload,
           grant_id = EXCLUDED.grant_id,
           uid = EXCLUDED.uid,
           expires_at = EXCLUDED.expires_at`,
        [
          this.kind,
          digest(id),
          JSON.stringify(storedPayload),
          payload.grantId ?? null,
          payload.uid ?? null,
          expiresIn,
        ],
      );
      return true;
    });
    if (!saved) {
      recordOAuthLifecycle('grant_unavailable', payload.grantId as string);
      throw new errors.InvalidGrant('OAuth grant is revoked or expired');
    }
    if (this.kind === 'RefreshToken')
      recordOAuthLifecycle('refresh_saved', payload.grantId as string);
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    const payload = await this.findWhere('id_hash = $2', digest(id));
    if (typeof payload?.grantId === 'string')
      recordOAuthLifecycle('grant_observed', payload.grantId);
    return payload && this.bearerArtifact ? { ...payload, jti: id } : payload;
  }

  async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
    return this.findWhere("payload->>'userCode' = $2", userCode);
  }

  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    return this.findWhere('uid = $2', uid);
  }

  private async findWhere(predicate: string, value: string): Promise<AdapterPayload | undefined> {
    const row = await withPgClient(async (client) => {
      const result = await client.query<ArtifactRow>(
        `SELECT payload, consumed_at FROM mcp_oauth_artifacts
         WHERE kind = $1 AND ${predicate} AND expires_at > NOW() LIMIT 1`,
        [this.kind, value],
      );
      return result.rows[0];
    });
    return row
      ? { ...row.payload, ...(row.consumed_at ? { consumed: row.consumed_at } : {}) }
      : undefined;
  }

  async consume(id: string): Promise<void> {
    let observedGrantId: string | undefined;
    let familyRevoked = false;
    let grantUnavailable = false;
    const consumed = await inTransaction(async (client) => {
      const idHash = digest(id);
      const row = await client.query<{ grant_id: string | null }>(
        'SELECT grant_id FROM mcp_oauth_artifacts WHERE kind = $1 AND id_hash = $2',
        [this.kind, idHash],
      );
      const grantId = row.rows[0]?.grant_id;
      observedGrantId = grantId ?? undefined;
      if (this.grantBoundArtifact) {
        if (!grantId || !(await lockLiveGrant(client, grantId))) {
          grantUnavailable = true;
          return false;
        }
      }
      const result = await client.query(
        `UPDATE mcp_oauth_artifacts SET consumed_at = NOW()
         WHERE kind = $1 AND id_hash = $2 AND consumed_at IS NULL AND expires_at > NOW()`,
        [this.kind, idHash],
      );
      if (result.rowCount !== 1) {
        if (grantId) {
          await revokeFamily(client, grantId);
          familyRevoked = true;
        }
        return false;
      }
      return true;
    });
    if (familyRevoked) recordOAuthLifecycle('family_revoked', observedGrantId);
    if (!consumed)
      recordOAuthLifecycle(
        grantUnavailable ? 'grant_unavailable' : 'consume_conflict',
        observedGrantId,
      );
    if (consumed && this.kind === 'RefreshToken')
      recordOAuthLifecycle('refresh_consumed', observedGrantId);
    // The conflict commits family revocation before the OAuth error is raised.
    // A concurrent issuer must take the same grant row lock before saving tokens.
    if (!consumed) throw new errors.InvalidGrant('OAuth credential was already consumed');
  }

  async destroy(id: string): Promise<void> {
    await inTransaction(async (client) => {
      if (this.kind === 'Grant') await revokeFamily(client, id);
      await client.query('DELETE FROM mcp_oauth_artifacts WHERE kind = $1 AND id_hash = $2', [
        this.kind,
        digest(id),
      ]);
    });
    if (this.kind === 'Grant') recordOAuthLifecycle('family_revoked', id);
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await inTransaction(async (client) => revokeFamily(client, grantId));
    recordOAuthLifecycle('family_revoked', grantId);
  }
}
