import { Pool, type ClientConfig } from 'pg';

import { readInt } from '@esl-pipeline/shared-infrastructure';

import { readBotPostgresClientConfig } from './postgres-config.js';
import type { AuditLogger } from './types.js';

export type ApprovalTokenReserveResult = 'reserved' | 'replayed';

export interface ApprovalReplayStore {
  reserveTokenUse: (args: {
    tokenFingerprint: string;
    expiresAtMs: number;
    nowMs: number;
  }) => Promise<ApprovalTokenReserveResult>;
  releaseTokenUse: (args: { tokenFingerprint: string }) => Promise<void>;
  close?: () => Promise<void>;
}

export class InMemoryApprovalReplayStore implements ApprovalReplayStore {
  private readonly usedTokens = new Map<string, number>();

  resetForTests(): void {
    this.usedTokens.clear();
  }

  async reserveTokenUse(args: {
    tokenFingerprint: string;
    expiresAtMs: number;
    nowMs: number;
  }): Promise<ApprovalTokenReserveResult> {
    this.purgeExpired(args.nowMs);
    const existingExpiry = this.usedTokens.get(args.tokenFingerprint);
    if (typeof existingExpiry === 'number' && existingExpiry > args.nowMs) {
      return 'replayed';
    }
    this.usedTokens.set(args.tokenFingerprint, args.expiresAtMs);
    return 'reserved';
  }

  async releaseTokenUse(args: { tokenFingerprint: string }): Promise<void> {
    this.usedTokens.delete(args.tokenFingerprint);
  }

  private purgeExpired(nowMs: number): void {
    for (const [fingerprint, expiresAtMs] of this.usedTokens.entries()) {
      if (expiresAtMs <= nowMs) {
        this.usedTokens.delete(fingerprint);
      }
    }
  }
}

const DEFAULT_PRUNE_INTERVAL_MS = 60_000;

export class PostgresApprovalReplayStore implements ApprovalReplayStore {
  private readonly audit: AuditLogger;
  private readonly pool: Pool;
  private readonly pruneIntervalMs: number;

  private schemaReady = false;
  private schemaReadyPromise: Promise<void> | null = null;
  private lastPruneAtMs = 0;

  constructor(args: { clientConfig: ClientConfig; audit: AuditLogger; pruneIntervalMs?: number }) {
    this.audit = args.audit;
    this.pool = new Pool(args.clientConfig);
    this.pruneIntervalMs = args.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
  }

  static fromEnv(audit: AuditLogger): PostgresApprovalReplayStore {
    return new PostgresApprovalReplayStore({
      clientConfig: readBotPostgresClientConfig('TELEGRAM_OPS_BOT_APPROVAL_REPLAY_DATABASE_URL'),
      audit,
      pruneIntervalMs: readInt(
        'TELEGRAM_OPS_BOT_APPROVAL_REPLAY_PRUNE_INTERVAL_MS',
        DEFAULT_PRUNE_INTERVAL_MS,
      ),
    });
  }

  async reserveTokenUse(args: {
    tokenFingerprint: string;
    expiresAtMs: number;
    nowMs: number;
  }): Promise<ApprovalTokenReserveResult> {
    await this.ensureSchema();
    await this.pruneExpiredIfDue(args.nowMs);

    const result = await this.pool.query<{ token_fingerprint: string }>(
      `
        INSERT INTO telegram_approval_replay_tokens (
          token_fingerprint,
          expires_at,
          used_at
        )
        VALUES ($1, to_timestamp($2 / 1000.0), to_timestamp($3 / 1000.0))
        ON CONFLICT (token_fingerprint) DO NOTHING
        RETURNING token_fingerprint
      `,
      [args.tokenFingerprint, args.expiresAtMs, args.nowMs],
    );

    return result.rows.length > 0 ? 'reserved' : 'replayed';
  }

  async releaseTokenUse(args: { tokenFingerprint: string }): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `
        DELETE FROM telegram_approval_replay_tokens
        WHERE token_fingerprint = $1
      `,
      [args.tokenFingerprint],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) {
      return;
    }
    if (this.schemaReadyPromise) {
      await this.schemaReadyPromise;
      return;
    }

    this.schemaReadyPromise = (async () => {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS telegram_approval_replay_tokens (
          token_fingerprint TEXT PRIMARY KEY,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ NOT NULL
        )
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS telegram_approval_replay_tokens_expires_at_idx
        ON telegram_approval_replay_tokens (expires_at)
      `);
      this.schemaReady = true;
      this.audit.log({
        level: 'info',
        event: 'advanced_control_replay_store_ready',
        message: 'Approval replay store is ready',
      });
    })();

    try {
      await this.schemaReadyPromise;
    } finally {
      this.schemaReadyPromise = null;
    }
  }

  private async pruneExpiredIfDue(nowMs: number): Promise<void> {
    if (nowMs - this.lastPruneAtMs < this.pruneIntervalMs) {
      return;
    }
    this.lastPruneAtMs = nowMs;
    try {
      await this.pool.query(
        `
          DELETE FROM telegram_approval_replay_tokens
          WHERE expires_at <= to_timestamp($1 / 1000.0)
        `,
        [nowMs],
      );
    } catch (error: unknown) {
      this.audit.log({
        level: 'warn',
        event: 'advanced_control_replay_store_prune_failed',
        message: 'Failed to prune expired approval replay tokens',
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}
