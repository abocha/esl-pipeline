// packages/batch-backend/src/infrastructure/file-storage-service.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { Readable } from 'stream';
import { logger } from './logger';
import { S3StorageAdapter, FileUploadResult, FileMetadata, PresignedUrlOptions } from './s3-storage-adapter';
import { StorageConfigurationService, StorageProvider } from './storage-config';

export interface FileStorageResult {
  key: string;
  url?: string; // S3 presigned URL or local file path
  size: number;
  mimeType: string;
  uploadedAt: Date;
}

export interface FileStorageMetadata {
  key: string;
  size: number;
  mimeType: string;
  lastModified?: Date;
  etag?: string;
}

export class FileStorageService {
  private storageConfig: StorageConfigurationService;
  private s3Adapter?: S3StorageAdapter;

  constructor(storageConfig: StorageConfigurationService) {
    this.storageConfig = storageConfig;

    if (this.storageConfig.isS3Provider()) {
      // Initialize S3 adapter for S3/MinIO providers
      const s3Config = this.storageConfig.getS3Config();
      this.s3Adapter = new S3StorageAdapter({
        endpoint: s3Config.endpoint,
        region: s3Config.region,
        accessKeyId: s3Config.accessKeyId,
        secretAccessKey: s3Config.secretAccessKey,
        bucket: s3Config.bucket,
        pathPrefix: s3Config.pathPrefix,
        forcePathStyle: s3Config.forcePathStyle,
      });
    }
  }

  /**
   * Upload a file to the configured storage provider
   */
  async uploadFile(
    key: string,
    content: Readable | Buffer | string,
    mimeType: string,
    size?: number
  ): Promise<FileStorageResult> {
    try {
      if (this.storageConfig.isS3Provider() && this.s3Adapter) {
        // Upload to S3/MinIO
        const result = await this.s3Adapter.uploadFile(key, content, mimeType, size);

        // Generate presigned URL for access
        const lifecycle = this.storageConfig.getLifecycleConfig();
        const url = await this.s3Adapter.generatePresignedUrl(key, {
          expiresIn: lifecycle.presignedUrlExpiresIn,
        });

        return {
          key: result.key,
          url,
          size: result.size,
          mimeType: result.mimeType,
          uploadedAt: new Date(),
        };
      } else if (this.storageConfig.isFilesystemProvider()) {
        // Upload to local filesystem
        return await this.uploadToFilesystem(key, content, mimeType);
      } else {
        throw new Error(`Unsupported storage provider: ${this.storageConfig.getProvider()}`);
      }
    } catch (error) {
      logger.error('Failed to upload file', {
        key,
        provider: this.storageConfig.getProvider(),
        error: String(error),
      });
      throw new Error(`File upload failed: ${error}`);
    }
  }

  /**
   * Get file metadata
   */
  async getFileMetadata(key: string): Promise<FileStorageMetadata | null> {
    try {
      if (this.storageConfig.isS3Provider() && this.s3Adapter) {
        return await this.s3Adapter.getFileMetadata(key);
      } else if (this.storageConfig.isFilesystemProvider()) {
        return await this.getFilesystemMetadata(key);
      } else {
        throw new Error(`Unsupported storage provider: ${this.storageConfig.getProvider()}`);
      }
    } catch (error) {
      logger.error('Failed to get file metadata', {
        key,
        provider: this.storageConfig.getProvider(),
        error: String(error),
      });
      return null;
    }
  }

  /**
   * Generate a presigned URL for file access (S3 only)
   */
  async generatePresignedUrl(key: string, options?: PresignedUrlOptions): Promise<string | null> {
    if (!this.storageConfig.isS3Provider() || !this.s3Adapter) {
      return null; // Not applicable for filesystem storage
    }

    try {
      const defaultExpiresIn = this.storageConfig.getLifecycleConfig().presignedUrlExpiresIn;
      return await this.s3Adapter.generatePresignedUrl(key, {
        expiresIn: options?.expiresIn || defaultExpiresIn,
      });
    } catch (error) {
      logger.error('Failed to generate presigned URL', {
        key,
        error: String(error),
      });
      throw new Error(`Presigned URL generation failed: ${error}`);
    }
  }

