import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

import { sha256File, writeJsonFile } from '../manifest';
import { buildDryRunPlan, runBenchmark } from '../run';
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
      tags: [],
      source: {
        relativePath: 'corpus/source.wav',
        sha256: 'a'.repeat(64),
        bytes: 10,
        wallClockDurationMs: 60_000,
        channels: 2,
      },
      prepared: {
        relativePath: 'prepared/lesson.wav',
        sha256: 'b'.repeat(64),
        bytes: 8,
        durationMs: 60_000,
        channels: 1,
        sampleRateHz: 16000,
        preparationVersion: 'downmix-mono-pcm-s16le-16k-v1',
        kind: 'controlled_downmix_to_mono',
      },
    },
  ],
};

describe('benchmark dry-run', () => {
  test('describes intent and output paths without invoking network transport', async () => {
    const root = await (await import('node:fs/promises')).mkdtemp(
      path.join(os.tmpdir(), 'audio-benchmark-dry-run-'),
    );
    const plan = buildDryRunPlan({
      manifest,
      caseId: 'lesson-1',
      providerId: 'deepgram-nova-3',
      runMode: 'mixed_diarized',
      benchmarkRoot: root,
    });

    expect(plan.networkRequests).toBe(0);
    expect(plan.providerId).toBe('deepgram-nova-3');
    expect(plan.input.sha256).toBe('b'.repeat(64));
    expect(plan.outputPaths.runDirectory).toContain('runs\\campaign-1');
    expect(plan.requestIntent.steps[0]?.method).toBe('POST');
    expect(plan.requestIntent.steps[0]?.headers ?? {}).not.toHaveProperty('Authorization');
    await rm(root, { recursive: true, force: true });
  });
});

async function makeRunFixture(): Promise<{ root: string; manifestPath: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'audio-benchmark-run-'));
  await writeFile(path.join(root, 'prepared.wav'), 'synthetic prepared bytes');
  const preparedHash = await sha256File(path.join(root, 'prepared.wav'));
  const manifestPath = path.join(root, 'manifest.json');
  await writeJsonFile(manifestPath, {
    schemaVersion: '1.0',
    campaignId: 'campaign-run',
    runnerVersion: '1.0.0',
    createdAt: '2026-08-28T00:00:00.000Z',
    corpusHash: '',
    preparationVersion: 'downmix-mono-pcm-s16le-16k-v1',
    cases: [
      {
        caseId: 'lesson-1',
        topology: 'mixed_recording',
        tags: ['synthetic'],
        source: {
          relativePath: 'prepared.wav',
          sha256: preparedHash,
          bytes: 'synthetic prepared bytes'.length,
          wallClockDurationMs: 1000,
          channels: 1,
        },
        prepared: {
          relativePath: 'prepared.wav',
          sha256: preparedHash,
          bytes: 'synthetic prepared bytes'.length,
          durationMs: 1000,
          channels: 1,
          sampleRateHz: 16000,
          preparationVersion: 'downmix-mono-pcm-s16le-16k-v1',
          kind: 'controlled_downmix_to_mono',
        },
      },
    ],
  });
  return { root, manifestPath };
}

