// packages/batch-backend/src/config/env.ts

// Centralized environment-based configuration for the batch-backend.
// - Safe Docker/Docker Compose defaults.
// - Postgres/Redis/MinIO are optional and enabled via env flags.
// - Only throws when a feature is explicitly enabled but misconfigured.

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
  minio: {
    enabled: boolean;
    endpoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
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
    elevenLabsApiKey?: string;
    manifestStore: 'filesystem' | 's3';
    manifestBucket?: string;
    manifestPrefix?: string;
    manifestRoot?: string;
    configProvider: 'local' | 'http';
    configEndpoint?: string;
    configToken?: string;
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
    provider: 's3' | 'minio' | 'filesystem';
    bucketName?: string;
    pathPrefix?: string;
    presignedUrlExpiresIn: number;
  };
  experimental: {
    extendedApiEnabled: boolean;
  };
}

function readBool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v == null || v === '') return def;
  return v === '1' || v.toLowerCase() === 'true';
}

function readInt(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function readString(name: string, def?: string): string | undefined {
  const v = process.env[name];
  if (v == null || v === '') return def;
  return v;
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
  if (pgEnabled) {
    if (!pgConnectionString && (!pgUser || !pgPassword || !pgDatabase || !pgHost)) {
      throw new Error('PG_ENABLED=true but Postgres configuration is incomplete');
    }
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

  // MinIO / S3-compatible (optional; defaults on for dev/docker, off in prod unless explicitly set)
  const minioEnabled = readBool('MINIO_ENABLED', nodeEnv === 'development' || nodeEnv === 'test');
  const minioEndpoint = readString('MINIO_ENDPOINT', 'minio')!;
  const minioPort = readInt('MINIO_PORT', 9000);
  const minioUseSSL = readBool('MINIO_USE_SSL', false);
  const minioAccessKey = readString('MINIO_ACCESS_KEY', 'minioadmin')!;
  const minioSecretKey = readString('MINIO_SECRET_KEY', 'minioadmin')!;
  const minioBucket = readString('MINIO_BUCKET', 'esl-pipeline')!;
  if (minioEnabled) {
    if (!minioEndpoint || !minioAccessKey || !minioSecretKey || !minioBucket) {
      throw new Error('MINIO_ENABLED=true but MinIO configuration is incomplete');
    }
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
  const elevenLabsApiKey = readString('ELEVENLABS_API_KEY');

  const manifestStoreEnv =
    (readString('ESL_PIPELINE_MANIFEST_STORE') as 'filesystem' | 's3' | undefined) ||
    (minioEnabled ? 's3' : 'filesystem');
  const manifestBucket =
    readString('ESL_PIPELINE_MANIFEST_BUCKET') ||
    (manifestStoreEnv === 's3' ? minioBucket : undefined);
  const manifestPrefix = readString('ESL_PIPELINE_MANIFEST_PREFIX');
  const manifestRoot = readString('ESL_PIPELINE_MANIFEST_ROOT', process.cwd());
  if (manifestStoreEnv === 's3' && !manifestBucket) {
    throw new Error(
      'ESL_PIPELINE_MANIFEST_STORE=s3 requires ESL_PIPELINE_MANIFEST_BUCKET (or MINIO_BUCKET)'
    );
  }

  const configProviderEnv =
    (readString('ESL_PIPELINE_CONFIG_PROVIDER') as 'local' | 'http' | undefined) || 'local';
  const configEndpoint = readString('ESL_PIPELINE_CONFIG_ENDPOINT');
  const configToken = readString('ESL_PIPELINE_CONFIG_TOKEN');
  if (configProviderEnv === 'http' && !configEndpoint) {
    throw new Error('ESL_PIPELINE_CONFIG_PROVIDER=http requires ESL_PIPELINE_CONFIG_ENDPOINT');
  }

  // Authentication configuration
  const jwtSecret = readString('JWT_SECRET', 'your-super-secret-jwt-key-change-in-production')!;
  const jwtExpiresIn = readString('JWT_EXPIRES_IN', '15m')!;
  const refreshTokenExpiresIn = readString('REFRESH_TOKEN_EXPIRES_IN', '7d')!;
  const bcryptRounds = readInt('BCRYPT_ROUNDS', 12);

  // Security configuration
  const maxFileSize = readInt('MAX_FILE_SIZE', 10 * 1024 * 1024); // 10MB default
  const allowedMimeTypesEnv =
    readString('ALLOWED_MIME_TYPES', 'text/markdown,text/plain') || 'text/markdown,text/plain';
  const allowedMimeTypes = allowedMimeTypesEnv.split(',').map(type => type.trim());
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
  const hstsMaxAge = readInt('HSTS_MAX_AGE', 31536000); // 1 year in seconds
  const uploadQuotaPerUser = readInt('UPLOAD_QUOTA_PER_USER', 100 * 1024 * 1024); // 100MB default
  const jobSubmissionRateLimit = readInt('JOB_SUBMISSION_RATE_LIMIT', 5); // 5 jobs per minute

  // Storage configuration
  const storageProvider =
    (readString('STORAGE_PROVIDER') as 's3' | 'minio' | 'filesystem') || 'filesystem';
  const storageBucketName = readString('S3_BUCKET_NAME') || readString('STORAGE_BUCKET_NAME');
  const storagePathPrefix = readString('S3_PATH_PREFIX') || readString('STORAGE_PATH_PREFIX');
  const presignedUrlExpiresIn = readInt('PRESIGNED_URL_EXPIRES_IN', 3600);

  const extendedApiEnabled = readBool('BATCH_BACKEND_ENABLE_EXTENDED_API', false);

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
    minio: {
      enabled: minioEnabled,
      endpoint: minioEndpoint,
      port: minioPort,
      useSSL: minioUseSSL,
      accessKey: minioAccessKey,
      secretKey: minioSecretKey,
      bucket: minioBucket,
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
      elevenLabsApiKey,
      manifestStore: manifestStoreEnv,
      manifestBucket,
      manifestPrefix,
      manifestRoot,
      configProvider: configProviderEnv,
      configEndpoint,
      configToken,
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
      provider: storageProvider,
      bucketName: storageBucketName,
      pathPrefix: storagePathPrefix,
      presignedUrlExpiresIn,
    },
    experimental: {
      extendedApiEnabled,
    },
  };
}
