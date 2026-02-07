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
  md_storage_uri TEXT NULL,
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
  publish_target TEXT NULL,
  mode TEXT NULL,
  notion_url TEXT NULL,
  anytype_url TEXT NULL,
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
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS md_storage_uri TEXT NULL',
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
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS publish_target TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS mode TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS notion_url TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS anytype_url TEXT NULL',
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
  'CREATE INDEX IF NOT EXISTS idx_recordings_source ON recordings (source)',
  'CREATE INDEX IF NOT EXISTS idx_recordings_student_id ON recordings (student_id)',
  `DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
      BEGIN
        CREATE EXTENSION pg_trgm;
      EXCEPTION
        WHEN insufficient_privilege THEN
          NULL;
      END;
    END IF;
  END
  $$;`,
  `DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
      CREATE INDEX IF NOT EXISTS idx_recordings_source_path_trgm
        ON recordings USING gin (source_path gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_recordings_storage_uri_trgm
        ON recordings USING gin (storage_uri gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_recordings_id_trgm
        ON recordings USING gin ((id::text) gin_trgm_ops);
    END IF;
  END
  $$;`,
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
  resolved_profile_id TEXT NULL,
  resolved_profile_hash TEXT NULL,
  resolved_profile_revision_id UUID NULL,
  resolved_profile_updated_at TIMESTAMPTZ NULL,
  resolved_template_id TEXT NULL,
  resolved_template_hash TEXT NULL,
  resolved_template_revision_id UUID NULL,
  resolved_template_updated_at TIMESTAMPTZ NULL,
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
  'ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_profile_id TEXT NULL',
  'ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_profile_hash TEXT NULL',
  'ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_profile_revision_id UUID NULL',
  'ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_profile_updated_at TIMESTAMPTZ NULL',
  'ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_template_id TEXT NULL',
  'ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_template_hash TEXT NULL',
  'ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_template_revision_id UUID NULL',
  'ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_template_updated_at TIMESTAMPTZ NULL',
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
  'CREATE INDEX IF NOT EXISTS idx_prompt_packages_resolved_profile_id ON prompt_packages (resolved_profile_id)',
  'CREATE INDEX IF NOT EXISTS idx_prompt_packages_resolved_template_id ON prompt_packages (resolved_template_id)',
];

const PROFILE_REVISIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS profile_revisions (
  id UUID PRIMARY KEY,
  profile_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'update',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NULL,
  restored_from_revision_id UUID NULL
);
`;

const PROFILE_REVISIONS_SCHEMA_PATCHES: string[] = [
  'ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS profile_id TEXT NULL',
  'ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS content TEXT NULL',
  'ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS content_hash TEXT NULL',
  'ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS source TEXT NULL',
  'ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL',
  'ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS created_by UUID NULL',
  'ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS restored_from_revision_id UUID NULL',
];

const PROFILE_REVISIONS_INDEX_PATCHES: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_profile_revisions_profile_id_created_at ON profile_revisions (profile_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_profile_revisions_profile_id_hash ON profile_revisions (profile_id, content_hash)',
];

const TEMPLATE_REVISIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS template_revisions (
  id UUID PRIMARY KEY,
  template_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'update',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NULL,
  restored_from_revision_id UUID NULL
);
`;

const TEMPLATE_REVISIONS_SCHEMA_PATCHES: string[] = [
  'ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS template_id TEXT NULL',
  'ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS content TEXT NULL',
  'ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS content_hash TEXT NULL',
  'ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS source TEXT NULL',
  'ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL',
  'ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS created_by UUID NULL',
  'ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS restored_from_revision_id UUID NULL',
];

const TEMPLATE_REVISIONS_INDEX_PATCHES: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_template_revisions_template_id_created_at ON template_revisions (template_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_template_revisions_template_id_hash ON template_revisions (template_id, content_hash)',
];

const STUDENTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY,
  student TEXT NOT NULL,
  db_id TEXT NULL,
  page_parent_id TEXT NULL,
  color_preset TEXT NULL,
  voices JSONB NOT NULL DEFAULT '{}'::jsonb,
  manifest_preset TEXT NULL,
  accent_preference TEXT NULL,
  profile_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const STUDENTS_SCHEMA_PATCHES: string[] = [
  'ALTER TABLE students ADD COLUMN IF NOT EXISTS student TEXT NULL',
  'ALTER TABLE students ADD COLUMN IF NOT EXISTS db_id TEXT NULL',
  'ALTER TABLE students ADD COLUMN IF NOT EXISTS page_parent_id TEXT NULL',
  'ALTER TABLE students ADD COLUMN IF NOT EXISTS color_preset TEXT NULL',
  "ALTER TABLE students ADD COLUMN IF NOT EXISTS voices JSONB NOT NULL DEFAULT '{}'::jsonb",
  'ALTER TABLE students ADD COLUMN IF NOT EXISTS manifest_preset TEXT NULL',
  'ALTER TABLE students ADD COLUMN IF NOT EXISTS accent_preference TEXT NULL',
  'ALTER TABLE students ADD COLUMN IF NOT EXISTS profile_id TEXT NULL',
  'ALTER TABLE students ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL',
  'ALTER TABLE students ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL',
];

const STUDENTS_INDEX_PATCHES: string[] = [
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_students_student_lower_unique ON students ((LOWER(student)))',
  'CREATE INDEX IF NOT EXISTS idx_students_profile_id ON students (profile_id)',
  'CREATE INDEX IF NOT EXISTS idx_students_created_at ON students (created_at)',
];

const PROFILES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  active_revision_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const PROFILES_SCHEMA_PATCHES: string[] = [
  'ALTER TABLE profiles ADD COLUMN IF NOT EXISTS id TEXT NULL',
  'ALTER TABLE profiles ADD COLUMN IF NOT EXISTS label TEXT NULL',
  'ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active_revision_id UUID NULL',
  'ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL',
  'ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL',
];

const PROFILES_INDEX_PATCHES: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_profiles_label ON profiles (label)',
  'CREATE INDEX IF NOT EXISTS idx_profiles_active_revision_id ON profiles (active_revision_id)',
];

const STUDENT_PROFILE_BINDINGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS student_profile_bindings (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL,
  profile_id TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ NULL,
  reason TEXT NULL,
  changed_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const STUDENT_PROFILE_BINDINGS_SCHEMA_PATCHES: string[] = [
  'ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS student_id UUID NULL',
  'ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS profile_id TEXT NULL',
  'ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ NULL',
  'ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS effective_to TIMESTAMPTZ NULL',
  'ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS reason TEXT NULL',
  'ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS changed_by UUID NULL',
  'ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL',
];

const STUDENT_PROFILE_BINDINGS_INDEX_PATCHES: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_student_profile_bindings_student_id ON student_profile_bindings (student_id)',
  'CREATE INDEX IF NOT EXISTS idx_student_profile_bindings_profile_id ON student_profile_bindings (profile_id)',
  'CREATE INDEX IF NOT EXISTS idx_student_profile_bindings_effective_from ON student_profile_bindings (effective_from DESC)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_student_profile_bindings_single_active ON student_profile_bindings (student_id) WHERE effective_to IS NULL',
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
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recordings_source_check') THEN
    ALTER TABLE recordings DROP CONSTRAINT recordings_source_check;
  END IF;
  ALTER TABLE recordings
    ADD CONSTRAINT recordings_source_check CHECK (source IN ('upload'));
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
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_revisions_created_by_fkey') THEN
    ALTER TABLE profile_revisions
      ADD CONSTRAINT profile_revisions_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_revisions_restored_from_revision_id_fkey') THEN
    ALTER TABLE profile_revisions
      ADD CONSTRAINT profile_revisions_restored_from_revision_id_fkey
      FOREIGN KEY (restored_from_revision_id) REFERENCES profile_revisions(id) ON DELETE SET NULL;
  END IF;
END $$;`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_revisions_source_check') THEN
    ALTER TABLE profile_revisions
      ADD CONSTRAINT profile_revisions_source_check CHECK (source IN ('create', 'update', 'restore'));
  END IF;
END $$;`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_revisions_created_by_fkey') THEN
    ALTER TABLE template_revisions
      ADD CONSTRAINT template_revisions_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;`,
  `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'template_revisions_restored_from_revision_id_fkey'
  ) THEN
    ALTER TABLE template_revisions
      ADD CONSTRAINT template_revisions_restored_from_revision_id_fkey
      FOREIGN KEY (restored_from_revision_id) REFERENCES template_revisions(id) ON DELETE SET NULL;
  END IF;
