// packages/batch-backend/src/infrastructure/db.ts
// Thin Postgres adapter for the batch-backend.
// - Uses env from config/env.
// - Optional: only required if PG_ENABLED=true.
// - Exposed helpers are minimal and easy to swap if your platform provides its own client.
import { Pool, PoolClient } from 'pg';

import { loadConfig } from '../config/env.js';
import { logger } from './logger.js';

let pool: Pool | null = null;
let schemaReadyPromise: Promise<void> | null = null;

const JOBS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  state TEXT NOT NULL,
  md TEXT NULL,
  transcribe_workdir TEXT NULL,
  transcript_path TEXT NULL,
  prompt_payload TEXT NULL,
  prompt_notes TEXT NULL,
  profile_path TEXT NULL,
  recording_id UUID NULL,
  transcript_id UUID NULL,
  prompt_package_id UUID NULL,
  draft_id UUID NULL,
  preset TEXT NULL,
  with_tts BOOLEAN NULL,
  upload TEXT NULL,
  voice_id TEXT NULL,
  voice_accent TEXT NULL,
  force_tts BOOLEAN NULL,
  notion_database TEXT NULL,
  mode TEXT NULL,
  notion_url TEXT NULL,
  manifest_path TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  error TEXT NULL,
  user_id UUID NULL
);
`;

const JOBS_SCHEMA_PATCHES: string[] = [
  'ALTER TABLE jobs ALTER COLUMN md DROP NOT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS transcribe_workdir TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS transcript_path TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_payload TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_notes TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS profile_path TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recording_id UUID NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS transcript_id UUID NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_package_id UUID NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS draft_id UUID NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS preset TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS with_tts BOOLEAN NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS upload TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS voice_id TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS voice_accent TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS force_tts BOOLEAN NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS notion_database TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS mode TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS notion_url TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS manifest_path TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS user_id UUID NULL',
];

const JOBS_INDEX_PATCHES: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_jobs_state_created_at ON jobs (state, created_at)',
];

const RECORDINGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS recordings (
  id UUID PRIMARY KEY,
  source TEXT NOT NULL,
  student_id UUID NULL,
  source_path TEXT NULL,
  storage_uri TEXT NOT NULL,
  sha256 TEXT NULL,
  bytes BIGINT NOT NULL,
  duration_sec INTEGER NULL,
  channels INTEGER NULL,
  status TEXT NOT NULL,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const RECORDINGS_SCHEMA_PATCHES: string[] = [
  'ALTER TABLE recordings ADD COLUMN IF NOT EXISTS source TEXT NULL',
  'ALTER TABLE recordings ADD COLUMN IF NOT EXISTS student_id UUID NULL',
  'ALTER TABLE recordings ADD COLUMN IF NOT EXISTS source_path TEXT NULL',
  'ALTER TABLE recordings ADD COLUMN IF NOT EXISTS storage_uri TEXT NULL',
  'ALTER TABLE recordings ADD COLUMN IF NOT EXISTS sha256 TEXT NULL',
  'ALTER TABLE recordings ADD COLUMN IF NOT EXISTS bytes BIGINT NULL',
  'ALTER TABLE recordings ADD COLUMN IF NOT EXISTS duration_sec INTEGER NULL',
  'ALTER TABLE recordings ADD COLUMN IF NOT EXISTS channels INTEGER NULL',
  'ALTER TABLE recordings ADD COLUMN IF NOT EXISTS status TEXT NULL',
  'ALTER TABLE recordings ADD COLUMN IF NOT EXISTS error TEXT NULL',
  'ALTER TABLE recordings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL',
  'ALTER TABLE recordings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL',
];

const RECORDINGS_INDEX_PATCHES: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings (status)',
  'CREATE INDEX IF NOT EXISTS idx_recordings_created_at ON recordings (created_at)',
];

const TRANSCRIPTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS transcripts (
  id UUID PRIMARY KEY,
  recording_id UUID NOT NULL,
  storage_uri TEXT NOT NULL,
  raw_response_uri TEXT NULL,
  mode TEXT NOT NULL DEFAULT 'timeline',
  model TEXT NOT NULL DEFAULT 'nova-3',
  language TEXT NOT NULL DEFAULT 'multi',
  fallback_used BOOLEAN NOT NULL DEFAULT false,
  summary_json JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const TRANSCRIPTS_SCHEMA_PATCHES: string[] = [
  'ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS recording_id UUID NULL',
  'ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS storage_uri TEXT NULL',
  'ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS raw_response_uri TEXT NULL',
  'ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS mode TEXT NULL',
  'ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS model TEXT NULL',
  'ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS language TEXT NULL',
  'ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS fallback_used BOOLEAN NULL',
  'ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS summary_json JSONB NULL',
  'ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL',
  'ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL',
];

const TRANSCRIPTS_INDEX_PATCHES: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_transcripts_recording_id ON transcripts (recording_id)',
];

const PROMPT_PACKAGES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS prompt_packages (
  id UUID PRIMARY KEY,
  recording_id UUID NOT NULL,
  transcript_id UUID NOT NULL,
  student_id UUID NULL,
  profile_path TEXT NULL,
  template_version TEXT NOT NULL,
  notes TEXT NULL,
  storage_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const PROMPT_PACKAGES_SCHEMA_PATCHES: string[] = [
  'ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS recording_id UUID NULL',
  'ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS transcript_id UUID NULL',
  'ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS student_id UUID NULL',
  'ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS profile_path TEXT NULL',
  'ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS template_version TEXT NULL',
  'ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS notes TEXT NULL',
  'ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS storage_uri TEXT NULL',
  'ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL',
  'ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL',
];

const PROMPT_PACKAGES_INDEX_PATCHES: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_prompt_packages_recording_id ON prompt_packages (recording_id)',
  'CREATE INDEX IF NOT EXISTS idx_prompt_packages_transcript_id ON prompt_packages (transcript_id)',
  'CREATE INDEX IF NOT EXISTS idx_prompt_packages_student_id ON prompt_packages (student_id)',
];

const DRAFTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS drafts (
  id UUID PRIMARY KEY,
  prompt_package_id UUID NOT NULL,
  student_id UUID NULL,
  storage_uri TEXT NOT NULL,
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const DRAFTS_SCHEMA_PATCHES: string[] = [
  'ALTER TABLE drafts ADD COLUMN IF NOT EXISTS prompt_package_id UUID NULL',
  'ALTER TABLE drafts ADD COLUMN IF NOT EXISTS student_id UUID NULL',
  'ALTER TABLE drafts ADD COLUMN IF NOT EXISTS storage_uri TEXT NULL',
  'ALTER TABLE drafts ADD COLUMN IF NOT EXISTS created_by UUID NULL',
  'ALTER TABLE drafts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL',
  'ALTER TABLE drafts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL',
];

const DRAFTS_INDEX_PATCHES: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_drafts_prompt_package_id ON drafts (prompt_package_id)',
  'CREATE INDEX IF NOT EXISTS idx_drafts_student_id ON drafts (student_id)',
  'CREATE INDEX IF NOT EXISTS idx_drafts_created_by ON drafts (created_by)',
];

const TRANSCRIPTION_CONSTRAINT_PATCHES: string[] = [
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recordings_source_check') THEN
    ALTER TABLE recordings
      ADD CONSTRAINT recordings_source_check CHECK (source IN ('scan', 'upload'));
  END IF;
END $$;`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recordings_status_check') THEN
    ALTER TABLE recordings
      ADD CONSTRAINT recordings_status_check
      CHECK (status IN ('ingested', 'queued', 'transcribing', 'transcribed', 'failed'));
  END IF;
