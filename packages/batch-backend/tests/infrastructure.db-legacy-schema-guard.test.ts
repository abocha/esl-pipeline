import { describe, expect, it, vi } from 'vitest';

import { ensureJobsSchema } from '../src/infrastructure/db.js';

describe('retired runtime schema patching', () => {
  it.each([undefined, 'true'])(
    'cannot recreate a standalone profile graph with override %s',
    async (override) => {
      vi.stubEnv('PG_ENABLE_LEGACY_SCHEMA_PATCHES', override);
      const query = vi.fn();
      try {
        await expect(
          ensureJobsSchema({ query } as unknown as import('pg').PoolClient),
        ).rejects.toThrow('Legacy runtime schema patching is retired');
        expect(query).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
});
