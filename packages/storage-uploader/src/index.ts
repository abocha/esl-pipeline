import { basename } from 'node:path';

type UploadBackend = 's3';

export type UploadOptions = {
  backend: UploadBackend;
  public?: boolean;
  key?: string;
  contentType?: string;
};

export async function uploadFile(
  localPath: string,
  opts: UploadOptions
): Promise<{ url: string; key: string; etag?: string; isPresigned?: boolean; expiresAt?: string }> {
  if (opts.backend !== 's3') {
    throw new Error(`Unsupported backend: ${opts.backend}`);
  }

  const bucket = process.env.S3_BUCKET ?? 'stub-bucket';
  const prefix = process.env.S3_PREFIX ?? 'audio/assignments';
  const key = opts.key ?? `${prefix.replace(/\/$/, '')}/${basename(localPath)}`;

  const url = `https://${bucket}.s3.amazonaws.com/${key}`;

  return {
    url,
    key,
    etag: undefined,
    isPresigned: !opts.public,
    expiresAt: undefined
  };
}
