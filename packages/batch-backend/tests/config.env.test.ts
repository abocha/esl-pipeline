import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from '../src/config/env';

/**
 * Intent:
 * - Guard critical configuration behavior:
 *   - Required vs defaulted values for core services.
 *   - Queue + orchestrator mapping used by batch-backend.
 * - Focused on stability-critical paths; does not exhaustively test all env branches.
 */

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const oldEnv = { ...process.env };
  process.env = { ...process.env, ...env };
  try {
    fn();
  } finally {
    process.env = oldEnv;
  }
}

function resetEnvModule() {
  try {
    const id = require.resolve('../src/config/env');
    // Best-effort cache busting for CJS; Vitest ESM loader will re-evaluate on next import/usage.
    delete require.cache[id];
  } catch {
    // Ignore resolution errors to avoid MODULE_NOT_FOUND during test setup.
  }
}

describe('config/env - core defaults', () => {
  beforeEach(() => {
    resetEnvModule();
  });

  it('provides sane defaults for queue and orchestrator when minimal env is set', () => {
    withEnv(
      {
        NODE_ENV: 'test',
      },
      () => {
        const cfg = loadConfig();

        // HTTP
        expect(cfg.httpPort).toBe(8080);

        // Queue
        expect(cfg.queue.name).toBe('esl-jobs');

        // Orchestrator core defaults
        expect(cfg.orchestrator.manifestStore).toBeDefined();
        expect(['filesystem', 's3']).toContain(cfg.orchestrator.manifestStore);
        expect(['local', 'http']).toContain(cfg.orchestrator.configProvider);
      }
    );
  });
});

describe('config/env - orchestrator manifest store mapping', () => {
  beforeEach(() => {
    resetEnvModule();
  });

  it('maps ESL_PIPELINE_MANIFEST_STORE=s3 and bucket into orchestrator config', () => {
    withEnv(
      {
        NODE_ENV: 'test',
        ESL_PIPELINE_MANIFEST_STORE: 's3',
        ESL_PIPELINE_MANIFEST_BUCKET: 'my-bucket',
        ESL_PIPELINE_MANIFEST_PREFIX: 'prefix/',
        ESL_PIPELINE_MANIFEST_ROOT: '/root',
      },
      () => {
        const cfg = loadConfig();
        expect(cfg.orchestrator.manifestStore).toBe('s3');
        expect(cfg.orchestrator.manifestBucket).toBe('my-bucket');
        expect(cfg.orchestrator.manifestPrefix).toBe('prefix/');
        expect(cfg.orchestrator.manifestRoot).toBe('/root');
      }
    );
  });
});

describe('config/env - orchestrator remote config provider mapping', () => {
  beforeEach(() => {
    resetEnvModule();
  });

  it('maps ESL_PIPELINE_CONFIG_PROVIDER=http into orchestrator config', () => {
    withEnv(
      {
        NODE_ENV: 'test',
        ESL_PIPELINE_CONFIG_PROVIDER: 'http',
        ESL_PIPELINE_CONFIG_ENDPOINT: 'https://config.example.com',
        ESL_PIPELINE_CONFIG_TOKEN: 'secret-token',
      },
      () => {
        const cfg = loadConfig();
        expect(cfg.orchestrator.configProvider).toBe('http');
        expect(cfg.orchestrator.configEndpoint).toBe('https://config.example.com');
        expect(cfg.orchestrator.configToken).toBe('secret-token');
      }
    );
  });
});
