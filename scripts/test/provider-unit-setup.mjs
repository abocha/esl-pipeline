import { devNull } from 'node:os';
import { afterAll, expect } from 'vitest';

import { buildPureTestEnv } from './pure-test-env.mjs';
import { blockExternalConnections } from './pure-test-network.mjs';

// All package unit/watch/prebuilt entrypoints share the root configuration. Keep integration
// classification unchanged, including ElevenLabs' un-suffixed integration.test.ts.
const testPath = expect.getState().testPath?.replaceAll('\\', '/') ?? '';
const affectedPackage =
  /\/packages\/(?:orchestrator|storage-uploader|provider-runtime|(?:stt|tts)-provider-[^/]+)\//u;
const integrationTest = /(?:^|\/|\.)integration\.test\.[cm]?[jt]sx?$/u;

if (affectedPackage.test(testPath) && !integrationTest.test(testPath)) {
  const pureEnv = buildPureTestEnv(process.env);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, pureEnv, {
    // Empty explicit sources prevent SDK fallback to user profiles, ADC and metadata credentials.
    AWS_SHARED_CREDENTIALS_FILE: devNull,
    AWS_CONFIG_FILE: devNull,
    AWS_EC2_METADATA_DISABLED: 'true',
    // The Google SDK honors CLOUDSDK_CONFIG for ADC discovery. Leave its explicit credential
    // variable absent so provider capability detection still sees an unconfigured adapter.
    CLOUDSDK_CONFIG: devNull,
  });
  afterAll(blockExternalConnections());
}
