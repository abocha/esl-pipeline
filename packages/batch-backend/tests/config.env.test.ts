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
        expect(cfg.worker.ttsCacheDir.replaceAll('\\', '/')).toMatch(/\/tmp\/tts-cache$/);
        expect(cfg.worker.ttsCacheMaxAgeDays).toBe(30);
        expect(cfg.worker.ttsCacheMaxBytes).toBe(10 * 1024 * 1024 * 1024);
        expect(cfg.worker.ttsCacheMaintenanceIntervalMinutes).toBe(60);
        expect(cfg.worker.ttsCacheMaintenanceLockKey).toBe('910021');
        expect(cfg.generation.providers.openai.requestTimeoutMs).toBe(240_000);
        expect(cfg.generation.providers.googleAiStudio.requestTimeoutMs).toBe(240_000);
        expect(cfg.generation.providers.openrouter.requestTimeoutMs).toBe(240_000);
        expect(cfg.generation.models.googleAiStudio.allowed).toEqual(
          expect.arrayContaining(['gemma-4-31b-it', 'gemma-4-26b-a4b-it']),
        );
        // Orchestrator core defaults
        expect(cfg.orchestrator.manifestStore).toBeDefined();
        expect(['filesystem', 's3']).toContain(cfg.orchestrator.manifestStore);
        expect(['local', 'http']).toContain(cfg.orchestrator.configProvider);
        expect(cfg.jobOptions.allowStaticFallback).toBe(false);
        expect(cfg.voiceRanker).toEqual({
          enabled: true,
          model: 'gemma-4-31b-it',
          maxOutputTokens: 1200,
          rpmBudget: 12,
          dailyRequestBudget: 1000,
          debugLogPlan: false,
        });
        expect(cfg.speechPlanner.rpmBudget).toBe(4);
        expect(cfg.speechPlanner.dailyRequestBudget).toBe(120);
        expect(cfg.speechPlanner.maxOutputTokens).toBe(12000);
        expect(cfg.speechPlanner.debugLogPlan).toBe(false);
        expect(cfg.speechPlanner).toMatchObject({
          enabled: false,
          provider: 'openai',
          model: 'gpt-5.6-luna',
        });
      },
    );
  });
});

describe('config/env - OpenAI target-model gate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses GPT-5.6 family defaults while preserving the disabled compatibility gate', async () => {
    await withEnv({ NODE_ENV: 'test', GEN_OPENAI_TARGET_MODELS_ENABLED: 'false' }, async () => {
      const cfg = await loadConfigFresh();
      expect(cfg.generation.models.openai.targetModelsEnabled).toBe(false);
      expect(cfg.generation.models.openai.primary).toBe('gpt-5.6-sol');
      expect(cfg.generation.models.openai.fallback).toBe('gpt-5.6-luna');
      expect(cfg.generation.models.openai.studentMemoryPrimary).toBe('gpt-5.6-luna');
      expect(cfg.generation.models.openai.studentMemoryFallback).toBe('gpt-5.6-luna');
      expect(cfg.generation.models.openai.profileDraftPrimary).toBe('gpt-5.6-luna');
      expect(cfg.generation.models.openai.profileDraftFallback).toBe('gpt-5.6-luna');
      expect(cfg.generation.models.openai.profileDraftTertiary).toBe('gpt-5.6-luna');
      expect(cfg.generation.models.openai.allowed).toEqual(['gpt-5.6-sol', 'gpt-5.6-luna']);
    });
  });

  it('uses the same GPT-5.6 family defaults when the compatibility gate is enabled', async () => {
    await withEnv({ NODE_ENV: 'test', GEN_OPENAI_TARGET_MODELS_ENABLED: 'true' }, async () => {
      const cfg = await loadConfigFresh();
      expect(cfg.generation.models.openai.targetModelsEnabled).toBe(true);
      expect(cfg.generation.models.openai.primary).toBe('gpt-5.6-sol');
      expect(cfg.generation.models.openai.fallback).toBe('gpt-5.6-luna');
      expect(cfg.generation.models.openai.studentMemoryPrimary).toBe('gpt-5.6-luna');
      expect(cfg.generation.models.openai.studentMemoryFallback).toBe('gpt-5.6-luna');
      expect(cfg.generation.models.openai.profileDraftPrimary).toBe('gpt-5.6-luna');
      expect(cfg.generation.models.openai.profileDraftFallback).toBe('gpt-5.6-luna');
      expect(cfg.generation.models.openai.profileDraftTertiary).toBe('gpt-5.6-luna');
      expect(cfg.generation.models.openai.allowed).toEqual(['gpt-5.6-sol', 'gpt-5.6-luna']);
    });
  });

  it('allows every default OpenAI workload model when the target ladder is enabled', async () => {
    await withEnv({ NODE_ENV: 'test', GEN_OPENAI_TARGET_MODELS_ENABLED: 'true' }, async () => {
      delete process.env.GEN_OPENAI_MODEL_PRIMARY;
      delete process.env.GEN_OPENAI_MODEL_FALLBACK;
      delete process.env.GEN_OPENAI_MODEL_STUDENT_MEMORY_PRIMARY;
      delete process.env.GEN_OPENAI_MODEL_STUDENT_MEMORY_FALLBACK;
      delete process.env.GEN_OPENAI_MODEL_PROFILE_DRAFT_PRIMARY;
      delete process.env.GEN_OPENAI_MODEL_PROFILE_DRAFT_FALLBACK;
      delete process.env.GEN_OPENAI_MODEL_PROFILE_DRAFT_TERTIARY;
      delete process.env.GEN_ALLOWED_MODELS_OPENAI;

      const cfg = await loadConfigFresh();

      expect(cfg.generation.models.openai.allowed).toEqual(
        expect.arrayContaining([
          cfg.generation.models.openai.primary,
          cfg.generation.models.openai.fallback,
          cfg.generation.models.openai.studentMemoryPrimary,
          cfg.generation.models.openai.studentMemoryFallback,
          cfg.generation.models.openai.profileDraftPrimary,
          cfg.generation.models.openai.profileDraftFallback,
          cfg.generation.models.openai.profileDraftTertiary,
        ]),
      );
    });
  });
});

