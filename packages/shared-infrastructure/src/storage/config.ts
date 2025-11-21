/**
 * Storage configuration service.
 * Consolidated from batch-backend/src/infrastructure/storage-config.ts
 */

import path from 'node:path';
import { ConfigurationError } from '@esl-pipeline/contracts';
import { readBool, readInt, readString } from '../env/loaders.js';

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
                throw new ConfigurationError(
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
    const uploadDirEnv = readString('FILESYSTEM_UPLOAD_DIR') || './uploads';
    const resolvedUploadDir = path.isAbsolute(uploadDirEnv)
        ? uploadDirEnv
        : path.resolve(process.cwd(), uploadDirEnv);

    const requestedProvider = readString('STORAGE_PROVIDER') as StorageProvider | undefined;
    const minioEnabled = readBool('MINIO_ENABLED', false);
    const hasAwsBucket =
        Boolean(readString('S3_BUCKET')) ||
        Boolean(readString('S3_BUCKET_NAME')) ||
        Boolean(readString('STORAGE_BUCKET_NAME'));

    let derivedProvider: StorageProvider = 'filesystem';
    if (requestedProvider === 's3' || requestedProvider === 'minio' || requestedProvider === 'filesystem') {
        derivedProvider = requestedProvider;
    } else if (hasAwsBucket) {
        derivedProvider = 's3';
    } else if (minioEnabled) {
        derivedProvider = 'minio';
    }

    const awsRegion = readString('S3_REGION') || readString('AWS_REGION') || 'us-east-1';
    const awsBucket = readString('S3_BUCKET_NAME') || readString('S3_BUCKET') || readString('STORAGE_BUCKET_NAME') || '';

    const minioPort = readInt('MINIO_PORT', 9000);
    const minioEndpointHost = readString('MINIO_ENDPOINT') || 'minio';
    const minioUseSSL = readBool('MINIO_USE_SSL', false);
    const minioBucket = readString('MINIO_BUCKET') || awsBucket;
    const minioEndpoint =
        readString('MINIO_ENDPOINT') && readString('MINIO_ENDPOINT')!.startsWith('http')
            ? readString('MINIO_ENDPOINT')!
            : `http${minioUseSSL ? 's' : ''}://${minioEndpointHost}:${minioPort}`;

    const s3AccessKey = readString('S3_ACCESS_KEY_ID') || readString('AWS_ACCESS_KEY_ID') || '';
    const s3SecretKey = readString('S3_SECRET_ACCESS_KEY') || readString('AWS_SECRET_ACCESS_KEY') || '';

    const defaultConfig: StorageConfig = {
        provider: derivedProvider,
        s3: {
            endpoint: derivedProvider === 'minio' ? minioEndpoint : readString('S3_ENDPOINT'),
            region: derivedProvider === 'minio' ? readString('MINIO_REGION') || 'us-east-1' : awsRegion,
            accessKeyId:
                derivedProvider === 'minio'
                    ? readString('MINIO_ACCESS_KEY') || readString('MINIO_ROOT_USER') || s3AccessKey
                    : s3AccessKey,
            secretAccessKey:
                derivedProvider === 'minio'
                    ? readString('MINIO_SECRET_KEY') || readString('MINIO_ROOT_PASSWORD') || s3SecretKey
                    : s3SecretKey,
            bucket: derivedProvider === 'minio' ? minioBucket || awsBucket : awsBucket,
            pathPrefix: readString('S3_PATH_PREFIX'),
            forcePathStyle:
                derivedProvider === 'minio'
                    ? true
                    : readBool('S3_FORCE_PATH_STYLE', false),
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
