/**
 * Storage configuration service.
 * Consolidated from batch-backend/src/infrastructure/storage-config.ts
 */
import path from 'node:path';

import { ConfigurationError } from '@esl-pipeline/contracts';

import { readBool, readInt, readString } from '../env/loaders.js';

export type StorageProvider = 's3' | 'filesystem';

export interface StorageConfig {
  provider: StorageProvider;
  s3: {
    endpoint?: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    pathPrefix?: string;
    forcePathStyle?: boolean;
  };
  filesystem: {
    uploadDir: string;
  };
  lifecycle: {
    presignedUrlExpiresIn: number; // seconds
    enableMultipartUploads: boolean;
    maxMultipartSize: number; // bytes
  };
}

export class StorageConfigurationService {
  private config: StorageConfig;

  constructor(config?: Partial<StorageConfig>) {
    this.config = {
      provider: 'filesystem',
      s3: {
        region: 'us-east-1',
        accessKeyId: '',
        secretAccessKey: '',
        bucket: '',
        forcePathStyle: false,
      },
      filesystem: {
        uploadDir: './uploads',
      },
      lifecycle: {
        presignedUrlExpiresIn: 3600,
        enableMultipartUploads: true,
        maxMultipartSize: 100 * 1024 * 1024, // 100MB
      },
      ...config,
    };

    const fsUploadDir = this.config.filesystem?.uploadDir || './uploads';
    this.config.filesystem.uploadDir = path.isAbsolute(fsUploadDir)
      ? fsUploadDir
      : path.resolve(process.cwd(), fsUploadDir);

    this.validateConfig();
  }

  private validateConfig(): void {
    if (
      this.config.provider === 's3' &&
      (!this.config.s3.accessKeyId || !this.config.s3.secretAccessKey || !this.config.s3.bucket)
    ) {
      throw new ConfigurationError(
        'S3 configuration incomplete: missing access key, secret key, or bucket name',
      );
    }
  }

  getProvider(): StorageProvider {
    return this.config.provider;
  }

  isS3Provider(): boolean {
    return this.config.provider === 's3';
  }

  isFilesystemProvider(): boolean {
    return this.config.provider === 'filesystem';
  }

  getS3Config() {
    return this.config.s3;
  }

  getFilesystemConfig() {
    return this.config.filesystem;
  }

  getLifecycleConfig() {
    return this.config.lifecycle;
  }

  getFullConfig(): StorageConfig {
    return this.config;
  }
}

/**
 * Create storage configuration service from environment variables
 */
export function createStorageConfigService(
  config?: Partial<StorageConfig>,
): StorageConfigurationService {
  const uploadDirEnv = readString('FILESYSTEM_UPLOAD_DIR') || './uploads';
  const resolvedUploadDir = path.isAbsolute(uploadDirEnv)
    ? uploadDirEnv
    : path.resolve(process.cwd(), uploadDirEnv);

  const awsRegion = readString('S3_REGION') || readString('AWS_REGION') || 'us-east-1';
  const awsBucket =
    readString('S3_BUCKET_NAME') ||
    readString('S3_BUCKET') ||
    readString('STORAGE_BUCKET_NAME') ||
    '';

  const s3AccessKey = readString('S3_ACCESS_KEY_ID') || readString('AWS_ACCESS_KEY_ID') || '';
  const s3SecretKey =
    readString('S3_SECRET_ACCESS_KEY') || readString('AWS_SECRET_ACCESS_KEY') || '';
  const hasS3Credentials = Boolean(awsBucket && s3AccessKey && s3SecretKey);

  const requestedProvider = readString('STORAGE_PROVIDER');
  let derivedProvider: StorageProvider;
  if (requestedProvider) {
    if (requestedProvider !== 's3' && requestedProvider !== 'filesystem') {
      throw new ConfigurationError(
        `Invalid STORAGE_PROVIDER "${requestedProvider}": expected "s3" or "filesystem"`,
      );
    }
    derivedProvider = requestedProvider;
  } else {
    derivedProvider = hasS3Credentials ? 's3' : 'filesystem';
  }

  const defaultConfig: StorageConfig = {
    provider: derivedProvider,
    s3: {
      endpoint: readString('S3_ENDPOINT'),
      region: awsRegion,
      accessKeyId: s3AccessKey,
      secretAccessKey: s3SecretKey,
      bucket: awsBucket,
      pathPrefix: readString('S3_PATH_PREFIX'),
      forcePathStyle: readBool('S3_FORCE_PATH_STYLE', false),
    },
    filesystem: {
      uploadDir: resolvedUploadDir,
    },
    lifecycle: {
      presignedUrlExpiresIn: readInt('PRESIGNED_URL_EXPIRES_IN', 3600),
      enableMultipartUploads: readBool('ENABLE_MULTIPART_UPLOADS', true),
      maxMultipartSize: readInt('MAX_MULTIPART_SIZE', 100 * 1024 * 1024),
    },
  };

  return new StorageConfigurationService({ ...defaultConfig, ...config });
}