  /**
   * Delete a file from storage
   */
  async deleteFile(key: string): Promise<void> {
    try {
      if (this.storageConfig.isS3Provider() && this.s3Adapter) {
        await this.s3Adapter.deleteFile(key);
      } else if (this.storageConfig.isFilesystemProvider()) {
        await this.deleteFromFilesystem(key);
      } else {
        throw new Error(`Unsupported storage provider: ${this.storageConfig.getProvider()}`);
      }

      logger.info('File deleted successfully', {
        key,
        provider: this.storageConfig.getProvider(),
      });
    } catch (error) {
      logger.error('Failed to delete file', {
        key,
        provider: this.storageConfig.getProvider(),
        error: String(error),
      });
      throw new Error(`File deletion failed: ${error}`);
    }
  }

  /**
   * Check if a file exists in storage
   */
  async fileExists(key: string): Promise<boolean> {
    try {
      const metadata = await this.getFileMetadata(key);
      return metadata !== null;
    } catch {
      return false;
    }
  }

  /**
   * Migrate files from filesystem to S3 (for backward compatibility)
   */
  async migrateFileToS3(key: string): Promise<FileStorageResult | null> {
    if (!this.storageConfig.isS3Provider() || !this.s3Adapter) {
      return null; // Only applicable when using S3
    }

    try {
      // Check if file exists in filesystem
      const fsMetadata = await this.getFilesystemMetadata(key);
      if (!fsMetadata) {
        return null; // File doesn't exist in filesystem
      }

      // Check if file already exists in S3
      const s3Exists = await this.s3Adapter.fileExists(key);
      if (s3Exists) {
        // Generate URL for existing S3 file
        const url = await this.s3Adapter.generatePresignedUrl(key);
        return {
          key,
          url,
          size: fsMetadata.size,
          mimeType: fsMetadata.mimeType,
          uploadedAt: new Date(),
        };
      }

      // Read file from filesystem
      const fsConfig = this.storageConfig.getFilesystemConfig();
      const filePath = path.join(fsConfig.uploadDir, key);
      const fileContent = await fs.readFile(filePath);

      // Upload to S3
      const result = await this.s3Adapter.uploadFile(key, fileContent, fsMetadata.mimeType, fsMetadata.size);
      const url = await this.s3Adapter.generatePresignedUrl(key);

      logger.info('File migrated from filesystem to S3', { key });

      return {
        key: result.key,
        url,
        size: result.size,
        mimeType: result.mimeType,
        uploadedAt: new Date(),
      };
    } catch (error) {
      logger.error('Failed to migrate file to S3', {
        key,
        error: String(error),
      });
      return null;
    }
  }

  /**
   * Upload file to local filesystem
   */
  private async uploadToFilesystem(
    key: string,
    content: Readable | Buffer | string,
    mimeType: string
  ): Promise<FileStorageResult> {
    const fsConfig = this.storageConfig.getFilesystemConfig();
    const filePath = path.join(fsConfig.uploadDir, key);
    const dirPath = path.dirname(filePath);

    // Ensure directory exists
    await fs.mkdir(dirPath, { recursive: true });

    // Write file
    if (content instanceof Readable) {
      const chunks: Buffer[] = [];
      for await (const chunk of content) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      await fs.writeFile(filePath, buffer);
    } else {
      await fs.writeFile(filePath, content);
    }

    // Get file stats
    const stats = await fs.stat(filePath);

    logger.info('File uploaded to filesystem', {
      path: filePath,
      size: stats.size,
      mimeType,
    });

    return {
      key,
      url: filePath, // Return local file path
      size: stats.size,
      mimeType,
      uploadedAt: new Date(),
    };
  }

  /**
   * Get metadata for filesystem file
   */
  private async getFilesystemMetadata(key: string): Promise<FileStorageMetadata | null> {
    try {
      const fsConfig = this.storageConfig.getFilesystemConfig();
      const filePath = path.join(fsConfig.uploadDir, key);

      const stats = await fs.stat(filePath);

      return {
        key,
        size: stats.size,
        mimeType: 'application/octet-stream', // Would need additional detection
        lastModified: stats.mtime,
      };
    } catch {
      return null;
    }
  }

  /**
   * Delete file from filesystem
   */
  private async deleteFromFilesystem(key: string): Promise<void> {
    const fsConfig = this.storageConfig.getFilesystemConfig();
    const filePath = path.join(fsConfig.uploadDir, key);

    await fs.unlink(filePath);
  }

  /**
   * Get the configured storage provider
   */
  getProvider(): StorageProvider {
    return this.storageConfig.getProvider();
  }
}

/**
 * Create file storage service from configuration
 */
export function createFileStorageService(storageConfig: StorageConfigurationService): FileStorageService {
  return new FileStorageService(storageConfig);
}