async function writeMonoWav(filePath: string): Promise<void> {
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

describe('benchmark request lifecycle safety', () => {
  test('re-probes the selected source and rejects actual mono media in split control', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'audio-benchmark-split-probe-'));
    const sourcePath = path.join(root, 'source.wav');
    await writeMonoWav(sourcePath);
    const sourceHash = await sha256File(sourcePath);
    const manifestPath = path.join(root, 'manifest.json');
    await writeJsonFile(manifestPath, {
      schemaVersion: '1.0',
      campaignId: 'campaign-split-probe',
      runnerVersion: '1.0.0',
      createdAt: '2026-08-28T00:00:00.000Z',
      corpusHash: '',
      preparationVersion: 'downmix-mono-pcm-s16le-16k-v1',
      cases: [
        {
          caseId: 'mono-claimed-stereo',
          topology: 'trusted_split_two_channel',
          tags: [],
          source: {
            relativePath: 'source.wav',
            sha256: sourceHash,
            bytes: (await readFile(sourcePath)).byteLength,
            wallClockDurationMs: 1000,
            channels: 2,
          },
        },
      ],
    });
    try {
      await expect(
        runBenchmark({
          manifestPath,
          caseId: 'mono-claimed-stereo',
          providerId: 'deepgram-nova-3',
          runMode: 'trusted_split_control',
          benchmarkRoot: root,
          environment: { DEEPGRAM_API_KEY: 'test-secret' },
          fetchImpl: vi.fn<typeof fetch>(),
        }),
      ).rejects.toThrow(/exactly two observed source channels|ffprobe/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('records a paid POST 5xx as uncertain and never resubmits', async () => {
    const fixture = await makeRunFixture();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"error":"temporary"}', { status: 503 }));
    try {
      await expect(
        runBenchmark({
          manifestPath: fixture.manifestPath,
          caseId: 'lesson-1',
          providerId: 'mistral-voxtral-mini-transcribe-2',
          runMode: 'mixed_diarized',
          benchmarkRoot: fixture.root,
          runId: 'paid-5xx',
          environment: { MISTRAL_API_KEY: 'test-secret' },
          fetchImpl,
        }),
      ).rejects.toThrow(/^uncertain:/u);
      const run = JSON.parse(
        await readFile(path.join(fixture.root, 'runs/campaign-run/paid-5xx/run.json'), 'utf8'),
      ) as { status: string; attempts: Array<{ outcome: string }> };
      expect(run.status).toBe('uncertain');
      expect(run.attempts).toHaveLength(1);
      expect(run.attempts[0]?.outcome).toBe('uncertain');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test('keeps a paid POST uncertain when reading the successful response body fails', async () => {
    const fixture = await makeRunFixture();
    const response = {
      status: 200,
      text: vi.fn().mockRejectedValue(new Error('response body stream failed')),
    } as unknown as Response;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    try {
      await expect(
        runBenchmark({
          manifestPath: fixture.manifestPath,
          caseId: 'lesson-1',
          providerId: 'mistral-voxtral-mini-transcribe-2',
          runMode: 'mixed_diarized',
          benchmarkRoot: fixture.root,
          runId: 'body-read-failure',
          environment: { MISTRAL_API_KEY: 'test-secret' },
          fetchImpl,
        }),
      ).rejects.toThrow(/^uncertain:/u);
      const run = JSON.parse(
        await readFile(
          path.join(fixture.root, 'runs/campaign-run/body-read-failure/run.json'),
          'utf8',
        ),
      ) as { status: string; attempts: Array<{ outcome: string }> };
      expect(run.status).toBe('uncertain');
      expect(run.attempts).toHaveLength(1);
      expect(run.attempts[0]?.outcome).toBe('uncertain');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test('keeps a paid POST uncertain when raw response persistence fails', async () => {
    const fixture = await makeRunFixture();
    const runDirectory = path.join(fixture.root, 'runs', 'campaign-run', 'raw-write-failure');
    await mkdir(path.join(runDirectory, 'raw', '001-transcribe.response'), { recursive: true });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"segments":[{"start":0,"end":1,"text":"hello"}]}'));
    try {
      await expect(
        runBenchmark({
          manifestPath: fixture.manifestPath,
          caseId: 'lesson-1',
          providerId: 'mistral-voxtral-mini-transcribe-2',
          runMode: 'mixed_diarized',
          benchmarkRoot: fixture.root,
          runId: 'raw-write-failure',
          environment: { MISTRAL_API_KEY: 'test-secret' },
          fetchImpl,
        }),
      ).rejects.toThrow(/^uncertain:/u);
      const run = JSON.parse(await readFile(path.join(runDirectory, 'run.json'), 'utf8')) as {
        status: string;
        attempts: Array<{ outcome: string }>;
      };
      expect(run.status).toBe('uncertain');
      expect(run.attempts).toHaveLength(1);
      expect(run.attempts[0]?.outcome).toBe('uncertain');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test('treats an unparseable successful Soniox submission as uncertain with its file id', async () => {
    const fixture = await makeRunFixture();
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl
      .mockResolvedValueOnce(new Response('{"id":"file-1"}', { status: 201 }))
      .mockResolvedValueOnce(new Response('{}', { status: 201 }));
    try {
      await expect(
        runBenchmark({
          manifestPath: fixture.manifestPath,
          caseId: 'lesson-1',
          providerId: 'soniox-v5-async',
          runMode: 'mixed_diarized',
          benchmarkRoot: fixture.root,
          runId: 'malformed-submit',
          environment: { SONIOX_API_KEY: 'test-secret' },
          fetchImpl,
        }),
      ).rejects.toThrow(/^uncertain:/u);
      const run = JSON.parse(
        await readFile(
          path.join(fixture.root, 'runs/campaign-run/malformed-submit/run.json'),
          'utf8',
        ),
      ) as {
        status: string;
        attempts: Array<{ outcome: string }>;
        externalReferences?: Array<{ kind: string; id: string }>;
      };
      expect(run.status).toBe('uncertain');
      expect(run.attempts.map((attempt) => attempt.outcome)).toEqual(['succeeded', 'succeeded']);
      expect(run.externalReferences).toContainEqual({ kind: 'file', id: 'file-1' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test('does not turn an unknown successful transcript shape into a successful run', async () => {
    const fixture = await makeRunFixture();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    try {
      await expect(
        runBenchmark({
          manifestPath: fixture.manifestPath,
          caseId: 'lesson-1',
          providerId: 'mistral-voxtral-mini-transcribe-2',
          runMode: 'mixed_diarized',
          benchmarkRoot: fixture.root,
          runId: 'unknown-shape',
          environment: { MISTRAL_API_KEY: 'test-secret' },
          fetchImpl,
        }),
      ).rejects.toThrow(/^(failed|uncertain):/u);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
