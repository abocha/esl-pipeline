import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const LEGACY_BEGIN_MARKER = 'LEGACY_SCHEMA_PATCH_CATALOG_BEGIN';
const LEGACY_END_MARKER = 'LEGACY_SCHEMA_PATCH_CATALOG_END';
const EXPECTED_LEGACY_PATCH_CATALOG_HASH =
  '31a6871a1b323d9b1b81f609873be9513068d868f5d5ef26b0443a1f584b1f1d';

describe('infrastructure/db legacy schema guard', () => {
  it('keeps legacy runtime schema patch catalog frozen', async () => {
    const dbPath = path.resolve(import.meta.dirname, '../src/infrastructure/db.ts');
    const source = await fs.readFile(dbPath, 'utf8');
    const start = source.indexOf(LEGACY_BEGIN_MARKER);
    const end = source.indexOf(LEGACY_END_MARKER);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const catalog = source.slice(start + LEGACY_BEGIN_MARKER.length, end);
    const hash = createHash('sha256').update(catalog).digest('hex');

    expect(hash).toBe(EXPECTED_LEGACY_PATCH_CATALOG_HASH);
  });

  it('requires explicit override to run legacy runtime schema patching', async () => {
    const original = process.env.PG_ENABLE_LEGACY_SCHEMA_PATCHES;
    delete process.env.PG_ENABLE_LEGACY_SCHEMA_PATCHES;

    try {
      const db = await import('../src/infrastructure/db.js');
      await expect(
        db.ensureJobsSchema({} as unknown as import('pg').PoolClient),
      ).rejects.toThrow('PG_ENABLE_LEGACY_SCHEMA_PATCHES=true is required');
    } finally {
      if (original === undefined) {
        delete process.env.PG_ENABLE_LEGACY_SCHEMA_PATCHES;
      } else {
        process.env.PG_ENABLE_LEGACY_SCHEMA_PATCHES = original;
      }
    }
  });
});