describe('config/env - speech planner debug logging', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('maps ESL_TTS_SPEECH_PLANNER_DEBUG_LOG_PLAN override', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        ESL_TTS_SPEECH_PLANNER_DEBUG_LOG_PLAN: 'true',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.speechPlanner.debugLogPlan).toBe(true);
      },
    );
  });
});

describe('config/env - speech planner provider selection', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('accepts an explicit OpenAI Luna selection matching the built-in default', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        ESL_TTS_SPEECH_PLANNER_PROVIDER: 'openai',
        ESL_TTS_SPEECH_PLANNER_MODEL: 'gpt-5.6-luna',
      },
      async () => {
        expect((await loadConfigFresh()).speechPlanner).toMatchObject({
          enabled: false,
          provider: 'openai',
          model: 'gpt-5.6-luna',
        });
      },
    );
  });

  it.each([
    'google',
    'openrouter',
    'OPENAI',
  ])('rejects invalid speech planner provider %s', async (provider) => {
    await expect(
      withEnv(
        {
          NODE_ENV: 'test',
          ESL_TTS_SPEECH_PLANNER_PROVIDER: provider,
        },
        async () => {
          await loadConfigFresh();
        },
      ),
    ).rejects.toThrow('ESL_TTS_SPEECH_PLANNER_PROVIDER');
  });
});

describe('config/env - job options static fallback gate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('maps BATCH_BACKEND_JOB_OPTIONS_ALLOW_STATIC_FALLBACK override', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        BATCH_BACKEND_JOB_OPTIONS_ALLOW_STATIC_FALLBACK: 'true',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.jobOptions.allowStaticFallback).toBe(true);
      },
    );
  });
});

