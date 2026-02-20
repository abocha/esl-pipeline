// packages/batch-backend/src/config/env.ts
// Centralized environment-based configuration for the batch-backend.
// - Safe Docker/Docker Compose defaults.
// - Postgres/Redis are optional and enabled via env flags.
// - Only throws when a feature is explicitly enabled but misconfigured.
import { readBool, readInt, readString } from '@esl-pipeline/shared-infrastructure';
import type { GenerationProvider, GenerationQuotaSource } from '@esl-pipeline/contracts';

export type GenerationSafetyMode = 'off' | 'warn' | 'hard_stop';

export type NodeEnv = 'development' | 'test' | 'production';

export interface BatchBackendConfig {
  nodeEnv: NodeEnv;
  httpPort: number;
  pg: {
    enabled: boolean;
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    connectionString?: string;
    poolMax: number;
    idleTimeoutMs: number;
    connectionTimeoutMs: number;
    autoMigrateOnBoot: boolean;
    migrationLockKey: string;
    migrationsDir?: string;
  };
  redis: {
    enabled: boolean;
    host: string;
    port: number;
    password?: string;
  };
  queue: {
    name: string;
  };
  transcription: {
    queueName: string;
    mode: 'timeline' | 'stack';
    maxConcurrency: number;
  };
  recordings: {
    maxFileSize: number;
  };
  deepgram: {
    apiKey?: string;
    accessToken?: string;
    model: string;
    language: string;
    storeRawResponse: boolean;
  };
  worker: {
    concurrency: number;
    maxConcurrentFfmpeg: number;
  };

  mail: {
    enabled: boolean;
    host: string;
    port: number;
    user?: string;
    password?: string;
    from: string;
    secure: boolean;
  };
  orchestrator: {
    notionToken?: string;
    notionDatabaseId?: string;
    elevenLabsApiKey?: string;
    manifestStore: 'filesystem' | 's3';
    manifestBucket?: string;
    manifestPrefix?: string;
    manifestRoot?: string;
    configProvider: 'local' | 'http';
    configEndpoint?: string;
    configToken?: string;
    configCacheTtlMs?: number;
    configCacheStaleIfErrorMs?: number;
    configConditionalRequests?: boolean;
    configDir?: string;
  };
  auth: {
    jwtSecret: string;
    jwtExpiresIn: string;
    refreshTokenExpiresIn: string;
    bcryptRounds: number;
    refreshCookieName: string;
    refreshCookieSecure: boolean;
    refreshCookieSameSite: 'lax' | 'strict' | 'none';
    refreshCookieDomain?: string;
    refreshCookiePath: string;
  };
  security: {
    maxFileSize: number;
    allowedMimeTypes: string[];
    uploadRateLimit: number;
    uploadBurstLimit: number;
    enableFileValidation: boolean;
    enableFileSanitization: boolean;
    enableRateLimiting: boolean;
    enableSecurityLogging: boolean;
    corsOrigin?: string;
    corsCredentials: boolean;
    enableCors: boolean;
    securityHeadersEnabled: boolean;
    hstsMaxAge: number;
    uploadQuotaPerUser: number;
    jobSubmissionRateLimit: number;
  };
  storage: {
    provider: 's3' | 'filesystem';
    bucketName?: string;
    pathPrefix?: string;
    presignedUrlExpiresIn: number;
  };
  generation: {
    defaultProvider: GenerationProvider;
    fallbackProviders: GenerationProvider[];
    quotaSourceMode: GenerationQuotaSource;
    safetyMode: GenerationSafetyMode;
    strictNoPaid: boolean;
    maxOutputTokensHard: number;
    budgetEmergencyOverride: boolean;
    models: {
      openai: {
        primary: string;
        fallback: string;
        allowed: string[];
      };
      googleAiStudio: {
        primary: string;
        fallback: string;
        tertiary: string;
        allowed: string[];
      };
      openrouter: {
        primary?: string;
        fallback?: string;
        allowed: string[];
      };
    };
    providers: {
      openai: {
        apiKey?: string;
        requestTimeoutMs: number;
        retryMax: number;
        retryBackoffMs: number;
        dailyTokenBudget?: number;
        dailyRequestBudget?: number;
        rpmBudget?: number;
      };
      googleAiStudio: {
        apiKey?: string;
        requestTimeoutMs: number;
        retryMax: number;
        retryBackoffMs: number;
        dailyRequestBudget?: number;
        rpmBudget?: number;
      };
      openrouter: {
        apiKey?: string;
        httpReferer?: string;
        xTitle?: string;
        requestTimeoutMs: number;
        retryMax: number;
        retryBackoffMs: number;
        dailyTokenBudget?: number;
        dailyRequestBudget?: number;
        rpmBudget?: number;
      };
    };
  };
  prompt: {
    templatePath: string;
    defaultProfilePath: string;
  };
  drafts: {
    localExport: boolean;
  };
  studentSystem?: {
    source: 'fs' | 'hybrid' | 'db';
    fsFallback: boolean;
  };
  experimental: {
    extendedApiEnabled: boolean;
  };
}

