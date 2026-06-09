import { describe, expect, it, vi } from 'vitest';

import type { BatchBackendConfig } from '../src/config/env.js';
import { checkBackendHealth } from '../src/infrastructure/health-checks.js';

const baseConfig = {
  pg: { enabled: false },
  redis: { enabled: false },
} as BatchBackendConfig;

describe('infrastructure/health-checks', () => {
  it('reports disabled dependencies as skipped', async () => {
    const health = await checkBackendHealth(baseConfig, {
      checkPostgres: vi.fn(),
      checkRedis: vi.fn(),
    });

    expect(health).toEqual({
      ok: true,
      service: 'batch-backend',
      checks: {
        api: { ok: true },
        postgres: { ok: true, skipped: true },
        redis: { ok: true, skipped: true },
      },
    });
  });

  it('returns an unhealthy result when an enabled dependency fails without leaking the error', async () => {
    const health = await checkBackendHealth(
      {
        ...baseConfig,
        pg: { ...baseConfig.pg, enabled: true },
      } as BatchBackendConfig,
      {
        checkPostgres: vi.fn().mockRejectedValue(new Error('postgresql://user:secret@db/app')),
        checkRedis: vi.fn(),
      },
    );

    expect(health.ok).toBe(false);
    expect(health.checks.postgres).toEqual({ ok: false });
    expect(JSON.stringify(health)).not.toContain('secret');
    expect(JSON.stringify(health)).not.toContain('postgresql://');
  });
});