describe('config/env - deprecated student system env vars', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws when STUDENT_SYSTEM_SOURCE is set', async () => {
    await expect(
      withEnv(
        {
          NODE_ENV: 'test',
          STUDENT_SYSTEM_SOURCE: 'db',
        },
        async () => {
          await loadConfigFresh();
        },
      ),
    ).rejects.toThrow(
      'STUDENT_SYSTEM_SOURCE has been removed. Student profile storage is now DB-only.',
    );
  });

  it('throws when STUDENT_SYSTEM_FS_FALLBACK is set', async () => {
    await expect(
      withEnv(
        {
          NODE_ENV: 'test',
          STUDENT_SYSTEM_FS_FALLBACK: 'true',
        },
        async () => {
          await loadConfigFresh();
        },
      ),
    ).rejects.toThrow(
      'STUDENT_SYSTEM_FS_FALLBACK has been removed. Student profile storage is now DB-only.',
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

describe('config/env - STT provider defaults', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses ESL_STT_DEFAULT_PROVIDER when STT_PROVIDER is unset', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        STT_PROVIDER: '',
        ESL_STT_DEFAULT_PROVIDER: 'google',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.transcription.sttProvider).toBe('google');
        expect(cfg.stt.defaultProvider).toBe('google');
      },
    );
  });

  it('allows STT_PROVIDER to override ESL_STT_DEFAULT_PROVIDER when explicitly set', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        STT_PROVIDER: 'deepgram',
        ESL_STT_DEFAULT_PROVIDER: 'google',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.transcription.sttProvider).toBe('deepgram');
        expect(cfg.stt.defaultProvider).toBe('google');
      },
    );
  });

  it('includes active STT_PROVIDER in advertised sttProviders when missing from provider order', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        STT_PROVIDER: 'google',
        ESL_STT_DEFAULT_PROVIDER: 'deepgram',
        ESL_STT_PROVIDER_ORDER: 'deepgram,elevenlabs',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.transcription.sttProvider).toBe('google');
        expect(cfg.transcription.sttProviders).toContain('google');
      },
    );
  });
});

describe('config/env - TTS cache retention validation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('rejects negative TTS cache retention values', async () => {
    await expect(
      withEnv(
        {
          NODE_ENV: 'test',
          BATCH_TTS_CACHE_MAX_AGE_DAYS: '-1',
        },
        async () => {
          await loadConfigFresh();
        },
      ),
    ).rejects.toThrow('BATCH_TTS_CACHE_MAX_AGE_DAYS must be a non-negative integer');
  });

  it('rejects non-integer cache maintenance lock key', async () => {
    await expect(
      withEnv(
        {
          NODE_ENV: 'test',
          BATCH_TTS_CACHE_MAINTENANCE_LOCK_KEY: 'invalid',
        },
        async () => {
          await loadConfigFresh();
        },
      ),
    ).rejects.toThrow(
      'BATCH_TTS_CACHE_MAINTENANCE_LOCK_KEY must be an integer value representable as bigint',
    );
  });

  it('rejects out-of-range cache maintenance lock key', async () => {
    await expect(
      withEnv(
        {
          NODE_ENV: 'test',
          BATCH_TTS_CACHE_MAINTENANCE_LOCK_KEY: '9223372036854775808',
        },
        async () => {
          await loadConfigFresh();
        },
      ),
    ).rejects.toThrow(
      'BATCH_TTS_CACHE_MAINTENANCE_LOCK_KEY must be an integer value representable as bigint',
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
        expect(cfg.generation.safetyMode).toBe('hard_stop');
        expect(cfg.generation.strictNoPaid).toBe(true);
        expect(cfg.generation.maxOutputTokensHard).toBe(12000);
        expect(cfg.generation.budgetEmergencyOverride).toBe(false);
        expect(cfg.generation.models.openai.primary).toBe('gpt-5.6-sol');
        expect(cfg.generation.models.openai.fallback).toBe('gpt-5.6-luna');
        expect(cfg.generation.models.openai.studentMemoryPrimary).toBe('gpt-5.6-luna');
        expect(cfg.generation.models.openai.studentMemoryFallback).toBe('gpt-5.6-luna');
        expect(cfg.generation.models.openai.profileDraftPrimary).toBe('gpt-5.6-luna');
        expect(cfg.generation.models.openai.profileDraftFallback).toBe('gpt-5.6-luna');
        expect(cfg.generation.models.openai.profileDraftTertiary).toBe('gpt-5.6-luna');
        expect(cfg.generation.models.googleAiStudio.primary).toBe('gemini-3-flash-preview');
        expect(cfg.generation.models.googleAiStudio.allowed).toEqual(
          expect.arrayContaining(['gemini-3-flash-preview', 'gemini-3.5-flash']),
        );
        expect(cfg.generation.providers.openai.dailyTokenBudget).toBe(120000);
        expect(cfg.generation.providers.openai.tpmBudget).toBe(160000);
        expect(cfg.generation.providers.openrouter.dailyTokenBudget).toBe(0);
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
        GEN_SAFETY_MODE: 'warn',
        GEN_STRICT_NO_PAID: 'false',
        GEN_MAX_OUTPUT_TOKENS_HARD: '900',
        GEN_OPENAI_MODEL_PRIMARY: 'gpt-test',
        GEN_OPENAI_MODEL_FALLBACK: 'gpt-small',
        GEN_OPENAI_MODEL_STUDENT_MEMORY_PRIMARY: 'gpt-memory',
        GEN_OPENAI_MODEL_STUDENT_MEMORY_FALLBACK: 'gpt-memory-fallback',
        GEN_OPENAI_MODEL_PROFILE_DRAFT_PRIMARY: 'gpt-big',
        GEN_OPENAI_MODEL_PROFILE_DRAFT_FALLBACK: 'gpt-big-fallback',
        GEN_OPENAI_MODEL_PROFILE_DRAFT_TERTIARY: 'gpt-big-tertiary',
        GEN_ALLOWED_MODELS_OPENAI: 'gpt-test,gpt-mini',
        OPENAI_API_KEY: 'openai-key',
        GEN_OPENAI_TPM_BUDGET: '777',
        GEMINI_API_KEY: 'google-key',
        OPENROUTER_API_KEY: 'router-key',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.generation.defaultProvider).toBe('google_ai_studio');
        expect(cfg.generation.fallbackProviders).toEqual(['openai', 'openrouter']);
        expect(cfg.generation.quotaSourceMode).toBe('provider');
        expect(cfg.generation.safetyMode).toBe('warn');
        expect(cfg.generation.strictNoPaid).toBe(false);
        expect(cfg.generation.maxOutputTokensHard).toBe(900);
        expect(cfg.generation.models.openai.primary).toBe('gpt-test');
        expect(cfg.generation.models.openai.fallback).toBe('gpt-small');
        expect(cfg.generation.models.openai.studentMemoryPrimary).toBe('gpt-memory');
        expect(cfg.generation.models.openai.studentMemoryFallback).toBe('gpt-memory-fallback');
        expect(cfg.generation.models.openai.profileDraftPrimary).toBe('gpt-big');
        expect(cfg.generation.models.openai.profileDraftFallback).toBe('gpt-big-fallback');
        expect(cfg.generation.models.openai.profileDraftTertiary).toBe('gpt-big-tertiary');
        expect(cfg.generation.models.openai.allowed).toEqual(['gpt-test', 'gpt-mini']);
        expect(cfg.generation.providers.openai.apiKey).toBe('openai-key');
        expect(cfg.generation.providers.openai.tpmBudget).toBe(777);
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

  it('throws on invalid generation safety mode', async () => {
    await expect(
      withEnv(
        {
          NODE_ENV: 'test',
          GEN_SAFETY_MODE: 'strictest',
        },
        async () => {
          await loadConfigFresh();
        },
      ),
    ).rejects.toThrow('GEN_SAFETY_MODE must be one of: off, warn, hard_stop');
  });

  it('enables emergency override via GEN_ALLOW_PAID_SPEND', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        GEN_ALLOW_PAID_SPEND: 'true',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.generation.budgetEmergencyOverride).toBe(true);
      },
    );
  });

  it('ignores deprecated GEN_BUDGET_EMERGENCY_OVERRIDE alias', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        GEN_BUDGET_EMERGENCY_OVERRIDE: 'true',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.generation.budgetEmergencyOverride).toBe(false);
      },
    );
  });
});

