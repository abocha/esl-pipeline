import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  StorageConfigurationService,
  createStorageConfigService,
  resolveManifestStoreConfig,
} from '../src/index.js';

describe('storage utilities', () => {
  describe('StorageConfigurationService', () => {
    it('defaults to filesystem provider', () => {
      const service = new StorageConfigurationService();
      expect(service.getProvider()).toBe('filesystem');
      expect(service.isFilesystemProvider()).toBe(true);
      expect(service.isS3Provider()).toBe(false);
    });

    it('validates S3 configuration', () => {
      expect(() => {
        new StorageConfigurationService({
          provider: 's3',
          s3: {
            region: 'us-east-1',
            accessKeyId: '',
            secretAccessKey: '',
            bucket: '',
          },
        });
      }).toThrow('S3 configuration incomplete');
    });

    it('accepts valid S3 configuration', () => {
      const service = new StorageConfigurationService({
        provider: 's3',
        s3: {
          region: 'us-east-1',
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
          bucket: 'test-bucket',
        },
      });

      expect(service.getProvider()).toBe('s3');
      expect(service.isS3Provider()).toBe(true);
      expect(service.getS3Config().bucket).toBe('test-bucket');
    });

    it('resolves absolute filesystem paths', () => {
      const service = new StorageConfigurationService({
        filesystem: {
          uploadDir: '/absolute/path',
        },
      });

      expect(service.getFilesystemConfig().uploadDir).toBe('/absolute/path');
    });
  });

  describe('createStorageConfigService', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('creates filesystem provider by default', () => {
      const service = createStorageConfigService();
      expect(service.getProvider()).toBe('filesystem');
    });

    it('creates s3 provider when S3_BUCKET is set', () => {
      process.env.S3_BUCKET = 'test-bucket';
      process.env.AWS_ACCESS_KEY_ID = 'test-key';
      process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';

      const service = createStorageConfigService();
      expect(service.getProvider()).toBe('s3');
    });

    it('falls back to filesystem when S3 credentials are incomplete', () => {
      process.env.S3_BUCKET = 'test-bucket';
      process.env.AWS_ACCESS_KEY_ID = 'test-key';
      process.env.AWS_SECRET_ACCESS_KEY = '';
      process.env.S3_SECRET_ACCESS_KEY = '';

      const service = createStorageConfigService();
      expect(service.getProvider()).toBe('filesystem');
    });

    it('throws on unsupported STORAGE_PROVIDER', () => {
      process.env.STORAGE_PROVIDER = 'minio';

      expect(() => createStorageConfigService()).toThrow(
        'Invalid STORAGE_PROVIDER "minio": expected "s3" or "filesystem"',
      );
    });

    it('throws when STORAGE_PROVIDER is s3 but credentials are missing', () => {
      process.env.STORAGE_PROVIDER = 's3';
      process.env.S3_BUCKET = '';
      process.env.AWS_ACCESS_KEY_ID = '';
      process.env.AWS_SECRET_ACCESS_KEY = '';
      process.env.S3_SECRET_ACCESS_KEY = '';

      expect(() => createStorageConfigService()).toThrow('S3 configuration incomplete');
    });
  });

  describe('resolveManifestStoreConfig', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('defaults to filesystem', () => {
      const config = resolveManifestStoreConfig();
      expect(config.type).toBe('filesystem');
    });

    it('resolves S3 from environment', () => {
      process.env.ESL_PIPELINE_MANIFEST_STORE = 's3';
      process.env.ESL_PIPELINE_MANIFEST_BUCKET = 'test-bucket';

      const config = resolveManifestStoreConfig();
      expect(config.type).toBe('s3');
      expect(config.s3Options?.bucket).toBe('test-bucket');
    });

    it('throws when S3 is requested but bucket is missing', () => {
      process.env.ESL_PIPELINE_MANIFEST_STORE = 's3';

      expect(() => {
        resolveManifestStoreConfig();
      }).toThrow('ESL_PIPELINE_MANIFEST_BUCKET must be set');
    });

    it('accepts explicit options', () => {
      const config = resolveManifestStoreConfig({
        type: 's3',
        s3Options: {
          bucket: 'explicit-bucket',
          prefix: 'manifests',
        },
      });

      expect(config.type).toBe('s3');
      expect(config.s3Options?.bucket).toBe('explicit-bucket');
      expect(config.s3Options?.prefix).toBe('manifests');
    });
  });
});
