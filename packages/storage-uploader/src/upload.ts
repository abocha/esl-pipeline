// packages/storage-uploader/src/upload.ts
import { uploadToS3 } from './s3.js';
import { ConfigurationError } from '@esl-pipeline/contracts';

export type UploadOpts = {
  backend: 's3';
  bucket?: string; // optional; defaults to env S3_BUCKET
  prefix?: string; // e.g. "audio/assignments"
  public?: boolean; // request public-read (will auto-fallback if ACLs disabled)
  presign?: number; // seconds (only if your s3 helper supports presign)
  region?: string; // optional; defaults to env AWS_REGION
  presignExpiresIn?: number;
};

export async function uploadFile(
  localPath: string,
  opts: UploadOpts
): Promise<{
  url: string;
  key: string;
  etag?: string;
  isPresigned?: boolean;
  presignExpiresIn?: number;
}> {
  if (opts.backend !== 's3') {
    throw new ConfigurationError(`Unsupported backend: ${opts.backend}`);
  }

  const bucket = opts.bucket ?? process.env.S3_BUCKET;
  if (!bucket) throw new ConfigurationError('S3 bucket not configured (set S3_BUCKET or pass opts.bucket)');

  // Pass only a key prefix; s3.ts builds "<prefix>/<filename>" itself
  const keyPrefix = (opts.prefix ?? process.env.S3_PREFIX ?? '')
    .replace(/^\//, '')
    .replace(/\/+$/, '');

  return uploadToS3(localPath, {
    bucket,
    region: opts.region ?? process.env.AWS_REGION ?? 'ap-southeast-1',
    keyPrefix,
    publicRead: !!opts.public,
    // If your s3.ts supports presign, uncomment/forward it:
    // presignSeconds: opts.presign ?? 0,
  });
}