END $$;`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transcripts_mode_check') THEN
    ALTER TABLE transcripts
      ADD CONSTRAINT transcripts_mode_check CHECK (mode IN ('timeline', 'stack'));
  END IF;
END $$;`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transcripts_recording_id_fkey') THEN
    ALTER TABLE transcripts
      ADD CONSTRAINT transcripts_recording_id_fkey
      FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE;
  END IF;
END $$;`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_packages_recording_id_fkey') THEN
    ALTER TABLE prompt_packages
      ADD CONSTRAINT prompt_packages_recording_id_fkey
      FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE;
  END IF;
END $$;`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_packages_transcript_id_fkey') THEN
    ALTER TABLE prompt_packages
      ADD CONSTRAINT prompt_packages_transcript_id_fkey
      FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE;
  END IF;
END $$;`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drafts_prompt_package_id_fkey') THEN
    ALTER TABLE drafts
      ADD CONSTRAINT drafts_prompt_package_id_fkey
      FOREIGN KEY (prompt_package_id) REFERENCES prompt_packages(id) ON DELETE CASCADE;
  END IF;
END $$;`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drafts_created_by_fkey') THEN
    ALTER TABLE drafts
      ADD CONSTRAINT drafts_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;`,
];

const TRANSCRIPTION_TRIGGER_PATCHES: string[] = [
  `CREATE OR REPLACE FUNCTION set_recordings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`,
  'DROP TRIGGER IF EXISTS set_recordings_updated_at ON recordings',
  `CREATE TRIGGER set_recordings_updated_at
BEFORE UPDATE ON recordings
FOR EACH ROW
EXECUTE FUNCTION set_recordings_updated_at()`,
  `CREATE OR REPLACE FUNCTION set_transcripts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`,
  'DROP TRIGGER IF EXISTS set_transcripts_updated_at ON transcripts',
  `CREATE TRIGGER set_transcripts_updated_at
BEFORE UPDATE ON transcripts
FOR EACH ROW
EXECUTE FUNCTION set_transcripts_updated_at()`,
  `CREATE OR REPLACE FUNCTION set_prompt_packages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`,
  'DROP TRIGGER IF EXISTS set_prompt_packages_updated_at ON prompt_packages',
  `CREATE TRIGGER set_prompt_packages_updated_at
