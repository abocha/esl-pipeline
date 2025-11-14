// packages/batch-backend/src/infrastructure/s3-storage-adapter.ts

import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import { logger } from './logger';

export interface S3StorageConfig {
  endpoint?: string; // For MinIO compatibility
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  pathPrefix?: string;
  forcePathStyle?: boolean; // For MinIO
}

export interface FileUploadResult {
  key: string;
  size: number;
  mimeType: string;
  etag?: string;
}

export interface FileMetadata {
  key: string;
  size: number;
  mimeType: string;
  lastModified?: Date;
  etag?: string;
}

export interface PresignedUrlOptions {
  expiresIn?: number; // seconds, default 3600 (1 hour)
}

export class S3StorageAdapter {
  private s3Client: S3Client;
  private config: S3StorageConfig;

  constructor(config: S3StorageConfig) {
    this.config = config;

    this.s3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle ?? (config.endpoint ? true : false),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  /**
   * Upload a file to S3 with multipart support for large files
   */
  async uploadFile(
    key: string,
    content: Readable | Buffer | string,
    mimeType: string,
    size?: number
  ): Promise<FileUploadResult> {
    try {
      const fullKey = this.getFullKey(key);

      // Use multipart upload for better performance on large files
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.config.bucket,
          Key: fullKey,
          Body: content,
          ContentType: mimeType,
          ...(size && { ContentLength: size }),
        },
      });

      const result = await upload.done();

      logger.info('File uploaded to S3', {
        bucket: this.config.bucket,
        key: fullKey,
        etag: result.ETag,
      });

      // For multipart uploads, we need to get the size from metadata since it's not in the result
      const metadata = await this.getFileMetadata(fullKey);
      const fileSize = metadata?.size || size || 0;

      return {
        key: fullKey,
        size: fileSize,
        mimeType,
        etag: result.ETag,
      };
    } catch (error) {
      logger.error('Failed to upload file to S3', {
        bucket: this.config.bucket,
        key: this.getFullKey(key),
        error: String(error),
      });
      throw new Error(`S3 upload failed: ${error}`);
    }
  }

  /**
   * Generate a presigned URL for secure file access
   */
  async generatePresignedUrl(key: string, options: PresignedUrlOptions = {}): Promise<string> {
    try {
      const fullKey = this.getFullKey(key);
      const expiresIn = options.expiresIn || 3600; // Default 1 hour

      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn });

      logger.info('Presigned URL generated', {
        bucket: this.config.bucket,
        key: fullKey,
        expiresIn,
      });

      return signedUrl;
    } catch (error) {
      logger.error('Failed to generate presigned URL', {
        bucket: this.config.bucket,
        key: this.getFullKey(key),
        error: String(error),
      });
      throw new Error(`Presigned URL generation failed: ${error}`);
    }
  }

  /**
   * Get file metadata from S3
   */
  async getFileMetadata(key: string): Promise<FileMetadata | null> {
    try {
      const fullKey = this.getFullKey(key);

      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
      });

      const response = await this.s3Client.send(command);

      return {
        key: fullKey,
        size: response.ContentLength || 0,
        mimeType: response.ContentType || 'application/octet-stream',
        lastModified: response.LastModified,
        etag: response.ETag,
      };
    } catch (error) {
      // If object doesn't exist, return null
      if ((error as any).name === 'NotFound') {
        return null;
      }

      logger.error('Failed to get file metadata from S3', {
        bucket: this.config.bucket,
        key: this.getFullKey(key),
        error: String(error),
      });
      throw new Error(`Failed to get file metadata: ${error}`);
    }
  }

  /**
   * Delete a file from S3
   */
  async deleteFile(key: string): Promise<void> {
    try {
      const fullKey = this.getFullKey(key);

      const command = new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey,
      });

      await this.s3Client.send(command);

      logger.info('File deleted from S3', {
        bucket: this.config.bucket,
        key: fullKey,
      });
    } catch (error) {
      logger.error('Failed to delete file from S3', {
        bucket: this.config.bucket,
        key: this.getFullKey(key),
        error: String(error),
      });
      throw new Error(`S3 delete failed: ${error}`);
    }
  }

  /**
   * Check if a file exists in S3
   */
  async fileExists(key: string): Promise<boolean> {
    try {
      await this.getFileMetadata(key);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the full S3 key including path prefix
   */
  private getFullKey(key: string): string {
    if (this.config.pathPrefix) {
      return `${this.config.pathPrefix}/${key}`.replace(/^\/+/, '');
    }
    return key;
  }

  /**
   * Get the configured bucket name
   */
  getBucketName(): string {
    return this.config.bucket;
  }

  /**
   * Get the configured region
   */
  getRegion(): string {
    return this.config.region;
  }
}

/**
 * Create S3 storage adapter from environment variables
 */
export function createS3StorageAdapter(config?: Partial<S3StorageConfig>): S3StorageAdapter {
  const defaultConfig: S3StorageConfig = {
    region: process.env.S3_REGION || 'us-east-1',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    bucket: process.env.S3_BUCKET_NAME || '',
    endpoint: process.env.S3_ENDPOINT,
    pathPrefix: process.env.S3_PATH_PREFIX,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  };

  const finalConfig = { ...defaultConfig, ...config };

  if (!finalConfig.accessKeyId || !finalConfig.secretAccessKey || !finalConfig.bucket) {
    throw new Error('S3 configuration incomplete: missing access key, secret key, or bucket name');
  }

  return new S3StorageAdapter(finalConfig);
}
