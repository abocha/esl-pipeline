import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Intent:
 * - Guard critical configuration behavior:
 *   - Required vs defaulted values for core services.
 *   - Queue + orchestrator mapping used by batch-backend.
 * - Focused on stability-critical paths; does not exhaustively test all env branches.
 */

async function withEnv(env: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const oldEnv = { ...process.env };
  process.env = { ...process.env, ...env };
  try {
    await fn();
  } finally {
    process.env = oldEnv;
  }
}

async function loadConfigFresh() {
  const module = await import('../src/config/env.js');
  return module.loadConfig();
}

describe('config/env - core defaults', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('provides sane defaults for queue and orchestrator when minimal env is set', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
      },
      async () => {
        const cfg = await loadConfigFresh();

        // HTTP
        expect(cfg.httpPort).toBe(8080);

        // Queue
        expect(cfg.queue.name).toBe('esl-jobs');

        // Orchestrator core defaults
        expect(cfg.orchestrator.manifestStore).toBeDefined();
        expect(['filesystem', 's3']).toContain(cfg.orchestrator.manifestStore);
        expect(['local', 'http']).toContain(cfg.orchestrator.configProvider);
      },
    );
  });
});

describe('config/env - orchestrator manifest store mapping', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('maps ESL_PIPELINE_MANIFEST_STORE=s3 and bucket into orchestrator config', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        ESL_PIPELINE_MANIFEST_STORE: 's3',
        ESL_PIPELINE_MANIFEST_BUCKET: 'my-bucket',
        ESL_PIPELINE_MANIFEST_PREFIX: 'prefix/',
        ESL_PIPELINE_MANIFEST_ROOT: '/root',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.orchestrator.manifestStore).toBe('s3');
        expect(cfg.orchestrator.manifestBucket).toBe('my-bucket');
        expect(cfg.orchestrator.manifestPrefix).toBe('prefix/');
        expect(cfg.orchestrator.manifestRoot).toBe('/root');
      },
    );
  });
});

describe('config/env - orchestrator remote config provider mapping', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('maps ESL_PIPELINE_CONFIG_PROVIDER=http into orchestrator config', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        ESL_PIPELINE_CONFIG_PROVIDER: 'http',
        ESL_PIPELINE_CONFIG_ENDPOINT: 'https://config.example.com',
        ESL_PIPELINE_CONFIG_TOKEN: 'secret-token',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.orchestrator.configProvider).toBe('http');
        expect(cfg.orchestrator.configEndpoint).toBe('https://config.example.com');
        expect(cfg.orchestrator.configToken).toBe('secret-token');
      },
    );
  });
});

describe('config/env - storage provider defaults', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('defaults to s3 when credentials are present', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        S3_BUCKET: 'test-bucket',
        AWS_ACCESS_KEY_ID: 'test-key',
        AWS_SECRET_ACCESS_KEY: 'test-secret',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.storage.provider).toBe('s3');
      },
    );
  });

  it('falls back to filesystem when s3 credentials are missing', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        S3_BUCKET: 'test-bucket',
        AWS_ACCESS_KEY_ID: 'test-key',
        AWS_SECRET_ACCESS_KEY: '',
        S3_SECRET_ACCESS_KEY: '',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.storage.provider).toBe('filesystem');
      },
    );
  });

  it('throws on invalid STORAGE_PROVIDER', async () => {
    await expect(
      withEnv(
        {
          NODE_ENV: 'test',
          STORAGE_PROVIDER: 'minio',
        },
        async () => {
          await loadConfigFresh();
        },
      ),
    ).rejects.toThrow('STORAGE_PROVIDER must be either "s3" or "filesystem"');
  });

  it('throws when STORAGE_PROVIDER is s3 but credentials are missing', async () => {
    await expect(
      withEnv(
        {
          NODE_ENV: 'test',
          STORAGE_PROVIDER: 's3',
          S3_BUCKET: '',
          S3_BUCKET_NAME: '',
          STORAGE_BUCKET_NAME: '',
          AWS_ACCESS_KEY_ID: '',
          AWS_SECRET_ACCESS_KEY: '',
          S3_ACCESS_KEY_ID: '',
          S3_SECRET_ACCESS_KEY: '',
        },
        async () => {
          await loadConfigFresh();
        },
      ),
    ).rejects.toThrow(
      'STORAGE_PROVIDER=s3 requires S3_BUCKET_NAME/STORAGE_BUCKET_NAME and S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY (or AWS_ equivalents)',
    );
  });
});
