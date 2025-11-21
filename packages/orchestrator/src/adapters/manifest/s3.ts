import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { basename, extname, isAbsolute, relative } from 'node:path';
import { posix as posixPath } from 'node:path';

import type { AssignmentManifest, ManifestStore } from '../../manifest.js';

export interface S3ManifestStoreOptions {
  bucket: string;
  prefix?: string;
  region?: string;
  rootDir?: string;
  client?: S3Client;
}

const sanitizePathComponent = (value: string): string =>
  value.replace(/^[./\\]+/, '').replaceAll(':', '_');

const trimPrefix = (value?: string): string | undefined => {
  if (!value) return undefined;
  return value.replaceAll(/^\/+|\/+$/g, '');
};

export class S3ManifestStore implements ManifestStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix?: string;
  private readonly rootDir?: string;

  constructor(options: S3ManifestStoreOptions) {
    this.bucket = options.bucket;
    this.prefix = trimPrefix(options.prefix);
    this.rootDir = options.rootDir;
    this.client = options.client ?? new S3Client({ region: options.region });
  }

  manifestPathFor(mdPath: string): string {
    const key = this.keyFor(mdPath);
    return `s3://${this.bucket}/${key}`;
  }

  async writeManifest(mdPath: string, manifest: AssignmentManifest): Promise<string> {
    const key = this.keyFor(mdPath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(manifest, null, 2),
        ContentType: 'application/json',
      }),
    );
    return `s3://${this.bucket}/${key}`;
  }

  async readManifest(mdPath: string): Promise<AssignmentManifest | null> {
    const key = this.keyFor(mdPath);
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = await response.Body?.transformToString();
      if (!body) return null;
      return JSON.parse(body) as AssignmentManifest;
    } catch (error: unknown) {
      const maybe = error as { $metadata?: { httpStatusCode?: number }; name?: string };
      const status = maybe?.$metadata?.httpStatusCode;
      if (status === 404 || maybe?.name === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }

  private keyFor(mdPath: string): string {
    let relativePath = mdPath;
    if (this.rootDir && isAbsolute(mdPath)) {
      const candidate = relative(this.rootDir, mdPath);
      relativePath = candidate && !candidate.startsWith('..') ? candidate : basename(mdPath);
    }

    const withoutExt = relativePath
      ? relativePath.slice(0, relativePath.length - extname(relativePath).length)
      : relativePath;
    const sanitized = sanitizePathComponent(withoutExt).split(/\\+/).join('/');
    const manifestKey = sanitized
      ? `${sanitized}.manifest.json`
      : `${basename(mdPath, extname(mdPath))}.manifest.json`;

    const normalized = posixPath.normalize(manifestKey);
    if (this.prefix) {
      return `${this.prefix}/${normalized}`;
    }
    return normalized;
  }
}
