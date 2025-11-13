// packages/batch-backend/src/infrastructure/storage-config.ts

export type StorageProvider = 's3' | 'minio' | 'filesystem';

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

    this.validateConfig();
  }

  private validateConfig(): void {
    if (this.config.provider === 's3' || this.config.provider === 'minio') {
      if (!this.config.s3.accessKeyId || !this.config.s3.secretAccessKey || !this.config.s3.bucket) {
        throw new Error('S3/MinIO configuration incomplete: missing access key, secret key, or bucket name');
      }
    }
  }

  getProvider(): StorageProvider {
    return this.config.provider;
  }

  isS3Provider(): boolean {
    return this.config.provider === 's3' || this.config.provider === 'minio';
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
export function createStorageConfigService(config?: Partial<StorageConfig>): StorageConfigurationService {
  const defaultConfig: StorageConfig = {
    provider: (process.env.STORAGE_PROVIDER as StorageProvider) || 'filesystem',
    s3: {
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'us-east-1',
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      bucket: process.env.S3_BUCKET_NAME || '',
      pathPrefix: process.env.S3_PATH_PREFIX,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    },
    filesystem: {
      uploadDir: process.env.FILESYSTEM_UPLOAD_DIR || './uploads',
    },
    lifecycle: {
      presignedUrlExpiresIn: parseInt(process.env.PRESIGNED_URL_EXPIRES_IN || '3600'),
      enableMultipartUploads: process.env.ENABLE_MULTIPART_UPLOADS !== 'false',
      maxMultipartSize: parseInt(process.env.MAX_MULTIPART_SIZE || String(100 * 1024 * 1024)),
    },
  };

  return new StorageConfigurationService({ ...defaultConfig, ...config });
}