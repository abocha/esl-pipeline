import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { createStorageConfigService } from '@esl-pipeline/shared-infrastructure';

import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { type FileMetadata, S3StorageAdapter } from '../infrastructure/s3-storage-adapter.js';

interface CliOptions {
  keepObject: boolean;
  key?: string;
  presignSeconds: number;
}

export interface S3SmokeAdapter {
  uploadFile(
    key: string,
    content: Buffer,
    mimeType: string,
    size: number,
  ): Promise<{ key: string }>;
  getFileMetadata(key: string): Promise<FileMetadata | null>;
  generatePresignedUrl(key: string, options: { expiresIn: number }): Promise<string>;
  deleteFile(key: string): Promise<void>;
}

export interface S3SmokeOptions {
  adapter: S3SmokeAdapter;
  bucket: string;
  key?: string;
  keepObject?: boolean;
  presignSeconds?: number;
  now?: Date;
  id?: string;
}

export interface S3SmokeResult {
  ok: boolean;
  bucket: string;
  key: string;
  size: number;
  presignedUrlGenerated: boolean;
  deleted: boolean;
}

function normalizeKey(key: string): string {
  const normalized = key.replaceAll('\\', '/').replace(/^\/+/, '').trim();
  if (
    !normalized ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new Error('Smoke key must be a relative S3 object key.');
  }
  return normalized;
}

function defaultSmokeKey(now: Date, id: string): string {
  const stamp = now.toISOString().replaceAll(/[-:.]/g, '').replace('T', '-').replace('Z', 'Z');
  return `smoke/closed-alpha/s3-storage-${stamp}-${id}.txt`;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    keepObject: false,
    presignSeconds: 300,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--keep') {
      options.keepObject = true;
      continue;
    }
    if (arg === '--key') {
      const value = argv[i + 1];
      if (!value) throw new Error('--key requires a value');
      options.key = normalizeKey(value);
      i += 1;
      continue;
    }
    if (arg === '--presign-seconds') {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value <= 0 || value > 3600) {
        throw new Error('--presign-seconds must be an integer from 1 to 3600');
      }
      options.presignSeconds = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export async function runS3StorageSmoke(options: S3SmokeOptions): Promise<S3SmokeResult> {
  const now = options.now ?? new Date();
  const id = options.id ?? randomUUID();
  const key = normalizeKey(options.key ?? defaultSmokeKey(now, id));
  const presignSeconds = options.presignSeconds ?? 300;
  const content = Buffer.from(
    `esl-pipeline closed-alpha S3 smoke\ncreated_at=${now.toISOString()}\nid=${id}\n`,
    'utf8',
  );

  let uploaded = false;
  let deleted = false;
  try {
    await options.adapter.uploadFile(key, content, 'text/plain', content.length);
    uploaded = true;

    const metadata = await options.adapter.getFileMetadata(key);
    if (!metadata) {
      throw new Error('Uploaded smoke object was not readable through HeadObject.');
    }
    if (metadata.size !== content.length) {
      throw new Error(`Uploaded smoke object size mismatch: ${metadata.size} != ${content.length}`);
    }

    const presignedUrl = await options.adapter.generatePresignedUrl(key, {
      expiresIn: presignSeconds,
    });
    if (!/^https?:\/\//.test(presignedUrl)) {
      throw new Error('S3 smoke presigned URL was not an HTTP URL.');
    }

    if (!options.keepObject) {
      await options.adapter.deleteFile(key);
      deleted = true;
    }

    return {
      ok: true,
      bucket: options.bucket,
      key: metadata.key,
      size: metadata.size,
      presignedUrlGenerated: true,
      deleted: !options.keepObject,
    };
  } finally {
    if (uploaded && !options.keepObject && !deleted) {
      await options.adapter.deleteFile(key).catch(() => undefined);
    }
  }
}

async function main(): Promise<void> {
  loadBatchBackendEnv(import.meta.url, 'batch-backend-s3-storage-smoke');
  const cli = parseArgs(process.argv.slice(2));
  const storageConfig = createStorageConfigService();

  if (!storageConfig.isS3Provider()) {
    throw new Error('S3 smoke requires STORAGE_PROVIDER=s3 and complete S3/AWS credentials.');
  }

  const s3Config = storageConfig.getS3Config();
  const result = await runS3StorageSmoke({
    adapter: new S3StorageAdapter(s3Config),
    bucket: s3Config.bucket,
    key: cli.key,
    keepObject: cli.keepObject,
    presignSeconds: cli.presignSeconds,
  });

  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
