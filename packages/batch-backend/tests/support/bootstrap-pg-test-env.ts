import { mkdirSync } from 'node:fs';
import { Pool } from 'pg';

import { loadBatchBackendEnv } from '../../src/bootstrap/env.js';
import { tryConfigurePgTestRuntimeEnv } from '../../src/bootstrap/pg-test-env.js';
import { closeMigrationPool, runMigrations } from '../../src/infrastructure/migrations.js';

loadBatchBackendEnv(import.meta.url, 'batch-backend-test-pg-bootstrap');

const resolved = tryConfigurePgTestRuntimeEnv();
if (resolved) {
  mkdirSync(resolved.tmpDir, { recursive: true });
  await runMigrations();
  await closeMigrationPool();
  // Legacy persistence fixtures predate workspace ownership and insert students directly.
  // Keep production strict while assigning those test-only rows to the canonical fixture workspace.
  const pool = new Pool({ connectionString: resolved.connectionString });
  try {
    await pool.query(
      `ALTER TABLE students ALTER COLUMN workspace_id
       SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid`,
    );
    await pool.query(`
      CREATE OR REPLACE FUNCTION ensure_test_default_workspace()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO workspaces (id, name)
        VALUES ('00000000-0000-4000-8000-000000000001', 'Test workspace')
        ON CONFLICT (id) DO NOTHING;
        RETURN NEW;
      END $$;
      DROP TRIGGER IF EXISTS students_test_default_workspace_trigger ON students;
      CREATE TRIGGER students_test_default_workspace_trigger
      BEFORE INSERT ON students
      FOR EACH ROW EXECUTE FUNCTION ensure_test_default_workspace();
    `);
  } finally {
    await pool.end();
  }
}
