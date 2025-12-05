// packages/batch-backend/src/config/env.ts
// Centralized environment-based configuration for the batch-backend.
// - Safe Docker/Docker Compose defaults.
// - Postgres/Redis are optional and enabled via env flags.
// - Only throws when a feature is explicitly enabled but misconfigured.
import { readBool, readInt, readString } from '@esl-pipeline/shared-infrastructure';

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
    configDir?: string;
  };
  auth: {
    jwtSecret: string;
    jwtExpiresIn: string;
    refreshTokenExpiresIn: string;
    bcryptRounds: number;
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
  experimental: {
    extendedApiEnabled: boolean;
  };
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
  if (configProviderEnv === 'http' && !configEndpoint) {
    throw new Error('ESL_PIPELINE_CONFIG_PROVIDER=http requires ESL_PIPELINE_CONFIG_ENDPOINT');
  }

  const configDir = readString('ESL_PIPELINE_CONFIG_DIR');

  // Authentication configuration
  const jwtSecret = readString('JWT_SECRET', 'your-super-secret-jwt-key-change-in-production')!;
  const jwtExpiresIn = readString('JWT_EXPIRES_IN', '15m')!;
  const refreshTokenExpiresIn = readString('REFRESH_TOKEN_EXPIRES_IN', '7d')!;
  const bcryptRounds = readInt('BCRYPT_ROUNDS', 12);

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
      configDir,
    },
    auth: {
      jwtSecret,
      jwtExpiresIn,
      refreshTokenExpiresIn,
      bcryptRounds,
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
    experimental: {
      extendedApiEnabled,
    },
  };
}
