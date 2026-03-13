import { type ClientConfig, Client } from 'pg';

import { readString } from '@esl-pipeline/shared-infrastructure';

import { readBotPostgresClientConfig } from './postgres-config.js';
import type { AuditLogger, PollLeaderElection } from './types.js';

const DEFAULT_LOCK_KEY = '910151';

function readLeaderElectionClientConfig(): ClientConfig {
  return readBotPostgresClientConfig('TELEGRAM_OPS_BOT_LEADER_ELECTION_DATABASE_URL');
}

function readLeaderElectionLockKey(): string {
  const lockKey = readString('TELEGRAM_OPS_BOT_LEADER_ELECTION_LOCK_KEY', DEFAULT_LOCK_KEY)!;
  if (!/^-?\d+$/.test(lockKey)) {
    throw new Error(
      'TELEGRAM_OPS_BOT_LEADER_ELECTION_LOCK_KEY must be an integer representable as bigint',
    );
  }
  return lockKey;
}

export class PostgresPollingLeaderElection implements PollLeaderElection {
  private readonly clientConfig: ClientConfig;
  private readonly lockKey: string;
  private readonly audit: AuditLogger;

  private client: Client | null = null;
  private lockHeld = false;

  constructor(args: { clientConfig: ClientConfig; lockKey: string; audit: AuditLogger }) {
    this.clientConfig = args.clientConfig;
    this.lockKey = args.lockKey;
    this.audit = args.audit;
  }

  static fromEnv(audit: AuditLogger): PostgresPollingLeaderElection {
    return new PostgresPollingLeaderElection({
      clientConfig: readLeaderElectionClientConfig(),
      lockKey: readLeaderElectionLockKey(),
      audit,
    });
  }

  async isLeader(): Promise<boolean> {
    const client = await this.ensureClient();
    if (this.lockHeld) {
      return true;
    }

    try {
      const result = await client.query<{ acquired?: unknown }>(
        'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
        [this.lockKey],
      );
      const acquired = result.rows[0]?.acquired === true;
      this.lockHeld = acquired;
      return acquired;
    } catch (error: unknown) {
      await this.resetClient();
      throw error;
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) {
      this.lockHeld = false;
      return;
    }

    try {
      if (this.lockHeld) {
        await client.query('SELECT pg_advisory_unlock($1::bigint)', [this.lockKey]);
      }
    } catch (error: unknown) {
      this.audit.log({
        level: 'warn',
        event: 'poll_leader_unlock_failed',
        message: 'Failed to release polling advisory lock cleanly',
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      this.lockHeld = false;
      try {
        await client.end();
      } catch {
        // Best-effort close.
      }
    }
  }

  private async ensureClient(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    const client = new Client(this.clientConfig);
    try {
      await client.connect();
      this.client = client;
      this.lockHeld = false;
      return client;
    } catch (error: unknown) {
      try {
        await client.end();
      } catch {
        // Best-effort close.
      }
      throw error;
    }
  }

  private async resetClient(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.lockHeld = false;
    if (!client) return;
    try {
      await client.end();
    } catch {
      // Best-effort close.
    }
  }
}
