import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  addManifestCase,
  canonicalJson,
  computeManifestFingerprint,
  getBenchmarkRoot,
  resolveCaseInput,
  resolveUnderBenchmarkRoot,
  validateManifest,
} from '../manifest';
import type { BenchmarkManifest } from '../schema';

const manifest: BenchmarkManifest = {
  schemaVersion: '1.0',
  campaignId: 'campaign-1',
  runnerVersion: '1.0.0',
  createdAt: '2026-08-28T00:00:00.000Z',
  corpusHash: '',
  preparationVersion: 'downmix-mono-pcm-s16le-16k-v1',
  cases: [
    {
      caseId: 'lesson-1',
      topology: 'trusted_split_two_channel',
      tags: ['synthetic'],
      source: {
        relativePath: 'corpus/lesson-1/source.wav',
        sha256: 'a'.repeat(64),
        bytes: 12,
        wallClockDurationMs: 1000,
        channels: 2,
        sampleRateHz: 48000,
      },
      prepared: {
        relativePath: 'prepared/campaign-1/lesson-1/downmix-mono.wav',
        sha256: 'b'.repeat(64),
        bytes: 8,
        durationMs: 1000,
        channels: 1,
        sampleRateHz: 16000,
        preparationVersion: 'downmix-mono-pcm-s16le-16k-v1',
        kind: 'controlled_downmix_to_mono',
      },
    },
  ],
};

async function monoWav(filePath: string): Promise<void> {
  const dataBytes = 1600;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  await writeFile(filePath, Buffer.concat([header, Buffer.alloc(dataBytes)]));
}

describe('benchmark manifest fingerprints and paths', () => {
  test('fingerprint is key-order independent and excludes the stored corpus hash', () => {
    const reordered = { ...manifest, cases: [...manifest.cases].reverse() };
    const first = computeManifestFingerprint(manifest);
    const second = computeManifestFingerprint({ ...reordered, corpusHash: 'different' });

    expect(first).toBe(second);
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  test('rejects a persisted manifest whose corpus hash no longer matches', () => {
    expect(() => validateManifest({ ...manifest, corpusHash: 'd'.repeat(64) })).toThrow(
      /corpusHash/u,
    );
  });

  test('rejects absolute and escaping source paths', async () => {
    expect(() =>
      validateManifest({
        ...manifest,
        cases: [
          {
            ...manifest.cases[0]!,
            source: { ...manifest.cases[0]!.source, relativePath: '../outside.wav' },
          },
        ],
      }),
    ).toThrow(/relativePath/u);

    const root = await mkdtemp(path.join(os.tmpdir(), 'audio-benchmark-root-'));
    expect(() => resolveUnderBenchmarkRoot('C:\\private\\outside.wav', root)).toThrow(
      /inside ESL_AUDIO_BENCHMARK_ROOT/u,
    );
    await rm(root, { recursive: true, force: true });
  });

  test('selects the prepared artifact for mixed mode and the original for split control', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'audio-benchmark-root-'));
    const mixed = resolveCaseInput(manifest, 'lesson-1', 'mixed_diarized', root);
    const split = resolveCaseInput(manifest, 'lesson-1', 'trusted_split_control', root);

    expect(mixed.relativePath).toContain('prepared/');
    expect(mixed.channels).toBe(1);
    expect(split.relativePath).toBe('corpus/lesson-1/source.wav');
    expect(split.channels).toBe(2);
    await rm(root, { recursive: true, force: true });
  });

  test('rejects the repository and accepts an external benchmark root', async () => {
    const repositoryRoot = path.resolve(process.cwd());
    const externalRoot = await mkdtemp(path.join(os.tmpdir(), 'audio-benchmark-external-'));
    expect(() => getBenchmarkRoot({ ESL_AUDIO_BENCHMARK_ROOT: repositoryRoot })).toThrow(
      /outside|repository|checkout/iu,
    );
    expect(() =>
      getBenchmarkRoot({ ESL_AUDIO_BENCHMARK_ROOT: path.join(repositoryRoot, 'scripts') }),
    ).toThrow();
    expect(getBenchmarkRoot({ ESL_AUDIO_BENCHMARK_ROOT: externalRoot })).toBe(externalRoot);
    await rm(externalRoot, { recursive: true, force: true });
  });

  test('rejects a symlink targeting the repository when the platform permits symlinks', async () => {
    const externalRoot = await mkdtemp(path.join(os.tmpdir(), 'audio-benchmark-link-'));
    const linkPath = path.join(externalRoot, 'repo-link');
    try {
      await symlink(path.resolve(process.cwd()), linkPath, 'junction');
      expect(() => getBenchmarkRoot({ ESL_AUDIO_BENCHMARK_ROOT: linkPath })).toThrow();
    } catch (error: unknown) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code !== 'EPERM' && code !== 'EACCES') throw error;
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  });

  test('probes source media and refuses a mono file declared as trusted stereo', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'audio-benchmark-probe-'));
    const sourcePath = path.join(root, 'mono.wav');
    await monoWav(sourcePath);
    await expect(
      addManifestCase({
        benchmarkRoot: root,
        campaignId: 'campaign-probe',
        caseId: 'mono-as-stereo',
        sourcePath,
        topology: 'trusted_split_two_channel',
        wallClockDurationMs: 100,
        channels: 2,
      }),
    ).rejects.toThrow(/channel|probe/iu);
    await rm(root, { recursive: true, force: true });
  });
});