describe('config/env - ops control settings', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('provides safe defaults for ops control', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.opsControl.enabled).toBe(false);
        expect(cfg.opsControl.botSharedSecret).toBeUndefined();
        expect(cfg.opsControl.statusCommand).toBe('');
        expect(cfg.opsControl.backupCommand).toBe('');
        expect(cfg.opsControl.restoreDrillCommand).toBe('');
        expect(cfg.opsControl.actionTimeoutMs).toBe(10 * 60 * 1000);
        expect(cfg.opsControl.actionHistoryLimit).toBe(100);
        expect(cfg.opsControl.actionRetentionDays).toBe(30);
      },
    );
  });

  it('maps ops control overrides', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        BATCH_BACKEND_ENABLE_OPS_CONTROL: 'true',
        BATCH_BACKEND_OPS_CONTROL_BOT_SECRET: 'secret-token',
        BATCH_BACKEND_OPS_CONTROL_STATUS_COMMAND: 'echo {}',
        BATCH_BACKEND_OPS_CONTROL_BACKUP_COMMAND: 'echo backup',
        BATCH_BACKEND_OPS_CONTROL_RESTORE_DRILL_COMMAND: 'echo drill',
        BATCH_BACKEND_OPS_CONTROL_ACTION_TIMEOUT_MS: '45000',
        BATCH_BACKEND_OPS_CONTROL_ACTION_HISTORY_LIMIT: '42',
        BATCH_BACKEND_OPS_CONTROL_ACTION_RETENTION_DAYS: '14',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.opsControl.enabled).toBe(true);
        expect(cfg.opsControl.botSharedSecret).toBe('secret-token');
        expect(cfg.opsControl.statusCommand).toBe('echo {}');
        expect(cfg.opsControl.backupCommand).toBe('echo backup');
        expect(cfg.opsControl.restoreDrillCommand).toBe('echo drill');
        expect(cfg.opsControl.actionTimeoutMs).toBe(45000);
        expect(cfg.opsControl.actionHistoryLimit).toBe(42);
        expect(cfg.opsControl.actionRetentionDays).toBe(14);
      },
    );
  });

  it('rejects out-of-range timeout/history/retention settings', async () => {
    await expect(
      withEnv(
        {
          NODE_ENV: 'test',
          BATCH_BACKEND_OPS_CONTROL_ACTION_TIMEOUT_MS: '999',
        },
        async () => {
          await loadConfigFresh();
        },
      ),
    ).rejects.toThrow(
      'BATCH_BACKEND_OPS_CONTROL_ACTION_TIMEOUT_MS must be between 1000 and 3600000',
    );

    await expect(
      withEnv(
        {
          NODE_ENV: 'test',
          BATCH_BACKEND_OPS_CONTROL_ACTION_HISTORY_LIMIT: '0',
        },
        async () => {
          await loadConfigFresh();
        },
      ),
    ).rejects.toThrow('BATCH_BACKEND_OPS_CONTROL_ACTION_HISTORY_LIMIT must be between 1 and 1000');

    await expect(
      withEnv(
        {
          NODE_ENV: 'test',
          BATCH_BACKEND_OPS_CONTROL_ACTION_RETENTION_DAYS: '0',
        },
        async () => {
          await loadConfigFresh();
        },
      ),
    ).rejects.toThrow('BATCH_BACKEND_OPS_CONTROL_ACTION_RETENTION_DAYS must be between 1 and 3650');
  });
});

