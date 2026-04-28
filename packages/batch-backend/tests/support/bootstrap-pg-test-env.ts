import { mkdirSync } from 'node:fs';

import { loadBatchBackendEnv } from '../../src/bootstrap/env.js';
import { tryConfigurePgTestRuntimeEnv } from '../../src/bootstrap/pg-test-env.js';
import { closeMigrationPool, runMigrations } from '../../src/infrastructure/migrations.js';

loadBatchBackendEnv(import.meta.url, 'batch-backend-test-pg-bootstrap');

const resolved = tryConfigurePgTestRuntimeEnv();
if (resolved) {
  mkdirSync(resolved.tmpDir, { recursive: true });
  await runMigrations();
  await closeMigrationPool();
}
