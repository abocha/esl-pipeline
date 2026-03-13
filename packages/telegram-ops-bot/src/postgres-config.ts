import type { ClientConfig } from 'pg';

import { readInt, readString } from '@esl-pipeline/shared-infrastructure';

export function readBotPostgresClientConfig(preferredDatabaseUrlEnvVar: string): ClientConfig {
  const directUrl = readString(
    preferredDatabaseUrlEnvVar,
    readString(
      'TELEGRAM_OPS_BOT_LEADER_ELECTION_DATABASE_URL',
      readString('PG_CONNECTION_STRING', ''),
    ),
  );
  if (directUrl?.trim()) {
    return {
      connectionString: directUrl.trim(),
      connectionTimeoutMillis: readInt('PG_CONNECTION_TIMEOUT_MS', 5_000),
    };
  }

  return {
    host: readString('PG_HOST', 'postgres')!,
    port: readInt('PG_PORT', 5432),
    user: readString('PG_USER', 'esl')!,
    password: readString('PG_PASSWORD', 'esl')!,
    database: readString('PG_DATABASE', 'esl_batch')!,
    connectionTimeoutMillis: readInt('PG_CONNECTION_TIMEOUT_MS', 5_000),
  };
}
