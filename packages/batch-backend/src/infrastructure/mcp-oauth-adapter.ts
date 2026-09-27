import { createHash } from 'node:crypto';
import type { Adapter, AdapterPayload } from 'oidc-provider';

import { withPgClient } from './db.js';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

type ArtifactRow = { payload: AdapterPayload; consumed_at: Date | null };

export class McpOAuthAdapter implements Adapter {
  constructor(private readonly kind: string) {}

  private get bearerArtifact(): boolean {
    return ['AccessToken', 'RefreshToken', 'AuthorizationCode'].includes(this.kind);
  }

  async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
    if (!expiresIn || !Number.isSafeInteger(expiresIn) || expiresIn <= 0) {
      throw new Error('OAuth artifact must have a finite positive lifetime');
    }
    const storedPayload = { ...payload };
    if (this.bearerArtifact) delete storedPayload.jti;
    await withPgClient(async (client) => {
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
    });
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    const payload = await this.findWhere('id_hash = $2', digest(id));
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
    const changed = await withPgClient(async (client) => {
      const result = await client.query(
        `UPDATE mcp_oauth_artifacts SET consumed_at = NOW()
         WHERE kind = $1 AND id_hash = $2 AND consumed_at IS NULL AND expires_at > NOW()`,
        [this.kind, digest(id)],
      );
      return result.rowCount;
    });
    // The provider reads before consuming; reject a concurrent second exchange.
    if (changed !== 1) throw new Error('OAuth artifact already consumed or expired');
  }

  async destroy(id: string): Promise<void> {
    await withPgClient(async (client) => {
      await client.query('DELETE FROM mcp_oauth_artifacts WHERE kind = $1 AND id_hash = $2', [
        this.kind,
        digest(id),
      ]);
    });
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await withPgClient(async (client) => {
      await client.query('DELETE FROM mcp_oauth_artifacts WHERE kind = $1 AND grant_id = $2', [
        this.kind,
        grantId,
      ]);
    });
  }
}
