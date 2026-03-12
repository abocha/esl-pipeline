// packages/storage-uploader/src/upload.ts
import type { PipelineLogger } from '@esl-pipeline/contracts';
import { ConfigurationError } from '@esl-pipeline/contracts';

import { normalizeS3ObjectKey, sanitizeS3KeyPrefix } from './address.js';
import { uploadToS3 } from './s3.js';

export interface UploadOpts {
  backend: 's3';
  bucket?: string; // optional; defaults to env S3_BUCKET
  prefix?: string; // e.g. "audio/assignments"
  key?: string; // explicit object key (overrides filename strategy)
  sha256?: string; // content hash used for idempotent upload checks
  skipIfExists?: boolean; // defaults to true unless disabled globally
  public?: boolean; // request public-read (will auto-fallback if ACLs disabled)
  presign?: number; // seconds (only if your s3 helper supports presign)
  region?: string; // optional; defaults to env AWS_REGION
  presignExpiresIn?: number;
  logger?: PipelineLogger;
}

export async function uploadFile(
  localPath: string,
  opts: UploadOpts,
): Promise<{
  url: string;
  key: string;
  etag?: string;
  reused?: boolean;
  sizeBytes?: number;
  sha256?: string;
  isPresigned?: boolean;
  presignExpiresIn?: number;
}> {
  if (opts.backend !== 's3') {
    throw new ConfigurationError(`Unsupported backend: ${opts.backend}`);
  }

  const bucket = opts.bucket ?? process.env.S3_BUCKET;
  if (!bucket)
    throw new ConfigurationError('S3 bucket not configured (set S3_BUCKET or pass opts.bucket)');

  // Pass only a key prefix; s3.ts builds "<prefix>/<filename>" itself
  const keyPrefix = sanitizeS3KeyPrefix(opts.prefix ?? process.env.S3_PREFIX ?? '');
  const trimmedKey = opts.key?.trim();
  const explicitKey = trimmedKey
    ? normalizeS3ObjectKey(
        keyPrefix && !trimmedKey.startsWith(`${keyPrefix}/`)
          ? `${keyPrefix}/${trimmedKey}`
          : trimmedKey,
      )
    : undefined;

  return uploadToS3(localPath, {
    bucket,
    region: opts.region ?? process.env.AWS_REGION ?? 'ap-southeast-1',
    keyPrefix,
    key: explicitKey,
    sha256: opts.sha256,
    skipIfExists: opts.skipIfExists,
    publicRead: !!opts.public,
    logger: opts.logger,
    // If your s3.ts supports presign, uncomment/forward it:
    // presignSeconds: opts.presign ?? 0,
  });
}