BEFORE UPDATE ON prompt_packages
FOR EACH ROW
EXECUTE FUNCTION set_prompt_packages_updated_at()`,
  `CREATE OR REPLACE FUNCTION set_drafts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`,
  'DROP TRIGGER IF EXISTS set_drafts_updated_at ON drafts',
  `CREATE TRIGGER set_drafts_updated_at
BEFORE UPDATE ON drafts
FOR EACH ROW
EXECUTE FUNCTION set_drafts_updated_at()`,
];

const USERS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ NULL
);
`;

async function ensureJobsSchema(client: PoolClient): Promise<void> {
  if (schemaReadyPromise) {
    await schemaReadyPromise;
    return;
  }

  schemaReadyPromise = (async () => {
    // Jobs table
    await client.query(JOBS_TABLE_SQL);
    for (const statement of JOBS_SCHEMA_PATCHES) {
      await client.query(statement);
    }
    for (const indexSql of JOBS_INDEX_PATCHES) {
      await client.query(indexSql);
    }

    await client.query(RECORDINGS_TABLE_SQL);
    for (const statement of RECORDINGS_SCHEMA_PATCHES) {
      await client.query(statement);
    }
    for (const indexSql of RECORDINGS_INDEX_PATCHES) {
      await client.query(indexSql);
    }

    await client.query(TRANSCRIPTS_TABLE_SQL);
    for (const statement of TRANSCRIPTS_SCHEMA_PATCHES) {
      await client.query(statement);
    }
    for (const indexSql of TRANSCRIPTS_INDEX_PATCHES) {
      await client.query(indexSql);
    }

    await client.query(PROMPT_PACKAGES_TABLE_SQL);
    for (const statement of PROMPT_PACKAGES_SCHEMA_PATCHES) {
      await client.query(statement);
    }
    for (const indexSql of PROMPT_PACKAGES_INDEX_PATCHES) {
      await client.query(indexSql);
    }

    await client.query(DRAFTS_TABLE_SQL);
    for (const statement of DRAFTS_SCHEMA_PATCHES) {
      await client.query(statement);
    }
    for (const indexSql of DRAFTS_INDEX_PATCHES) {
      await client.query(indexSql);
    }

    // Users table
    await client.query(USERS_TABLE_SQL);

    for (const statement of TRANSCRIPTION_CONSTRAINT_PATCHES) {
      await client.query(statement);
    }
    for (const statement of TRANSCRIPTION_TRIGGER_PATCHES) {
      await client.query(statement);
    }

    logger.info('Ensured database schema (jobs, recordings, transcripts, prompt_packages, drafts, users)', {
      component: 'pg',
      event: 'schema_ready',
    });
  })().catch((error) => {
    schemaReadyPromise = null;
    throw error;
  });

  await schemaReadyPromise;
}

// createPgPool.declaration()
export function createPgPool(): Pool {
  if (pool) return pool;

  const config = loadConfig();

  if (!config.pg.enabled) {
    throw new Error('Postgres requested but PG_ENABLED=false');
  }

  const connectionString =
    config.pg.connectionString ||
    `postgresql://${encodeURIComponent(config.pg.user)}:${encodeURIComponent(
      config.pg.password,
    )}@${config.pg.host}:${config.pg.port}/${config.pg.database}`;

  pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err: Error) => {
    logger.error(err, {
      component: 'pg',
      message: 'Unexpected Postgres pool error',
    });
  });

  return pool;
}

// withPgClient.declaration()
export async function withPgClient<T>(
  fn: (client: PoolClient) => Promise<T>,
  attempt = 1,
): Promise<T> {
  const p = createPgPool();

  try {
    const client = await p.connect();
    try {
      await ensureJobsSchema(client);
      return await fn(client);
    } finally {
      client.release();
    }
  } catch (error) {
    if (attempt < 5) {
      const delay = 500 * attempt;
      logger.warn('Postgres connection failed; retrying', {
        component: 'pg',
        attempt,
        delay,
        error: error instanceof Error ? error.message : String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
      return withPgClient(fn, attempt + 1);
    }

    logger.error(error instanceof Error ? error : String(error), {
      component: 'pg',
      message: 'Postgres operation failed',
    });
    throw error;
  }
}

/*
Example schema compatible with the batch-backend domain (JobRecord):

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  state TEXT NOT NULL,
  md TEXT NULL,
  transcribe_workdir TEXT,
  transcript_path TEXT,
  prompt_payload TEXT,
  prompt_notes TEXT,
  profile_path TEXT,
  recording_id UUID,
  transcript_id UUID,
  prompt_package_id UUID,
  draft_id UUID,
  preset TEXT,
  with_tts BOOLEAN DEFAULT FALSE,
  upload TEXT,
  voice_id TEXT,
  voice_accent TEXT,
  force_tts BOOLEAN,
  notion_database TEXT,
  mode TEXT,
  notion_url TEXT,
  manifest_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  user_id UUID
);

CREATE INDEX IF NOT EXISTS idx_jobs_state_created_at ON jobs (state, created_at);
*/
