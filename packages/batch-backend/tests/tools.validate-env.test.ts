import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { validateEnvironment } from '../src/tools/validate-env.js';

describe('environment validation', () => {
  const testDirs: string[] = [];

  afterEach(() => {
    for (const dir of testDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function writeFixture(contents: string, fileName = '.env'): string {
    const dir = join(
      tmpdir(),
      `env-validation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    testDirs.push(dir);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, fileName);
    writeFileSync(filePath, contents);
    return dir;
  }

  it('accepts a valid development environment without disabled provider credentials', () => {
    const cwd = writeFixture('NODE_ENV=development\nPG_ENABLED=false\nREDIS_ENABLED=false\n');

    expect(validateEnvironment({ cwd, profile: 'development', shellEnv: {} }).errors).toEqual([]);
  });

  it('accepts a valid production environment', () => {
    const cwd = writeFixture(
      [
        'NODE_ENV=production',
        'PG_ENABLED=true',
        'PG_HOST=postgres',
        'PG_USER=esl',
        'PG_PASSWORD=non-default-password',
        'PG_DATABASE=esl_batch',
        'REDIS_ENABLED=true',
        'REDIS_HOST=redis',
        'JWT_SECRET=non-default-jwt-secret',
        'REFRESH_COOKIE_SECURE=true',
      ].join('\n'),
    );

    expect(validateEnvironment({ cwd, profile: 'production', shellEnv: {} }).errors).toEqual([]);
  });

  it('reports duplicate keys without exposing their values', () => {
    const cwd = writeFixture('NODE_ENV=development\nNODE_ENV=production\n');

    expect(validateEnvironment({ cwd, profile: 'development', shellEnv: {} }).errors).toContain(
      'Duplicate key: NODE_ENV',
    );
  });

  it('reports unsupported backend configuration values', () => {
    const cwd = writeFixture('TRANSCRIBE_MODE=invalid\n');

    expect(validateEnvironment({ cwd, profile: 'development', shellEnv: {} }).errors).toContain(
      'TRANSCRIBE_MODE must be "timeline" or "stack"',
    );
  });

  it('requires an OpenAI credential when OpenAI Batch is enabled', () => {
    const cwd = writeFixture('STUDENT_MEMORY_OPENAI_BATCH_ENABLED=true\n');

    expect(validateEnvironment({ cwd, profile: 'development', shellEnv: {} }).errors).toContain(
      'STUDENT_MEMORY_OPENAI_BATCH_ENABLED=true requires OPENAI_API_KEY.',
    );
  });

  it('does not require an OpenAI credential when OpenAI Batch is disabled', () => {
    const cwd = writeFixture('STUDENT_MEMORY_OPENAI_BATCH_ENABLED=false\n');

    expect(validateEnvironment({ cwd, profile: 'development', shellEnv: {} }).errors).toEqual([]);
  });

  it.each([
    {
      provider: 'openai',
      credential: 'OPENAI_API_KEY=test-openai-key',
      missingCredentialError:
        'ESL_TTS_SPEECH_PLANNER_ENABLED=true with provider openai requires OPENAI_API_KEY.',
    },
    {
      provider: 'google_ai_studio',
      credential: 'GEMINI_API_KEY=test-gemini-key',
      missingCredentialError:
        'ESL_TTS_SPEECH_PLANNER_ENABLED=true with provider google_ai_studio requires GEMINI_API_KEY.',
    },
  ])(
    'requires only the selected $provider speech-planner credential',
    ({ provider, credential, missingCredentialError }) => {
      const enabled = [
        'ESL_TTS_SPEECH_PLANNER_ENABLED=true',
        `ESL_TTS_SPEECH_PLANNER_PROVIDER=${provider}`,
      ];
      const configuredCwd = writeFixture([...enabled, credential].join('\n'));
      const missingCwd = writeFixture(enabled.join('\n'));

      expect(
        validateEnvironment({ cwd: configuredCwd, profile: 'development', shellEnv: {} }).errors,
      ).toEqual([]);
      expect(
        validateEnvironment({ cwd: missingCwd, profile: 'development', shellEnv: {} }).errors,
      ).toContain(missingCredentialError);
    },
  );
});
