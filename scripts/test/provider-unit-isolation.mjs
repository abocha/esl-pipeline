import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('root Vitest package entrypoint rejects poisoned inherited credentials and env files', {
  timeout: 60000,
}, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'esl-sdk-poison-'));
  try {
    const credentials = path.join(directory, 'credentials');
    writeFileSync(
      path.join(directory, 'application_default_credentials.json'),
      JSON.stringify({
        type: 'authorized_user',
        client_id: 'dummy-client',
        client_secret: 'dummy-secret',
        refresh_token: 'dummy-token',
      }),
    );
    writeFileSync(
      credentials,
      '[default]\naws_access_key_id = dummy-profile\naws_secret_access_key = dummy-profile-secret\n',
    );
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, 'node_modules/vitest/vitest.mjs'),
        'run',
        '--config',
        path.join(root, 'vitest.config.ts'),
        '--maxWorkers=1',
        'packages/orchestrator/tests/provider-environment.test.ts',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 50000,
        env: {
          ...process.env,
          OPENAI_API_KEY: 'dummy-inherited-key',
          AWS_ACCESS_KEY_ID: 'dummy-inherited-aws',
          AWS_SECRET_ACCESS_KEY: 'dummy-inherited-secret',
          AWS_PROFILE: 'default',
          AWS_SHARED_CREDENTIALS_FILE: credentials,
          AWS_CONFIG_FILE: credentials,
          AWS_WEB_IDENTITY_TOKEN_FILE: credentials,
          AWS_CONTAINER_CREDENTIALS_FULL_URI: 'http://169.254.170.2/dummy',
          GOOGLE_APPLICATION_CREDENTIALS: credentials,
          CLOUDSDK_CONFIG: directory,
        },
      },
    );
    assert.equal(
      result.status,
      0,
      `${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(result.stdout, /5 passed/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