END $$;`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_revisions_source_check') THEN
    ALTER TABLE template_revisions
      ADD CONSTRAINT template_revisions_source_check CHECK (source IN ('create', 'update', 'restore'));
  END IF;
END $$;`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_active_revision_id_fkey') THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_active_revision_id_fkey
      FOREIGN KEY (active_revision_id) REFERENCES profile_revisions(id) ON DELETE SET NULL;
  END IF;
END $$;`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_profile_id_fkey') THEN
    ALTER TABLE students
      ADD CONSTRAINT students_profile_id_fkey
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;`,
  `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_profile_bindings_student_id_fkey'
  ) THEN
    ALTER TABLE student_profile_bindings
      ADD CONSTRAINT student_profile_bindings_student_id_fkey
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
  END IF;
END $$;`,
  `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_profile_bindings_profile_id_fkey'
  ) THEN
    ALTER TABLE student_profile_bindings
      ADD CONSTRAINT student_profile_bindings_profile_id_fkey
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE RESTRICT;
  END IF;
END $$;`,
  `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_profile_bindings_changed_by_fkey'
  ) THEN
    ALTER TABLE student_profile_bindings
      ADD CONSTRAINT student_profile_bindings_changed_by_fkey
      FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;`,
  `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_profile_bindings_effective_window_check'
  ) THEN
    ALTER TABLE student_profile_bindings
      ADD CONSTRAINT student_profile_bindings_effective_window_check
      CHECK (effective_to IS NULL OR effective_to > effective_from);
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
  `CREATE OR REPLACE FUNCTION set_students_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`,
  'DROP TRIGGER IF EXISTS set_students_updated_at ON students',
  `CREATE TRIGGER set_students_updated_at
BEFORE UPDATE ON students
FOR EACH ROW
EXECUTE FUNCTION set_students_updated_at()`,
  `CREATE OR REPLACE FUNCTION set_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`,
  'DROP TRIGGER IF EXISTS set_profiles_updated_at ON profiles',
  `CREATE TRIGGER set_profiles_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW
EXECUTE FUNCTION set_profiles_updated_at()`,
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

    await client.query(PROFILE_REVISIONS_TABLE_SQL);
    for (const statement of PROFILE_REVISIONS_SCHEMA_PATCHES) {
      await client.query(statement);
    }
    for (const indexSql of PROFILE_REVISIONS_INDEX_PATCHES) {
      await client.query(indexSql);
    }

    await client.query(TEMPLATE_REVISIONS_TABLE_SQL);
    for (const statement of TEMPLATE_REVISIONS_SCHEMA_PATCHES) {
      await client.query(statement);
    }
    for (const indexSql of TEMPLATE_REVISIONS_INDEX_PATCHES) {
      await client.query(indexSql);
    }

    await client.query(STUDENTS_TABLE_SQL);
    for (const statement of STUDENTS_SCHEMA_PATCHES) {
      await client.query(statement);
    }
    for (const indexSql of STUDENTS_INDEX_PATCHES) {
      await client.query(indexSql);
    }

    await client.query(PROFILES_TABLE_SQL);
    for (const statement of PROFILES_SCHEMA_PATCHES) {
      await client.query(statement);
    }
    for (const indexSql of PROFILES_INDEX_PATCHES) {
      await client.query(indexSql);
    }

    await client.query(STUDENT_PROFILE_BINDINGS_TABLE_SQL);
    for (const statement of STUDENT_PROFILE_BINDINGS_SCHEMA_PATCHES) {
      await client.query(statement);
    }
    for (const indexSql of STUDENT_PROFILE_BINDINGS_INDEX_PATCHES) {
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

    logger.info(
      'Ensured database schema (jobs, recordings, transcripts, prompt_packages, drafts, profile_revisions, template_revisions, students, profiles, student_profile_bindings, users)',
      {
        component: 'pg',
        event: 'schema_ready',
      },
    );
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
