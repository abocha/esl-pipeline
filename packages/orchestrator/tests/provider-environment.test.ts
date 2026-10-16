import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, get } from 'node:http';
import { connect } from 'node:net';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { afterAll, expect, it } from 'vitest';

import {
  loadApplicationEnv,
  loadCliEnv,
  loadEnvFiles,
  loadEnvFilesWithSummary,
} from '@esl-pipeline/shared-infrastructure';

// Assertions run during module initialization, before test hooks can scrub anything.
expect(process.env.VALIDATION_TEST_CLASS).toBe('pure');
for (const name of [
  'OPENAI_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_PROFILE',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'GOOGLE_APPLICATION_CREDENTIALS',
]) {
  expect(process.env[name], `${name} at import time`).toBeUndefined();
}

const fixtureDir = mkdtempSync(join(tmpdir(), 'esl-pure-provider-'));
writeFileSync(
  join(fixtureDir, '.env'),
  'OPENAI_API_KEY=dummy-file-key\nAWS_ACCESS_KEY_ID=dummy-file-aws\nESL_PURE_FILE_POISON=loaded\n',
);
afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

it('cannot rehydrate env files through application, CLI or mutating low-level loaders', () => {
  const options = { moduleUrl: import.meta.url, cwd: fixtureDir, override: true, memoize: true };
  for (const load of [loadApplicationEnv, loadCliEnv, loadEnvFilesWithSummary]) {
    expect(load(options).loadedFiles).toEqual([]);
  }
  expect(loadEnvFiles(options)).toEqual({});
  expect(process.env.OPENAI_API_KEY).toBeUndefined();
  expect(process.env.AWS_ACCESS_KEY_ID).toBeUndefined();
  expect(process.env.ESL_PURE_FILE_POISON).toBeUndefined();
});

it('disables SDK profile, ADC and metadata credential discovery', async () => {
  expect(process.env.AWS_CONFIG_FILE).toBe(devNull);
  expect(process.env.AWS_SHARED_CREDENTIALS_FILE).toBe(devNull);
  expect(process.env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
  expect(process.env.CLOUDSDK_CONFIG).toBe(devNull);
  expect(process.env.AWS_EC2_METADATA_DISABLED).toBe('true');
  const client = new S3Client({ region: 'us-east-1' });
  try {
    await expect(client.config.credentials()).rejects.toThrow(/Could not load credentials/u);
  } finally {
    client.destroy();
  }
  const google = new TextToSpeechClient({ projectId: 'dummy-project' });
  await expect(google.auth.getClient()).rejects.toThrow(/Could not load the default credentials/u);
  await google.close();
});

it('blocks an unmocked S3 request even with explicit dummy credentials', async () => {
  const client = new S3Client({
    region: 'us-east-1',
    endpoint: 'https://provider.invalid',
    credentials: { accessKeyId: 'dummy', secretAccessKey: 'dummy' },
    maxAttempts: 1,
  });
  try {
    await expect(
      client.send(new HeadObjectCommand({ Bucket: 'dummy', Key: 'dummy' })),
    ).rejects.toThrow(/External network access is disabled/u);
  } finally {
    client.destroy();
  }
});

it('blocks fetch and direct sockets before dispatch without revealing request secrets', async () => {
  await expect(fetch('https://provider.invalid/private?key=dummy')).rejects.toThrow(
    'External network access is disabled in provider/orchestrator unit tests',
  );
  expect(() => connect({ host: '169.254.169.254', port: 80 })).toThrow(
    /External network access is disabled/u,
  );
});

it('preserves intentional loopback HTTP servers for fetch and Node clients', async () => {
  const server = createServer((_req, res) => res.end('local fixture'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server');
    const url = `http://127.0.0.1:${address.port}`;
    expect(await (await fetch(url)).text()).toBe('local fixture');
    const body = await new Promise<string>((resolve, reject) => {
      get(url, (res) => {
        let text = '';
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => resolve(text));
      }).on('error', reject);
    });
    expect(body).toBe('local fixture');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