function normalizeSameSite(value: string): 'lax' | 'strict' | 'none' {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'lax' || normalized === 'strict' || normalized === 'none') {
    return normalized;
  }
  throw new Error('REFRESH_COOKIE_SAMESITE must be one of: lax, strict, none');
}

function normalizeStudentSystemSource(value: string): 'fs' | 'hybrid' | 'db' {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'fs' || normalized === 'hybrid' || normalized === 'db') {
    return normalized;
  }
  throw new Error('STUDENT_SYSTEM_SOURCE must be one of: fs, hybrid, db');
}

function normalizeGenerationProvider(value: string): GenerationProvider {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'google_ai_studio' || normalized === 'openrouter') {
    return normalized;
  }
  throw new Error('Generation provider must be one of: openai, google_ai_studio, openrouter');
}

function normalizeGenerationQuotaSource(value: string): GenerationQuotaSource {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'configured' || normalized === 'provider' || normalized === 'hybrid') {
    return normalized;
  }
  throw new Error('GEN_QUOTA_SOURCE_MODE must be one of: configured, provider, hybrid');
}

function normalizeGenerationSafetyMode(value: string): GenerationSafetyMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'off' || normalized === 'warn' || normalized === 'hard_stop') {
    return normalized;
  }
  throw new Error('GEN_SAFETY_MODE must be one of: off, warn, hard_stop');
}

function parseGenerationProviders(value: string): GenerationProvider[] {
  const tokens = value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return [];
  return [...new Set(tokens.map((token) => normalizeGenerationProvider(token)))];
}

