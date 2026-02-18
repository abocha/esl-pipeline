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
        expect(cfg.transcription.queueName).toBe('transcribe-queue');
        expect(cfg.transcription.mode).toBe('timeline');
        expect(cfg.transcription.maxConcurrency).toBe(2);
        expect(cfg.recordings.maxFileSize).toBe(100 * 1024 * 1024);
        expect(cfg.deepgram.model).toBe('nova-3');
        expect(cfg.deepgram.language).toBe('multi');
        expect(cfg.deepgram.storeRawResponse).toBe(true);
        expect(cfg.studentSystem?.source).toBe('fs');
        expect(cfg.studentSystem?.fsFallback).toBe(true);

        // Orchestrator core defaults
        expect(cfg.orchestrator.manifestStore).toBeDefined();
        expect(['filesystem', 's3']).toContain(cfg.orchestrator.manifestStore);
        expect(['local', 'http']).toContain(cfg.orchestrator.configProvider);
      },
    );
  });
});

describe('config/env - student system source mapping', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('maps STUDENT_SYSTEM_SOURCE/STUDENT_SYSTEM_FS_FALLBACK into config', async () => {
    await withEnv(
      {
        NODE_ENV: 'production',
        STUDENT_SYSTEM_SOURCE: 'db',
        STUDENT_SYSTEM_FS_FALLBACK: 'false',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.studentSystem?.source).toBe('db');
        expect(cfg.studentSystem?.fsFallback).toBe(false);
      },
    );
  });

  it('throws on invalid STUDENT_SYSTEM_SOURCE', async () => {
    await expect(
      withEnv(
        {
          NODE_ENV: 'test',
          STUDENT_SYSTEM_SOURCE: 'legacy',
        },
        async () => {
          await loadConfigFresh();
        },
      ),
    ).rejects.toThrow('STUDENT_SYSTEM_SOURCE must be one of: fs, hybrid, db');
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
        ESL_PIPELINE_CONFIG_CACHE_TTL_MS: '15000',
        ESL_PIPELINE_CONFIG_CACHE_STALE_IF_ERROR_MS: '45000',
        ESL_PIPELINE_CONFIG_CONDITIONAL_REQUESTS: 'false',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.orchestrator.configProvider).toBe('http');
        expect(cfg.orchestrator.configEndpoint).toBe('https://config.example.com');
        expect(cfg.orchestrator.configToken).toBe('secret-token');
        expect(cfg.orchestrator.configCacheTtlMs).toBe(15000);
        expect(cfg.orchestrator.configCacheStaleIfErrorMs).toBe(45000);
        expect(cfg.orchestrator.configConditionalRequests).toBe(false);
      },
    );
  });

  it('rejects negative cache durations for remote config provider', async () => {
    await expect(
      withEnv(
        {
          NODE_ENV: 'test',
          ESL_PIPELINE_CONFIG_CACHE_TTL_MS: '-1',
        },
        async () => {
          await loadConfigFresh();
        },
      ),
    ).rejects.toThrow('ESL_PIPELINE_CONFIG_CACHE_TTL_MS must be a non-negative integer');
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

describe('config/env - generation provider mapping', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('loads generation defaults and provider order', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.generation.defaultProvider).toBe('openai');
        expect(cfg.generation.fallbackProviders).toEqual(['google_ai_studio', 'openrouter']);
        expect(cfg.generation.quotaSourceMode).toBe('hybrid');
        expect(cfg.generation.models.openai.primary).toBe('gpt-5.2');
      },
    );
  });

  it('maps generation env overrides', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        GEN_PROVIDER_DEFAULT: 'google_ai_studio',
        GEN_PROVIDER_FALLBACKS: 'openai,openrouter',
        GEN_QUOTA_SOURCE_MODE: 'provider',
        GEN_OPENAI_MODEL_PRIMARY: 'gpt-test',
        OPENAI_API_KEY: 'openai-key',
        GEMINI_API_KEY: 'google-key',
        OPENROUTER_API_KEY: 'router-key',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.generation.defaultProvider).toBe('google_ai_studio');
        expect(cfg.generation.fallbackProviders).toEqual(['openai', 'openrouter']);
        expect(cfg.generation.quotaSourceMode).toBe('provider');
        expect(cfg.generation.models.openai.primary).toBe('gpt-test');
        expect(cfg.generation.providers.openai.apiKey).toBe('openai-key');
        expect(cfg.generation.providers.googleAiStudio.apiKey).toBe('google-key');
        expect(cfg.generation.providers.openrouter.apiKey).toBe('router-key');
      },
    );
  });

  it('throws on invalid generation provider', async () => {
    await expect(
      withEnv(
        {
          NODE_ENV: 'test',
          GEN_PROVIDER_DEFAULT: 'invalid-provider',
        },
        async () => {
          await loadConfigFresh();
        },
      ),
    ).rejects.toThrow('Generation provider must be one of: openai, google_ai_studio, openrouter');
  });
});
