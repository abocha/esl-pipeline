import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { getVersionMeta } from '../src/application/version-meta.js';

describe('contracts/db contract version', () => {
  it('publishes the latest packaged backend migration as the expected release head', async () => {
    const migrationsDir = path.resolve(import.meta.dirname, '../migrations');
    const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
    const latestMigrationId = entries
      .filter((entry) => entry.isFile() && /^\d{4}_[a-z0-9_]+\.sql$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
      .at(-1)
      ?.replace(/\.sql$/, '');

    expect(latestMigrationId).toBeTruthy();
    expect(getVersionMeta().contracts.dbMigrationHead).toBe(latestMigrationId);
  });
});
