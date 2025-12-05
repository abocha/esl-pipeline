// packages/batch-backend/src/transport/http-server.ts
//
// Fastify HTTP server exposing a minimal API:
// - POST /jobs      -> submit a new ESL pipeline job
// - GET /jobs/:id   -> fetch job status
// Designed to be run as a containerized service.
import Fastify, { type FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config/env.js';
import {
  type FileSanitizationService,
  createFileSanitizationService,
} from '../infrastructure/file-sanitization-service.js';
import { createFileStorageService } from '../infrastructure/file-storage-service.js';
import {
  type FileValidationService,
  createFileValidationService,
} from '../infrastructure/file-validation-service.js';
import { enableRedisJobEventBridge } from '../infrastructure/job-event-redis-bridge.js';
import { logger } from '../infrastructure/logger.js';
import { createRedisClient } from '../infrastructure/redis.js';
import {
  type StorageConfig,
  StorageConfigurationService,
  createStorageConfigService,
} from '../infrastructure/storage-config.js';
import { authenticate } from './auth-middleware.js';
import { registerCoreRoutes } from './core-routes.js';
import { registerErrorHandler } from './error-handler.js';
import { registerExtendedRoutes } from './extended-routes.js';
import {
  RateLimiterService,
  createRateLimiterService,
  createUploadRateLimitMiddleware,
} from './rate-limit-middleware.js';
import { registerSecurityHeaders } from './security-headers.js';

function createJobSubmissionRateLimiter(config: ReturnType<typeof loadConfig>) {
  if (!config.security.enableRateLimiting || config.security.jobSubmissionRateLimit <= 0) {
    return null;
  }

  return new RateLimiterService(createRedisClient(), {
    windowSize: 60 * 1000,
    maxRequests: config.security.jobSubmissionRateLimit,
    burstLimit: config.security.jobSubmissionRateLimit * 2,
    burstWindow: 10 * 1000,
    keyPrefix: 'rate_limit:job_submit',
  });
}

function buildStorageConfigurationService(config: ReturnType<typeof loadConfig>) {
  const baseStorageConfig = createStorageConfigService().getFullConfig();
  const s3Overrides: Partial<StorageConfig['s3']> = {};

  if (config.storage.bucketName) {
    Object.assign(s3Overrides, { bucket: config.storage.bucketName });
  }
  if (config.storage.pathPrefix) {
    Object.assign(s3Overrides, { pathPrefix: config.storage.pathPrefix });
  }

  return createStorageConfigService({
    provider: config.storage.provider,
    s3: {
      ...baseStorageConfig.s3,
      ...s3Overrides,
    },
    filesystem: {
      uploadDir: process.env.FILESYSTEM_UPLOAD_DIR || baseStorageConfig.filesystem.uploadDir,
    },
    lifecycle: {
      ...baseStorageConfig.lifecycle,
      presignedUrlExpiresIn: config.storage.presignedUrlExpiresIn,
    },
  });
}

export async function createHttpServer(): Promise<FastifyInstance> {
  const config = loadConfig();
  const app = Fastify({
    logger: false,
  });

  registerErrorHandler(app);
  registerSecurityHeaders(app);

  const extendedApiEnabled = config.experimental.extendedApiEnabled;
  const jobRateLimiter = createJobSubmissionRateLimiter(config);
  const jobRateLimitMiddleware = jobRateLimiter
    ? createUploadRateLimitMiddleware(jobRateLimiter)
    : null;

  registerCoreRoutes(app, {
    config,
    jobRateLimitMiddleware,
    authenticate,
  });

  if (extendedApiEnabled) {
    const fileValidationService: FileValidationService | null = config.security.enableFileValidation
      ? createFileValidationService()
      : null;
    const fileSanitizationService: FileSanitizationService | null = config.security
      .enableFileSanitization
      ? createFileSanitizationService()
      : null;

    const rateLimiterService = await createRateLimiterService();
    const uploadRateLimitMiddleware = createUploadRateLimitMiddleware(rateLimiterService);

    const storageConfig: StorageConfigurationService = buildStorageConfigurationService(config);
    const fileStorageService = createFileStorageService(storageConfig);

    registerExtendedRoutes(app, {
      config,
      authenticate,
      uploadRateLimitMiddleware,
      fileValidationService,
      fileSanitizationService,
      storageConfig,
      fileStorageService,
    });
  } else {
    logger.info('Extended API disabled; skipping uploads/auth/admin routes');
  }

  return app;
}

// startHttpServer.declaration()
// Public entrypoint used in production; behavior MUST remain unchanged.
export async function startHttpServer(): Promise<void> {
  const config = loadConfig();
  await enableRedisJobEventBridge();
  const app = await createHttpServer();

  try {
    await app.listen({
      port: config.httpPort,
      host: '0.0.0.0',
    });
    logger.info('HTTP server listening', {
      event: 'http_server_started',
      port: config.httpPort,
    });
  } catch (error: unknown) {
    logger.error(error instanceof Error ? error : String(error), {
      event: 'http_server_start_failed',
    });
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void startHttpServer();
}