describe('config/env - postgres pool tuning', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('provides defaults for postgres pool tuning env vars', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.pg.applicationName).toBe('esl-pipeline-batch-backend');
        expect(cfg.pg.poolMax).toBe(10);
        expect(cfg.pg.idleTimeoutMs).toBe(30_000);
        expect(cfg.pg.connectionTimeoutMs).toBe(5_000);
      },
    );
  });

  it('maps postgres pool tuning env overrides', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        PG_POOL_MAX: '25',
        PG_APPLICATION_NAME: 'esl-pipeline-test-worker',
        PG_IDLE_TIMEOUT_MS: '45000',
        PG_CONNECTION_TIMEOUT_MS: '8000',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.pg.applicationName).toBe('esl-pipeline-test-worker');
        expect(cfg.pg.poolMax).toBe(25);
        expect(cfg.pg.idleTimeoutMs).toBe(45_000);
        expect(cfg.pg.connectionTimeoutMs).toBe(8_000);
      },
    );
  });

  it('throws when PG_POOL_MAX is out of range', async () => {
    await expect(
      withEnv(
        {
          NODE_ENV: 'test',
          PG_POOL_MAX: '0',
        },
        async () => {
          await loadConfigFresh();
        },
      ),
    ).rejects.toThrow('PG_POOL_MAX must be between 1 and 100');
  });

  it('throws when PG_IDLE_TIMEOUT_MS is out of range', async () => {
    await expect(
      withEnv(
        {
          NODE_ENV: 'test',
          PG_IDLE_TIMEOUT_MS: '999',
        },
        async () => {
          await loadConfigFresh();
        },
      ),
    ).rejects.toThrow('PG_IDLE_TIMEOUT_MS must be between 1000 and 600000');
  });

  it('throws when PG_CONNECTION_TIMEOUT_MS is out of range', async () => {
    await expect(
      withEnv(
        {
          NODE_ENV: 'test',
          PG_CONNECTION_TIMEOUT_MS: '99',
        },
        async () => {
          await loadConfigFresh();
        },
      ),
    ).rejects.toThrow('PG_CONNECTION_TIMEOUT_MS must be between 100 and 120000');
  });
});
