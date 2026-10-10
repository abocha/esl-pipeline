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
        ESL_PIPELINE_MANIFEST_STORE: undefined,
        ESL_PIPELINE_CONFIG_PROVIDER: undefined,
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
        expect(cfg.recordings.maxFileSize).toBe(2 * 1024 * 1024 * 1024);
        expect(cfg.recordings.diskReserveBytes).toBe(10 * 1024 * 1024 * 1024);
        expect(cfg.recordings.audioCleanupEnabled).toBe(false);
        expect(cfg.recordings.audioRecoveryTtlDays).toBe(7);
        expect(cfg.deepgram.model).toBe('nova-3');
        expect(cfg.deepgram.language).toBe('multi');
        expect(cfg.deepgram.storeRawResponse).toBe(true);
        expect(cfg.worker.ttsCacheDir.replaceAll('\\', '/')).toMatch(/\/tmp\/tts-cache$/);
        expect(cfg.worker.ttsCacheMaxAgeDays).toBe(30);
        expect(cfg.worker.ttsCacheMaxBytes).toBe(10 * 1024 * 1024 * 1024);
        expect(cfg.worker.ttsCacheMaintenanceIntervalMinutes).toBe(60);
        expect(cfg.worker.ttsCacheMaintenanceLockKey).toBe('910021');
        expect(cfg.generation.providers.openai.requestTimeoutMs).toBe(240_000);
        // Orchestrator core defaults
        expect(cfg.orchestrator.manifestStore).toBe('filesystem');
        expect(cfg.orchestrator.configProvider).toBe('local');
        expect(cfg.jobOptions.allowStaticFallback).toBe(false);
        expect(cfg.voiceRanker).toEqual({
          enabled: true,
          model: 'gpt-5.6-luna',
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

  it('allows the ingest operational byte limit and disk reserve to be configured together', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        RECORDINGS_MAX_FILE_SIZE: '123456789',
        RECORDINGS_DISK_RESERVE_BYTES: '987654321',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.recordings).toEqual({
          maxFileSize: 123_456_789,
          diskReserveBytes: 987_654_321,
          audioCleanupEnabled: false,
          audioRecoveryTtlDays: 7,
        });
      },
    );
  });

  it('maps valid recording cleanup policy and rejects invalid values', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        RECORDING_AUDIO_CLEANUP_ENABLED: 'true',
        RECORDING_AUDIO_RECOVERY_TTL_DAYS: '14',
      },
      async () => {
        expect((await loadConfigFresh()).recordings).toMatchObject({
          audioCleanupEnabled: true,
          audioRecoveryTtlDays: 14,
        });
      },
    );
    await expect(
      withEnv({ NODE_ENV: 'test', RECORDING_AUDIO_CLEANUP_ENABLED: 'sometimes' }, async () => {
        await loadConfigFresh();
      }),
    ).rejects.toThrow('RECORDING_AUDIO_CLEANUP_ENABLED');
    await expect(
      withEnv({ NODE_ENV: 'test', RECORDING_AUDIO_RECOVERY_TTL_DAYS: '0' }, async () => {
        await loadConfigFresh();
      }),
    ).rejects.toThrow('RECORDING_AUDIO_RECOVERY_TTL_DAYS');
  });

  it('uses the batch-backend runtime prompt asset defaults when no overrides are set', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        PROMPT_TEMPLATE_PATH: undefined,
      },
      async () => {
        const cfg = await loadConfigFresh();

        expect(cfg.prompt).toMatchObject({
          templatePath: 'packages/batch-backend/prompt-assets/templates/hw_prompt_assignment_v1.md',
        });
      },
    );
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

  it.each(['google', 'openrouter', 'OPENAI'])(
    'rejects invalid speech planner provider %s',
    async (provider) => {
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
    },
  );
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

describe('config/env - explicit generation targets', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  it('loads intentional workload defaults and ignores retired graph settings', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        GEN_PROVIDER_DEFAULT: 'openrouter',
        GEN_PROVIDER_FALLBACKS: 'invalid',
        GEN_OPENAI_MODEL_FALLBACK: 'legacy',
        GEN_OPENAI_TARGET_MODELS_ENABLED: 'true',
        GEN_STRICT_NO_PAID: 'true',
        GEN_ALLOW_PAID_SPEND: 'true',
      },
      async () => {
        const cfg = await loadConfigFresh();
        expect(cfg.generation.targets).toEqual({
          draft_generation: { provider: 'openai', model: 'gpt-6.1-sol' },
          lesson_memory: { provider: 'openai', model: 'gpt-5.6-luna' },
          homework_memory: { provider: 'openai', model: 'gpt-5.6-luna' },
          student_memory_snapshot: { provider: 'openai', model: 'gpt-5.6-luna' },
          profile_revision_drafting: { provider: 'openai', model: 'gpt-5.6-luna' },
        });
        expect(cfg.generation).not.toHaveProperty('fallbackProviders');
        expect(cfg.generation).not.toHaveProperty('budgetEmergencyOverride');
      },
    );
  });
  it.each(['google_ai_studio', 'openrouter', 'invalid'])(
    'rejects retired or unknown provider %s at startup',
    async (provider) => {
      await withEnv({ NODE_ENV: 'test', GEN_LESSON_MEMORY_PROVIDER: provider }, async () => {
        await expect(loadConfigFresh()).rejects.toThrow('Generation provider must be openai');
      });
    },
  );
  it('keeps explicit OpenAI workload overrides independent', async () => {
    await withEnv({ NODE_ENV: 'test', GEN_HOMEWORK_MEMORY_MODEL: 'gpt-6.1-sol' }, async () => {
      const cfg = await loadConfigFresh();
      expect(cfg.generation.targets.homework_memory.model).toBe('gpt-6.1-sol');
      expect(cfg.generation.targets.lesson_memory.model).toBe('gpt-5.6-luna');
    });
  });
  it('retains safety mode validation', async () => {
    await withEnv({ NODE_ENV: 'test', GEN_SAFETY_MODE: 'invalid' }, async () => {
      await expect(loadConfigFresh()).rejects.toThrow('GEN_SAFETY_MODE');
    });
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
        expect(cfg.opsControl.artifactIntegrityCommand).toBe('');
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
        BATCH_BACKEND_OPS_CONTROL_ARTIFACT_INTEGRITY_COMMAND: 'echo integrity',
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
        expect(cfg.opsControl.artifactIntegrityCommand).toBe('echo integrity');
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