function readStringList(name: string, fallback: string): string[] {
  const raw = readString(name, fallback) ?? fallback;
  return raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

// loadConfig.declaration()
export function loadConfig(): BatchBackendConfig {
  const nodeEnv = (process.env.NODE_ENV as NodeEnv) || 'development';

  const httpPort = readInt('BATCH_BACKEND_HTTP_PORT', 8080);

  // PostgreSQL (optional; enabled by default for realistic setups)
  const pgEnabled = readBool('PG_ENABLED', true);
  const pgHost = readString('PG_HOST', 'postgres')!;
  const pgPort = readInt('PG_PORT', 5432);
  const pgUser = readString('PG_USER', 'esl')!;
  const pgPassword = readString('PG_PASSWORD', 'esl')!;
  const pgDatabase = readString('PG_DATABASE', 'esl_batch')!;
  const pgConnectionString = readString('PG_CONNECTION_STRING');
  const pgPoolMax = readInt('PG_POOL_MAX', 10);
  const pgIdleTimeoutMs = readInt('PG_IDLE_TIMEOUT_MS', 30_000);
  const pgConnectionTimeoutMs = readInt('PG_CONNECTION_TIMEOUT_MS', 5_000);
  const pgAutoMigrateOnBoot = readBool(
    'PG_AUTO_MIGRATE_ON_BOOT',
    nodeEnv === 'production' ? false : true,
  );
  const pgMigrationLockKey = readString('PG_MIGRATION_LOCK_KEY', '910001')!;
  const pgMigrationsDir = readString('PG_MIGRATIONS_DIR');
  if (!/^-?\d+$/.test(pgMigrationLockKey)) {
    throw new Error('PG_MIGRATION_LOCK_KEY must be an integer value representable as bigint');
  }
  if (pgPoolMax < 1 || pgPoolMax > 100) {
    throw new Error('PG_POOL_MAX must be between 1 and 100');
  }
  if (pgIdleTimeoutMs < 1000 || pgIdleTimeoutMs > 600_000) {
    throw new Error('PG_IDLE_TIMEOUT_MS must be between 1000 and 600000');
  }
  if (pgConnectionTimeoutMs < 100 || pgConnectionTimeoutMs > 120_000) {
    throw new Error('PG_CONNECTION_TIMEOUT_MS must be between 100 and 120000');
  }
  if (pgEnabled && !pgConnectionString && (!pgUser || !pgPassword || !pgDatabase || !pgHost)) {
    throw new Error('PG_ENABLED=true but Postgres configuration is incomplete');
  }

  // Redis (optional; enabled by default as queue backend)
  const redisEnabled = readBool('REDIS_ENABLED', true);
  const redisHost = readString('REDIS_HOST', 'redis')!;
  const redisPort = readInt('REDIS_PORT', 6379);
  const redisPassword = readString('REDIS_PASSWORD');
  if (redisEnabled && !redisHost) {
    throw new Error('REDIS_ENABLED=true but REDIS_HOST is missing');
  }

  // Queue
  const queueName = readString('BATCH_JOBS_QUEUE_NAME', 'esl-jobs')!;
  const transcribeQueueName = readString('TRANSCRIBE_QUEUE_NAME', 'transcribe-queue')!;

  const recordingsMaxFileSize = readInt('RECORDINGS_MAX_FILE_SIZE', 100 * 1024 * 1024);
  const transcribeMode = readString('TRANSCRIBE_MODE', 'timeline') as 'timeline' | 'stack';
  if (transcribeMode !== 'timeline' && transcribeMode !== 'stack') {
    throw new Error('TRANSCRIBE_MODE must be "timeline" or "stack"');
  }
  const transcribeMaxConcurrency = readInt('TRANSCRIBE_MAX_CONCURRENCY', 2);

  const deepgramApiKey = readString('DEEPGRAM_API_KEY');
  const deepgramAccessToken = readString('DEEPGRAM_ACCESS_TOKEN');
  const deepgramModel = readString('DEEPGRAM_MODEL', 'nova-3')!;
  const deepgramLanguage = readString('DEEPGRAM_LANGUAGE', 'multi')!;
  const deepgramStoreRawResponse = readBool('DEEPGRAM_STORE_RAW_RESPONSE', true);

  // Worker concurrency
  const workerConcurrency = readInt('WORKER_CONCURRENCY', 5);
  const maxConcurrentFfmpeg = readInt('MAX_CONCURRENT_FFMPEG', 3);
  if (maxConcurrentFfmpeg > workerConcurrency) {
    throw new Error(
      `MAX_CONCURRENT_FFMPEG (${maxConcurrentFfmpeg}) cannot exceed WORKER_CONCURRENCY (${workerConcurrency})`,
    );
  }

  // Mail (fully optional; dev default MailHog-like, but not required)
  const mailEnabled = readBool('MAIL_ENABLED', false);
  const mailHost = readString('MAIL_HOST', 'mailhog')!;
  const mailPort = readInt('MAIL_PORT', 1025);
  const mailUser = readString('MAIL_USER');
  const mailPassword = readString('MAIL_PASSWORD');
  const mailFrom = readString('MAIL_FROM', 'no-reply@example.local')!;
  const mailSecure = readBool('MAIL_SECURE', false);
  if (mailEnabled && !mailHost) {
    throw new Error('MAIL_ENABLED=true but MAIL_HOST is missing');
  }

  // Orchestrator-related envs
  const notionToken = readString('NOTION_TOKEN');
  const notionDatabaseId = readString('NOTION_DATABASE_ID');
  const elevenLabsApiKey = readString('ELEVENLABS_API_KEY');

  const manifestStoreEnv =
    (readString('ESL_PIPELINE_MANIFEST_STORE') as 'filesystem' | 's3' | undefined) || 'filesystem';
  const manifestBucket = readString('ESL_PIPELINE_MANIFEST_BUCKET');
  const manifestPrefix = readString('ESL_PIPELINE_MANIFEST_PREFIX');
  const manifestRoot = readString('ESL_PIPELINE_MANIFEST_ROOT', process.cwd());
  if (manifestStoreEnv === 's3' && !manifestBucket) {
    throw new Error('ESL_PIPELINE_MANIFEST_STORE=s3 requires ESL_PIPELINE_MANIFEST_BUCKET');
  }

  const configProviderEnv =
    (readString('ESL_PIPELINE_CONFIG_PROVIDER') as 'local' | 'http' | undefined) || 'local';
  const configEndpoint = readString('ESL_PIPELINE_CONFIG_ENDPOINT');
  const configToken = readString('ESL_PIPELINE_CONFIG_TOKEN');
  const configCacheTtlMs = readInt('ESL_PIPELINE_CONFIG_CACHE_TTL_MS', 60_000);
  const configCacheStaleIfErrorMs = readInt('ESL_PIPELINE_CONFIG_CACHE_STALE_IF_ERROR_MS', 300_000);
  const configConditionalRequests = readBool('ESL_PIPELINE_CONFIG_CONDITIONAL_REQUESTS', true);
  if (configProviderEnv === 'http' && !configEndpoint) {
    throw new Error('ESL_PIPELINE_CONFIG_PROVIDER=http requires ESL_PIPELINE_CONFIG_ENDPOINT');
  }
  if (configCacheTtlMs < 0) {
    throw new Error('ESL_PIPELINE_CONFIG_CACHE_TTL_MS must be a non-negative integer');
  }
  if (configCacheStaleIfErrorMs < 0) {
    throw new Error('ESL_PIPELINE_CONFIG_CACHE_STALE_IF_ERROR_MS must be a non-negative integer');
  }

  const configDir = readString('ESL_PIPELINE_CONFIG_DIR');

  const voiceAlignmentPromptV2 = readBool('VOICE_ALIGNMENT_V2_PROMPT', false);
  const promptTemplatePath = readString(
    'PROMPT_TEMPLATE_PATH',
    voiceAlignmentPromptV2
      ? 'docs/templates/hw_prompt_v4-3_voice-aligned.md'
      : 'docs/templates/hw_prompt_v4-2_clean.md',
  )!;
  const promptProfilePath = readString(
    'PROMPT_PROFILE_PATH',
    'docs/templates/PROFILE_2025-11-16.md',
  )!;
  const draftLocalExport = readBool('DRAFT_LOCAL_EXPORT', nodeEnv === 'development');

  const studentSystemSource = normalizeStudentSystemSource(
    readString('STUDENT_SYSTEM_SOURCE', nodeEnv === 'test' ? 'fs' : 'hybrid')!,
  );
  const studentSystemFsFallback = readBool('STUDENT_SYSTEM_FS_FALLBACK', true);

  // Authentication configuration
  const jwtSecret = readString('JWT_SECRET', 'your-super-secret-jwt-key-change-in-production')!;
  const jwtExpiresIn = readString('JWT_EXPIRES_IN', '15m')!;
  const refreshTokenExpiresIn = readString('REFRESH_TOKEN_EXPIRES_IN', '7d')!;
  const bcryptRounds = readInt('BCRYPT_ROUNDS', 12);
  const refreshCookieName = readString('REFRESH_COOKIE_NAME', 'esl_refresh')!;
  const refreshCookieSameSiteRaw = readString('REFRESH_COOKIE_SAMESITE', 'lax')!;
  const refreshCookieSecureDefault = nodeEnv === 'production';
  const refreshCookieSecure = readBool('REFRESH_COOKIE_SECURE', refreshCookieSecureDefault);
  const refreshCookieDomain = readString('REFRESH_COOKIE_DOMAIN');
  const refreshCookiePath = readString('REFRESH_COOKIE_PATH', '/')!;

  const refreshCookieSameSite = normalizeSameSite(refreshCookieSameSiteRaw);

  // Security configuration
  const maxFileSize = readInt('MAX_FILE_SIZE', 10 * 1024 * 1024); // 10MB default
  const allowedMimeTypesEnv =
    readString('ALLOWED_MIME_TYPES', 'text/markdown,text/plain') || 'text/markdown,text/plain';
  const allowedMimeTypes = allowedMimeTypesEnv.split(',').map((type) => type.trim());
  const uploadRateLimit = readInt('UPLOAD_RATE_LIMIT', 10); // 10 uploads per minute
  const uploadBurstLimit = readInt('UPLOAD_BURST_LIMIT', 20); // 20 uploads burst
  const enableFileValidation = readBool('ENABLE_FILE_VALIDATION', true);
  const enableFileSanitization = readBool('ENABLE_FILE_SANITIZATION', true);
  const enableRateLimiting = readBool('ENABLE_RATE_LIMITING', true);
  const enableSecurityLogging = readBool('ENABLE_SECURITY_LOGGING', true);
  const corsOrigin = readString('CORS_ORIGIN');
  const corsCredentials = readBool('CORS_CREDENTIALS', false);
  const enableCors = readBool('ENABLE_CORS', false);
  const securityHeadersEnabled = readBool('SECURITY_HEADERS_ENABLED', true);
  const hstsMaxAge = readInt('HSTS_MAX_AGE', 31_536_000); // 1 year in seconds
  const uploadQuotaPerUser = readInt('UPLOAD_QUOTA_PER_USER', 100 * 1024 * 1024); // 100MB default
  const jobSubmissionRateLimit = readInt('JOB_SUBMISSION_RATE_LIMIT', 0); // disabled by default; set >0 to enable rate limiting

  // Storage configuration
  const requestedStorageProvider = readString('STORAGE_PROVIDER');
  const storageBucketName =
    readString('S3_BUCKET_NAME') || readString('S3_BUCKET') || readString('STORAGE_BUCKET_NAME');
  const s3AccessKeyId = readString('S3_ACCESS_KEY_ID') || readString('AWS_ACCESS_KEY_ID');
  const s3SecretAccessKey =
    readString('S3_SECRET_ACCESS_KEY') || readString('AWS_SECRET_ACCESS_KEY');
  const hasS3Credentials = Boolean(storageBucketName && s3AccessKeyId && s3SecretAccessKey);

  let resolvedStorageProvider: 's3' | 'filesystem';
  if (requestedStorageProvider) {
    if (requestedStorageProvider !== 's3' && requestedStorageProvider !== 'filesystem') {
      throw new Error('STORAGE_PROVIDER must be either "s3" or "filesystem"');
    }
    resolvedStorageProvider = requestedStorageProvider;
  } else {
    resolvedStorageProvider = hasS3Credentials ? 's3' : 'filesystem';
  }

  if (resolvedStorageProvider === 's3' && !hasS3Credentials) {
    throw new Error(
      'STORAGE_PROVIDER=s3 requires S3_BUCKET_NAME/STORAGE_BUCKET_NAME and S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY (or AWS_ equivalents)',
    );
  }
  const storagePathPrefix = readString('S3_PATH_PREFIX') || readString('STORAGE_PATH_PREFIX');
  const presignedUrlExpiresIn = readInt('PRESIGNED_URL_EXPIRES_IN', 3600);

  const generationDefaultProvider = normalizeGenerationProvider(
    readString('GEN_PROVIDER_DEFAULT', 'openai')!,
  );
  const generationFallbackProviders = parseGenerationProviders(
    readString('GEN_PROVIDER_FALLBACKS', 'google_ai_studio,openrouter')!,
  ).filter((provider) => provider !== generationDefaultProvider);
  const generationQuotaSourceMode = normalizeGenerationQuotaSource(
    readString('GEN_QUOTA_SOURCE_MODE', 'hybrid')!,
  );
  const generationSafetyMode = normalizeGenerationSafetyMode(
    readString('GEN_SAFETY_MODE', 'hard_stop')!,
  );
  const generationStrictNoPaid = readBool('GEN_STRICT_NO_PAID', true);
  const generationMaxOutputTokensHard = readInt('GEN_MAX_OUTPUT_TOKENS_HARD', 1200);
  const generationAllowPaidSpend = readBool('GEN_ALLOW_PAID_SPEND', false);
  const generationBudgetEmergencyOverride =
    generationAllowPaidSpend || readBool('GEN_BUDGET_EMERGENCY_OVERRIDE', false);

  const generationOpenAiModelPrimary = readString('GEN_OPENAI_MODEL_PRIMARY', 'gpt-5.2')!;
  const generationOpenAiModelFallback = readString('GEN_OPENAI_MODEL_FALLBACK', 'gpt-5-mini')!;
  const generationOpenAiAllowedModels = readStringList(
    'GEN_ALLOWED_MODELS_OPENAI',
    `${generationOpenAiModelPrimary},${generationOpenAiModelFallback}`,
  );
  const generationGoogleModelPrimary = readString(
    'GEN_GOOGLE_MODEL_PRIMARY',
    'gemini-3-flash-preview',
  )!;
  const generationGoogleModelFallback = readString(
    'GEN_GOOGLE_MODEL_FALLBACK',
    'gemini-2.5-flash-lite',
  )!;
  const generationGoogleModelTertiary = readString(
    'GEN_GOOGLE_MODEL_TERTIARY',
    'gemini-2.5-pro',
  )!;
  const generationGoogleAllowedModels = readStringList(
    'GEN_ALLOWED_MODELS_GOOGLE',
    `${generationGoogleModelPrimary},${generationGoogleModelFallback},${generationGoogleModelTertiary}`,
  );
  const generationOpenRouterModelPrimary = readString('GEN_OPENROUTER_MODEL_PRIMARY');
  const generationOpenRouterModelFallback = readString('GEN_OPENROUTER_MODEL_FALLBACK');
  const generationOpenRouterAllowedModels = readStringList('GEN_ALLOWED_MODELS_OPENROUTER', '');

  const generationOpenAiTimeoutMs = readInt('GEN_OPENAI_REQUEST_TIMEOUT_MS', 30_000);
  const generationOpenAiRetryMax = readInt('GEN_OPENAI_RETRY_MAX', 1);
  const generationOpenAiRetryBackoffMs = readInt('GEN_OPENAI_RETRY_BACKOFF_MS', 250);
  const generationOpenAiRpmBudget = readInt('GEN_OPENAI_RPM_BUDGET', 3);
  const generationOpenAiDailyRequestBudget = readInt('GEN_OPENAI_DAILY_REQUEST_BUDGET', 40);
  const generationGoogleTimeoutMs = readInt('GEN_GOOGLE_REQUEST_TIMEOUT_MS', 30_000);
  const generationGoogleRetryMax = readInt('GEN_GOOGLE_RETRY_MAX', 1);
  const generationGoogleRetryBackoffMs = readInt('GEN_GOOGLE_RETRY_BACKOFF_MS', 250);
  const generationGoogleRpmBudget = readInt('GEN_GOOGLE_RPM_BUDGET', 4);
  const generationOpenRouterTimeoutMs = readInt('GEN_OPENROUTER_REQUEST_TIMEOUT_MS', 30_000);
  const generationOpenRouterRetryMax = readInt('GEN_OPENROUTER_RETRY_MAX', 1);
  const generationOpenRouterRetryBackoffMs = readInt('GEN_OPENROUTER_RETRY_BACKOFF_MS', 250);
  const generationOpenRouterRpmBudget = readInt('GEN_OPENROUTER_RPM_BUDGET', 0);
  const generationOpenRouterDailyRequestBudget = readInt(
    'GEN_OPENROUTER_DAILY_REQUEST_BUDGET',
    0,
  );

  const openAiApiKey = readString('OPENAI_API_KEY');
  const geminiApiKey = readString('GEMINI_API_KEY');
  const openRouterApiKey = readString('OPENROUTER_API_KEY');
  const openRouterHttpReferer = readString('OPENROUTER_HTTP_REFERER');
  const openRouterXTitle = readString('OPENROUTER_X_TITLE');

  const generationOpenAiDailyTokenBudget = readInt('GEN_OPENAI_DAILY_TOKEN_BUDGET', 120_000);
  const generationGoogleDailyRequestBudget = readInt('GEN_GOOGLE_DAILY_REQUEST_BUDGET', 12);
  const generationOpenRouterDailyTokenBudget = readInt('GEN_OPENROUTER_DAILY_TOKEN_BUDGET', 0);

  const extendedApiEnabled = readBool('BATCH_BACKEND_ENABLE_EXTENDED_API', true);

  return {
    nodeEnv,
    httpPort,
    pg: {
      enabled: pgEnabled,
      host: pgHost,
      port: pgPort,
      user: pgUser,
      password: pgPassword,
      database: pgDatabase,
      connectionString: pgConnectionString,
      poolMax: pgPoolMax,
      idleTimeoutMs: pgIdleTimeoutMs,
      connectionTimeoutMs: pgConnectionTimeoutMs,
      autoMigrateOnBoot: pgAutoMigrateOnBoot,
      migrationLockKey: pgMigrationLockKey,
      migrationsDir: pgMigrationsDir ?? undefined,
    },
    redis: {
      enabled: redisEnabled,
      host: redisHost,
      port: redisPort,
      password: redisPassword,
    },
    queue: {
      name: queueName,
    },
    transcription: {
      queueName: transcribeQueueName,
      mode: transcribeMode,
      maxConcurrency: transcribeMaxConcurrency,
    },
    recordings: {
      maxFileSize: recordingsMaxFileSize,
    },
    deepgram: {
      apiKey: deepgramApiKey,
      accessToken: deepgramAccessToken,
      model: deepgramModel,
      language: deepgramLanguage,
      storeRawResponse: deepgramStoreRawResponse,
    },
    worker: {
      concurrency: workerConcurrency,
      maxConcurrentFfmpeg,
    },

    mail: {
      enabled: mailEnabled,
      host: mailHost,
      port: mailPort,
      user: mailUser,
      password: mailPassword,
      from: mailFrom,
      secure: mailSecure,
    },
    orchestrator: {
      notionToken,
      notionDatabaseId,
      elevenLabsApiKey,
      manifestStore: manifestStoreEnv,
      manifestBucket,
      manifestPrefix,
      manifestRoot,
      configProvider: configProviderEnv,
      configEndpoint,
      configToken,
      configCacheTtlMs,
      configCacheStaleIfErrorMs,
      configConditionalRequests,
      configDir,
    },
    auth: {
      jwtSecret,
      jwtExpiresIn,
      refreshTokenExpiresIn,
      bcryptRounds,
      refreshCookieName,
      refreshCookieSecure,
      refreshCookieSameSite,
      refreshCookieDomain,
      refreshCookiePath,
    },
    security: {
      maxFileSize,
      allowedMimeTypes,
      uploadRateLimit,
      uploadBurstLimit,
      enableFileValidation,
      enableFileSanitization,
      enableRateLimiting,
      enableSecurityLogging,
      corsOrigin,
      corsCredentials,
      enableCors,
      securityHeadersEnabled,
      hstsMaxAge,
      uploadQuotaPerUser,
      jobSubmissionRateLimit,
    },
    storage: {
      provider: resolvedStorageProvider,
      bucketName: storageBucketName,
      pathPrefix: storagePathPrefix,
      presignedUrlExpiresIn,
    },
    generation: {
      defaultProvider: generationDefaultProvider,
      fallbackProviders: generationFallbackProviders,
      quotaSourceMode: generationQuotaSourceMode,
      safetyMode: generationSafetyMode,
      strictNoPaid: generationStrictNoPaid,
      maxOutputTokensHard: generationMaxOutputTokensHard,
      budgetEmergencyOverride: generationBudgetEmergencyOverride,
      models: {
        openai: {
          primary: generationOpenAiModelPrimary,
          fallback: generationOpenAiModelFallback,
          allowed: generationOpenAiAllowedModels,
        },
        googleAiStudio: {
          primary: generationGoogleModelPrimary,
          fallback: generationGoogleModelFallback,
          tertiary: generationGoogleModelTertiary,
          allowed: generationGoogleAllowedModels,
        },
        openrouter: {
          ...(generationOpenRouterModelPrimary
            ? { primary: generationOpenRouterModelPrimary }
            : {}),
          ...(generationOpenRouterModelFallback
            ? { fallback: generationOpenRouterModelFallback }
            : {}),
          allowed: generationOpenRouterAllowedModels,
        },
      },
      providers: {
        openai: {
          apiKey: openAiApiKey,
          requestTimeoutMs: generationOpenAiTimeoutMs,
          retryMax: generationOpenAiRetryMax,
          retryBackoffMs: generationOpenAiRetryBackoffMs,
          dailyTokenBudget: generationOpenAiDailyTokenBudget,
          dailyRequestBudget: generationOpenAiDailyRequestBudget,
          rpmBudget: generationOpenAiRpmBudget,
        },
        googleAiStudio: {
          apiKey: geminiApiKey,
          requestTimeoutMs: generationGoogleTimeoutMs,
          retryMax: generationGoogleRetryMax,
          retryBackoffMs: generationGoogleRetryBackoffMs,
          dailyRequestBudget: generationGoogleDailyRequestBudget,
          rpmBudget: generationGoogleRpmBudget,
        },
        openrouter: {
          apiKey: openRouterApiKey,
          httpReferer: openRouterHttpReferer,
          xTitle: openRouterXTitle,
          requestTimeoutMs: generationOpenRouterTimeoutMs,
          retryMax: generationOpenRouterRetryMax,
          retryBackoffMs: generationOpenRouterRetryBackoffMs,
          dailyTokenBudget: generationOpenRouterDailyTokenBudget,
          dailyRequestBudget: generationOpenRouterDailyRequestBudget,
          rpmBudget: generationOpenRouterRpmBudget,
        },
      },
    },
    prompt: {
      templatePath: promptTemplatePath,
      defaultProfilePath: promptProfilePath,
    },
    drafts: {
      localExport: draftLocalExport,
    },
    studentSystem: {
      source: studentSystemSource,
      fsFallback: studentSystemFsFallback,
    },
    experimental: {
      extendedApiEnabled,
    },
  };
}
