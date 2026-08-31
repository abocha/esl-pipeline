import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { sha256File, writeJsonFile } from '../manifest';
import { buildDownmixPlan, prepareCase } from '../prepare';

describe('controlled downmix preparation', () => {
  test('builds a fixed mono 16 kHz PCM command without source cleanup', () => {
    const plan = buildDownmixPlan({
      inputPath: 'C:\\bench\\corpus\\lesson.wav',
      outputPath: 'C:\\bench\\prepared\\lesson.wav',
      sourceChannels: 2,
    });

    expect(plan.args).toEqual([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      'C:\\bench\\corpus\\lesson.wav',
      '-map_metadata',
      '-1',
      '-vn',
      '-af',
      'pan=mono|c0=0.5*c0+0.5*c1',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      'C:\\bench\\prepared\\lesson.wav',
    ]);
    expect(plan.preparationVersion).toBe('downmix-mono-pcm-s16le-16k-v1');
  });

  test('refuses to downmix a source that is not exactly two channel', () => {
    expect(() =>
      buildDownmixPlan({
        inputPath: 'source.wav',
        outputPath: 'prepared.wav',
        sourceChannels: 1,
      }),
    ).toThrow(/exactly two channels/u);
  });

  test('runs ffmpeg against the verified preparation snapshot after the source pathname changes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'audio-benchmark-prepare-snapshot-'));
    const sourcePath = path.join(root, 'source.wav');
    const outputPath = path.join(root, 'prepared.wav');
    const manifestPath = path.join(root, 'manifest.json');
    await writeWav(sourcePath, 2);
    const sourceHash = await sha256File(sourcePath);
    await writeJsonFile(manifestPath, {
      schemaVersion: '1.0',
      campaignId: 'campaign-prepare-snapshot',
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
            relativePath: 'source.wav',
            sha256: sourceHash,
            bytes: (await stat(sourcePath)).size,
            wallClockDurationMs: 100,
            channels: 2,
            sampleRateHz: 16000,
            container: 'wav',
            codec: 'pcm_s16le',
          },
        },
      ],
    });
    try {
      let ffmpegInput: string | undefined;
      let snapshotHashAtUse: string | undefined;
      const manifest = await prepareCase({
        manifestPath,
        caseId: 'lesson-1',
        benchmarkRoot: root,
        outputRelativePath: 'prepared.wav',
        execFileImpl: async (_command, args) => {
          ffmpegInput = args[args.indexOf('-i') + 1];
          await writeFile(sourcePath, 'replacement bytes', 'utf8');
          snapshotHashAtUse = await sha256File(ffmpegInput!);
          await writeWav(outputPath, 1);
          return { stdout: '', stderr: '' };
        },
      });

      expect(ffmpegInput).toContain('preparation-snapshot');
      expect(ffmpegInput).not.toBe(sourcePath);
      expect(snapshotHashAtUse).toBe(sourceHash);
      expect(manifest.cases[0]?.prepared?.inputSnapshot?.sha256).toBe(sourceHash);
      expect(await readFile(ffmpegInput!)).not.toEqual(Buffer.from('replacement bytes'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function writeWav(filePath: string, channels: number): Promise<void> {
  const dataBytes = 3200 * channels;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000 * channels, 28);
  header.writeUInt16LE(2 * channels, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  await writeFile(filePath, Buffer.concat([header, Buffer.alloc(dataBytes)]));
}
