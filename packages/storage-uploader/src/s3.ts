import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import {
  ConfigurationError,
  type PipelineLogger,
  ValidationError,
  noopLogger,
} from '@esl-pipeline/contracts';

import { deriveS3ObjectUrl, deriveS3UploadAddress, normalizeS3ObjectKey } from './address.js';

interface S3ErrorShape {
  Code?: string;
  message?: string;
  name?: string;
  $metadata?: {
    httpStatusCode?: number;
  };
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

function isObjectNotFound(error: unknown): boolean {
  const e = error as Partial<S3ErrorShape>;
  return e?.name === 'NotFound' || e?.Code === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
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

function resolveSkipIfExists(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  const disabled = process.env.ESL_ARTIFACT_REUSE_DISABLE;
  if (!disabled) return true;
  const normalized = disabled.trim().toLowerCase();
  return !(normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on');
}

function resolveContentType(localPath: string, override?: string): string {
  if (override) return override;
  const normalizedPath = localPath.toLowerCase();
  return normalizedPath.endsWith('.mp3')
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
}

async function computeSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

export async function uploadToS3(
  localPath: string,
  {
    bucket = process.env.S3_BUCKET!,
    region = process.env.AWS_REGION ?? 'ap-southeast-1',
    keyPrefix = process.env.S3_PREFIX ?? '',
    key,
    sha256,
    skipIfExists,
    contentType,
    publicRead = false, // whether to attempt ACL
    logger = noopLogger,
  }: {
    bucket?: string;
    region?: string;
    keyPrefix?: string;
    key?: string;
    sha256?: string;
    skipIfExists?: boolean;
    contentType?: string;
    publicRead?: boolean;
    logger?: PipelineLogger;
  } = {},
): Promise<{
  url: string;
  key: string;
  etag?: string;
  reused?: boolean;
  sizeBytes?: number;
  sha256?: string;
}> {
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
  const fallbackTarget = deriveS3UploadAddress({
    bucket,
    region,
    keyPrefix,
    filePath: localPath,
  });
  const resolvedKey = key ? normalizeS3ObjectKey(key) : fallbackTarget.key;
  const url = deriveS3ObjectUrl({
    bucket,
    region,
    key: resolvedKey,
  });
  const shouldSkipIfExists = resolveSkipIfExists(skipIfExists);
  const resolvedSha256 = sha256 ?? (await computeSha256(localPath));
  const resolvedContentType = resolveContentType(localPath, contentType);

  if (shouldSkipIfExists) {
    try {
      const head = await s3.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: resolvedKey,
        }),
      );
      const remoteHash = head.Metadata?.sha256;
      const contentLength = typeof head.ContentLength === 'number' ? head.ContentLength : undefined;
      const hashMatches = Boolean(remoteHash && resolvedSha256 && remoteHash === resolvedSha256);
      const sizeMatches = contentLength !== undefined && contentLength === stats.size;
      if (hashMatches || (!remoteHash && sizeMatches)) {
        return {
          url,
          key: resolvedKey,
          etag: head.ETag,
          reused: true,
          sizeBytes: contentLength ?? stats.size,
          sha256: resolvedSha256,
        };
      }
    } catch (error: unknown) {
      if (!isObjectNotFound(error)) {
        throw error;
      }
    }
  }

  const base = {
    Bucket: bucket,
    Key: resolvedKey,
    ContentType: resolvedContentType,
    Metadata: resolvedSha256 ? { sha256: resolvedSha256 } : undefined,
    // no ACL by default
  };

  const sendPutObject = async (acl?: 'public-read') => {
    const put = new PutObjectCommand({
      ...base,
      Body: createReadStream(localPath),
      ...(acl ? { ACL: acl } : {}),
    });
    return s3.send(put);
  };

  // Try with ACL if requested
  if (publicRead) {
    try {
      const res = await sendPutObject('public-read');
      return { url, key: resolvedKey, etag: res.ETag, reused: false, sizeBytes: stats.size, sha256: resolvedSha256 };
    } catch (error: unknown) {
      if (!isAclNotSupported(error)) throw error;
      // Fall back to no-ACL
      logger.log({
        level: 'warn',
        message:
          '[S3] ACL not supported on this bucket (Object Ownership: Bucket owner enforced). Retrying without ACL…',
        detail: { bucket, region, key: resolvedKey },
        stage: 'upload',
      });
    }
  }

  // No ACL path (recommended with ACLs disabled)
  const res = await sendPutObject();
  return { url, key: resolvedKey, etag: res.ETag, reused: false, sizeBytes: stats.size, sha256: resolvedSha256 };
}
