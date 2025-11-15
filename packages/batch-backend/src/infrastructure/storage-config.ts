// packages/batch-backend/src/infrastructure/storage-config.ts

import path from 'node:path';

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

    const fsUploadDir = this.config.filesystem?.uploadDir || './uploads';
    this.config.filesystem.uploadDir = path.isAbsolute(fsUploadDir)
      ? fsUploadDir
      : path.resolve(process.cwd(), fsUploadDir);

    this.validateConfig();
  }

  private validateConfig(): void {
    if (this.config.provider === 's3' || this.config.provider === 'minio') {
      if (
        !this.config.s3.accessKeyId ||
        !this.config.s3.secretAccessKey ||
        !this.config.s3.bucket
      ) {
        throw new Error(
          'S3/MinIO configuration incomplete: missing access key, secret key, or bucket name'
        );
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
export function createStorageConfigService(
  config?: Partial<StorageConfig>
): StorageConfigurationService {
  const uploadDirEnv = process.env.FILESYSTEM_UPLOAD_DIR || './uploads';
  const resolvedUploadDir = path.isAbsolute(uploadDirEnv)
    ? uploadDirEnv
    : path.resolve(process.cwd(), uploadDirEnv);

  const requestedProvider = process.env.STORAGE_PROVIDER as StorageProvider | undefined;
  const minioEnabled = (process.env.MINIO_ENABLED ?? '').toLowerCase() === 'true';
  const hasAwsBucket =
    Boolean(process.env.S3_BUCKET) ||
    Boolean(process.env.S3_BUCKET_NAME) ||
    Boolean(process.env.STORAGE_BUCKET_NAME);

  let derivedProvider: StorageProvider = 'filesystem';
  if (requestedProvider === 's3' || requestedProvider === 'minio' || requestedProvider === 'filesystem') {
    derivedProvider = requestedProvider;
  } else if (hasAwsBucket) {
    derivedProvider = 's3';
  } else if (minioEnabled) {
    derivedProvider = 'minio';
  }

  const awsRegion = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
  const awsBucket = process.env.S3_BUCKET_NAME || process.env.S3_BUCKET || process.env.STORAGE_BUCKET_NAME || '';

  const minioPort = process.env.MINIO_PORT ? Number(process.env.MINIO_PORT) : undefined;
  const minioEndpointHost = process.env.MINIO_ENDPOINT || 'minio';
  const minioUseSSL = (process.env.MINIO_USE_SSL ?? '').toLowerCase() === 'true';
  const minioBucket = process.env.MINIO_BUCKET || awsBucket;
  const minioEndpoint =
    process.env.MINIO_ENDPOINT && process.env.MINIO_ENDPOINT.startsWith('http')
      ? process.env.MINIO_ENDPOINT
      : `http${minioUseSSL ? 's' : ''}://${minioEndpointHost}${
          minioPort ? `:${minioPort}` : ''
        }`;

  const s3AccessKey = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '';
  const s3SecretKey = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '';

  const defaultConfig: StorageConfig = {
    provider: derivedProvider,
    s3: {
      endpoint: derivedProvider === 'minio' ? minioEndpoint : process.env.S3_ENDPOINT,
      region: derivedProvider === 'minio' ? process.env.MINIO_REGION || 'us-east-1' : awsRegion,
      accessKeyId:
        derivedProvider === 'minio'
          ? process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || s3AccessKey
          : s3AccessKey,
      secretAccessKey:
        derivedProvider === 'minio'
          ? process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || s3SecretKey
          : s3SecretKey,
      bucket: derivedProvider === 'minio' ? minioBucket || awsBucket : awsBucket,
      pathPrefix: process.env.S3_PATH_PREFIX,
      forcePathStyle:
        derivedProvider === 'minio'
          ? true
          : process.env.S3_FORCE_PATH_STYLE?.toLowerCase() === 'true',
    },
    filesystem: {
      uploadDir: resolvedUploadDir,
    },
    lifecycle: {
      presignedUrlExpiresIn: parseInt(process.env.PRESIGNED_URL_EXPIRES_IN || '3600'),
      enableMultipartUploads: process.env.ENABLE_MULTIPART_UPLOADS !== 'false',
      maxMultipartSize: parseInt(process.env.MAX_MULTIPART_SIZE || String(100 * 1024 * 1024)),
    },
  };

  return new StorageConfigurationService({ ...defaultConfig, ...config });
}
