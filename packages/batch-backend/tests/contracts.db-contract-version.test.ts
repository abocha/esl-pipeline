import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { DB_MIGRATION_HEAD } from '../../contracts/src/contract-versions.js';

describe('contracts/db contract version', () => {
  it('publishes the homework-memory publication sequence migration head', () => {
    expect(DB_MIGRATION_HEAD).toBe('0046_jobs_publication_sequence');
  });

  it('tracks the latest backend migration head', async () => {
    const migrationsDir = path.resolve(import.meta.dirname, '../migrations');
    const entries = await fs.readdir(migrationsDir);
    const latestMigrationId = entries
      .filter((entry) => /^\d{4}_.+\.sql$/.test(entry))
      .sort((left, right) => left.localeCompare(right))
      .at(-1)
      ?.replace(/\.sql$/, '');

    expect(latestMigrationId).toBe(DB_MIGRATION_HEAD);
  });
});
