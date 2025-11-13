// packages/batch-backend/src/infrastructure/minio.ts

// Optional MinIO/S3-compatible client wrapper.
// Enabled via MINIO_ENABLED + ESL_PIPELINE_MANIFEST_STORE where needed.
// Intentionally small so it can be swapped or ignored.

import { Client as MinioClient } from 'minio';
import type { Readable } from 'node:stream';
import { loadConfig } from '../config/env';
import { logger } from './logger';

export interface MinioWrapper {
  client: MinioClient;
  ensureBucket(): Promise<void>;
  uploadObject(
    key: string,
    data: Buffer | Readable,
    size?: number,
    contentType?: string
  ): Promise<void>;
}

// createMinioClient.declaration()
export function createMinioClient(): MinioWrapper {
  const config = loadConfig();

  if (!config.minio.enabled) {
    throw new Error('MinIO requested but MINIO_ENABLED=false');
  }

  const client = new MinioClient({
    endPoint: config.minio.endpoint,
    port: config.minio.port,
    useSSL: config.minio.useSSL,
    accessKey: config.minio.accessKey,
    secretKey: config.minio.secretKey,
  });

  async function ensureBucket(): Promise<void> {
    // For production, assume bucket is provisioned out-of-band.
    if (config.nodeEnv === 'production') return;

    try {
      const exists = await client.bucketExists(config.minio.bucket);
      if (!exists) {
        logger.info('Creating MinIO bucket', {
          component: 'minio',
          bucket: config.minio.bucket,
        });
        await client.makeBucket(config.minio.bucket, '');
      }
    } catch (err) {
      logger.error(err as Error, {
        component: 'minio',
        message: 'Failed to ensure MinIO bucket',
      });
      throw err;
    }
  }

  async function uploadObject(
    key: string,
    data: Buffer | Readable,
    size?: number,
    contentType?: string
  ): Promise<void> {
    try {
      await client.putObject(config.minio.bucket, key, data as any, size, {
        'Content-Type': contentType ?? 'application/octet-stream',
      });
      logger.info('Uploaded object to MinIO', {
        component: 'minio',
        bucket: config.minio.bucket,
        key,
      });
    } catch (err) {
      logger.error(err as Error, {
        component: 'minio',
        message: 'Failed to upload object',
        key,
      });
      throw err;
    }
  }

  return { client, ensureBucket, uploadObject };
}
