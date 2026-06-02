import { basename } from 'node:path';

export type S3UrlStyle = 'regional' | 'global';

export interface S3UploadAddressOptions {
  bucket: string;
  region?: string;
  keyPrefix?: string;
  filePath: string;
  urlStyle?: S3UrlStyle;
}

export interface S3ObjectUrlOptions {
  bucket: string;
  region?: string;
  key: string;
  urlStyle?: S3UrlStyle;
}

export function sanitizeS3KeyPrefix(prefix?: string): string {
  if (!prefix) return '';
  return prefix.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');
}

export function normalizeS3ObjectKey(key: string): string {
  return key.replace(/^[/\\]+/, '').replaceAll('\\', '/');
}

export function deriveS3ObjectUrl(options: S3ObjectUrlOptions): string {
  const region = options.region ?? 'ap-southeast-1';
  const normalizedKey = normalizeS3ObjectKey(options.key);
  const encodedKey = normalizedKey.split('/').map(encodeURIComponent).join('/');
  return options.urlStyle === 'global'
    ? `https://${options.bucket}.s3.amazonaws.com/${encodedKey}`
    : `https://${options.bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
}

export function deriveS3UploadAddress(options: S3UploadAddressOptions): {
  key: string;
  url: string;
} {
  const normalizedPrefix = sanitizeS3KeyPrefix(options.keyPrefix);
  const fileName = basename(options.filePath);
  const key = normalizeS3ObjectKey(normalizedPrefix ? `${normalizedPrefix}/${fileName}` : fileName);
  const url = deriveS3ObjectUrl({
    bucket: options.bucket,
    region: options.region,
    key,
    urlStyle: options.urlStyle,
  });

  return { key, url };
}
