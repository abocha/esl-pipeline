import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfigPaths, createPipeline, loadEnvFiles } from '../src/pipeline.js';
import { RemoteConfigProvider } from '../src/adapters/config/remote.js';
import { S3ManifestStore } from '../src/adapters/manifest/s3.js';

const mockSend = vi.fn().mockResolvedValue({});

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = mockSend;
  },
  GetObjectCommand: vi.fn(),
  PutObjectCommand: vi.fn(),
}));

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.ESL_PIPELINE_CONFIG_PROVIDER;
  delete process.env.ESL_PIPELINE_CONFIG_ENDPOINT;
  delete process.env.ESL_PIPELINE_CONFIG_TOKEN;
  delete process.env.ESL_PIPELINE_MANIFEST_STORE;
  delete process.env.ESL_PIPELINE_MANIFEST_BUCKET;
  delete process.env.ESL_PIPELINE_MANIFEST_PREFIX;
  delete process.env.ESL_PIPELINE_MANIFEST_ROOT;
  mockSend.mockReset();
});

describe('pipeline helpers', () => {
  it('locates repository configs by default', () => {
    const paths = resolveConfigPaths();
    expect(existsSync(paths.presetsPath)).toBe(true);
    expect(existsSync(paths.voicesPath)).toBe(true);
  });

  it('falls back to bundled configs when working directory lacks configs', () => {
    const temp = mkdtempSync(join(tmpdir(), 'pipeline-config-'));
    tempDirs.push(temp);
    const pipeline = createPipeline({ cwd: temp });
    expect(existsSync(pipeline.defaults.presetsPath)).toBe(true);
    expect(existsSync(pipeline.defaults.voicesPath)).toBe(true);
  });

  it('selects remote config provider via environment variables', () => {
    process.env.ESL_PIPELINE_CONFIG_PROVIDER = 'http';
    process.env.ESL_PIPELINE_CONFIG_ENDPOINT = 'https://config.test/';
    const pipeline = createPipeline();
    expect(pipeline.configProvider).toBeInstanceOf(RemoteConfigProvider);
  });

  it('selects S3 manifest store via environment variables', () => {
    process.env.ESL_PIPELINE_MANIFEST_STORE = 's3';
    process.env.ESL_PIPELINE_MANIFEST_BUCKET = 'manifests-test';
    const pipeline = createPipeline({ cwd: process.cwd() });
    expect(pipeline.manifestStore).toBeInstanceOf(S3ManifestStore);
  });

  it('loads env files without mutating process env when disabled', () => {
    const temp = mkdtempSync(join(tmpdir(), 'env-load-'));
    tempDirs.push(temp);
    const envFile = join(temp, '.env');
    writeFileSync(envFile, 'FOO=bar\n');
    delete process.env.FOO;
    const result = loadEnvFiles({ cwd: temp, assignToProcess: false });
    expect(result.FOO).toBe('bar');
    expect(process.env.FOO).toBeUndefined();
  });
});
