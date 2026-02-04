import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

import {
  ConfigurationError,
  ValidationError,
  noopLogger,
  type PipelineLogger,
} from '@esl-pipeline/contracts';

interface S3ErrorShape {
  Code?: string;
  message?: string;
}

type ClientKey = string;
const s3ClientCache = new Map<ClientKey, S3Client>();
const DEFAULT_UPLOAD_MAX_MB = 50;

function getS3Client(region: string): S3Client {
  const key = region || 'default';
  const existing = s3ClientCache.get(key);
  if (existing) return existing;
  const client = new S3Client({ region });
  s3ClientCache.set(key, client);
  return client;
}

function isAclNotSupported(error: unknown): boolean {
  const e = error as Partial<S3ErrorShape>;
  // SDK v3 S3 error shape is a ServiceException with a Code field in the body.
  return (
    e?.Code === 'AccessControlListNotSupported' ||
    /AccessControlListNotSupported/i.test(String(e?.message ?? ''))
  );
}

function resolveUploadMaxMb(): number {
  const raw = process.env.S3_UPLOAD_MAX_MB;
  if (raw === undefined) return DEFAULT_UPLOAD_MAX_MB;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_UPLOAD_MAX_MB;
}

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}

export async function uploadToS3(
  localPath: string,
  {
    bucket = process.env.S3_BUCKET!,
    region = process.env.AWS_REGION ?? 'ap-southeast-1',
    keyPrefix = process.env.S3_PREFIX ?? '',
    publicRead = false, // whether to attempt ACL
    logger = noopLogger,
  }: {
    bucket?: string;
    region?: string;
    keyPrefix?: string;
    publicRead?: boolean;
    logger?: PipelineLogger;
  } = {},
): Promise<{ url: string; key: string; etag?: string }> {
  if (!bucket) throw new ConfigurationError('S3 bucket not configured');

  const stats = await stat(localPath);
  const maxMb = resolveUploadMaxMb();
  const maxBytes = maxMb * 1024 * 1024;
  if (stats.size > maxBytes) {
    throw new ValidationError(
      `S3 upload size cap exceeded: ${formatMb(stats.size)} MB > ${maxMb} MB. ` +
        'Set S3_UPLOAD_MAX_MB to increase the limit.',
    );
  }

  const s3 = getS3Client(region);
  const fileContent = await readFile(localPath);
  const normalizedPrefix = keyPrefix
    ? keyPrefix.replace(/^[\/\\]+/, '').replace(/[\/\\]+$/, '')
    : '';
  const key = normalizedPrefix ? `${normalizedPrefix}/${basename(localPath)}` : basename(localPath);
  const normalizedPath = localPath.toLowerCase();
  const contentType = normalizedPath.endsWith('.mp3')
    ? 'audio/mpeg'
    : normalizedPath.endsWith('.wav')
      ? 'audio/wav'
      : normalizedPath.endsWith('.m4a')
        ? 'audio/mp4'
        : normalizedPath.endsWith('.aac')
          ? 'audio/aac'
          : normalizedPath.endsWith('.ogg') || normalizedPath.endsWith('.opus')
            ? 'audio/ogg'
            : normalizedPath.endsWith('.html') || normalizedPath.endsWith('.htm')
              ? 'text/html'
              : normalizedPath.endsWith('.css')
                ? 'text/css'
                : normalizedPath.endsWith('.js')
                  ? 'application/javascript'
                  : normalizedPath.endsWith('.json')
                    ? 'application/json'
                    : normalizedPath.endsWith('.md')
                      ? 'text/markdown'
                      : normalizedPath.endsWith('.txt')
                        ? 'text/plain'
                        : 'application/octet-stream';

  const base = {
    Bucket: bucket,
    Key: key,
    Body: fileContent,
    ContentType: contentType,
    // no ACL by default
  };

  // Try with ACL if requested
  if (publicRead) {
    try {
      const put = new PutObjectCommand({ ...base, ACL: 'public-read' });
      const res = await s3.send(put);
      const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
      return { url, key, etag: res.ETag };
    } catch (error: unknown) {
      if (!isAclNotSupported(error)) throw error;
      // Fall back to no-ACL
      logger.log({
        level: 'warn',
        message:
          '[S3] ACL not supported on this bucket (Object Ownership: Bucket owner enforced). Retrying without ACL…',
        detail: { bucket, region, key },
        stage: 'upload',
      });
    }
  }

  // No ACL path (recommended with ACLs disabled)
  const putNoAcl = new PutObjectCommand(base);
  const res = await s3.send(putNoAcl);
  const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  return { url, key, etag: res.ETag };
}
