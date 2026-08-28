import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { mergeBenchmarkEnvironment, parseBenchmarkEnv } from '../env';
import { buildDryRunPlan } from '../run';
import type { BenchmarkManifest } from '../schema';

const manifest: BenchmarkManifest = {
  schemaVersion: '1.0',
  campaignId: 'env-test',
  runnerVersion: '1.0.0',
  createdAt: '2026-08-28T00:00:00.000Z',
  corpusHash: '',
  preparationVersion: 'downmix-mono-pcm-s16le-16k-v1',
  cases: [
    {
      caseId: 'case-1',
      topology: 'mixed_recording',
      tags: [],
      source: {
        relativePath: 'source.wav',
        sha256: 'a'.repeat(64),
        bytes: 1,
        wallClockDurationMs: 60_000,
        channels: 1,
      },
      prepared: {
        relativePath: 'prepared.wav',
        sha256: 'b'.repeat(64),
        bytes: 1,
        durationMs: 60_000,
        channels: 1,
        sampleRateHz: 16_000,
        preparationVersion: 'downmix-mono-pcm-s16le-16k-v1',
        kind: 'controlled_downmix_to_mono',
      },
    },
  ],
};

describe('benchmark environment loading', () => {
  test('parses local env assignments and gives process values precedence', () => {
    expect(
      mergeBenchmarkEnvironment(
        'MISTRAL_API_KEY=file-secret\nESL_AUDIO_BENCHMARK_ROOT="D:/private/root"\n',
        {
          MISTRAL_API_KEY: 'process-secret',
          EXTRA_SETTING: 'process-value',
        },
      ),
    ).toEqual({
      MISTRAL_API_KEY: 'process-secret',
      ESL_AUDIO_BENCHMARK_ROOT: 'D:/private/root',
      EXTRA_SETTING: 'process-value',
    });
    expect(parseBenchmarkEnv('# comment\nEMPTY=\n')).toEqual({ EMPTY: '' });
  });

  test('does not expose credentials in dry-run or request evidence', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'audio-benchmark-env-'));
    const secret = 'mistral-secret-must-not-appear';
    try {
      const plan = buildDryRunPlan({
        manifest,
        caseId: 'case-1',
        providerId: 'mistral-voxtral-mini-transcribe-2',
        runMode: 'mixed_diarized',
        benchmarkRoot: root,
        environment: {
          ESL_AUDIO_BENCHMARK_ROOT: root,
          MISTRAL_API_KEY: secret,
        },
      });
      const evidence = JSON.stringify(plan);
      expect(plan.credentialConfigured).toBe(true);
      expect(evidence).not.toContain(secret);
      expect(evidence).not.toContain('Authorization');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
