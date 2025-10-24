import { uploadToS3 } from './s3.js';
import { basename } from 'node:path';

type UploadBackend = 's3';

export type UploadOptions = {
  backend: UploadBackend;
  public?: boolean;
  key?: string;
  presignExpiresIn?: number;
  prefix?: string;
};

export async function uploadFile(
  localPath: string,
  opts: UploadOptions
): Promise<{ url: string; key: string; etag?: string; isPresigned?: boolean; expiresAt?: string }> {
  if (opts.backend !== 's3') {
    throw new Error(`Unsupported backend: ${opts.backend}`);
  }

  const bucket = process.env.S3_BUCKET ?? 'stub-bucket';
  const prefix = opts.prefix ?? process.env.S3_PREFIX ?? 'audio/assignments';
  const key = opts.key ?? `${prefix.replace(/\/$/, '')}/${basename(localPath)}`;

  return uploadToS3(localPath, bucket, key, {
    public: opts.public,
    presignExpiresIn: opts.presignExpiresIn,
    region: process.env.AWS_REGION,
  });
}