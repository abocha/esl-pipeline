import { basename } from 'node:path';

export type S3UrlStyle = 'regional' | 'global';

export interface S3UploadAddressOptions {
  bucket: string;
  region?: string;
  keyPrefix?: string;
  filePath: string;
  urlStyle?: S3UrlStyle;
}

export function sanitizeS3KeyPrefix(prefix?: string): string {
  if (!prefix) return '';
  return prefix.replace(/^[\/\\]+/, '').replace(/[\/\\]+$/, '');
}

export function deriveS3UploadAddress(options: S3UploadAddressOptions): {
  key: string;
  url: string;
} {
  const normalizedPrefix = sanitizeS3KeyPrefix(options.keyPrefix);
  const fileName = basename(options.filePath);
  const key = normalizedPrefix ? `${normalizedPrefix}/${fileName}` : fileName;
  const region = options.region ?? 'ap-southeast-1';
  const url =
    options.urlStyle === 'global'
      ? `https://${options.bucket}.s3.amazonaws.com/${key}`
      : `https://${options.bucket}.s3.${region}.amazonaws.com/${key}`;

  return { key, url };
}
