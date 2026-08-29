import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

import { rederiveDirectRunArtifacts } from '../rederive';
import type { BenchmarkRun } from '../schema';

test('re-derives Deepgram evidence without changing raw response or attempts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'audio-benchmark-rederive-'));
  const runDirectory = path.join(root, 'runs', 'campaign-1', 'deepgram-1');
  const rawResponse = JSON.stringify({
    metadata: {
      duration: 1,
      channels: 1,
      models: ['model-uuid'],
      model_info: { 'model-uuid': { arch: 'nova-3' } },
    },
    results: {
      channels: [
        {
          alternatives: [
            {
              words: [{ word: 'hello', punctuated_word: 'Hello.', start: 0, end: 1 }],
            },
          ],
        },
      ],
    },
  });
  const run: BenchmarkRun = {
    schemaVersion: '1.0',
    runId: 'deepgram-1',
    campaignId: 'campaign-1',
    caseId: 'case-1',
    providerId: 'deepgram-nova-3',
    requestedModel: 'nova-3',
    requestMode: 'direct',
    runMode: 'mixed_diarized',
    sourceSha256: 'a'.repeat(64),
    sourceWallClockDurationMs: 1000,
    sourceChannels: 1,
    mediaIngest: { inputArtifact: 'prepared_artifact', originalSourceDirect: 'not_tested' },
    startedAt: '2026-08-29T00:00:00.000Z',
    attempts: [
      {
        attemptId: '001-transcribe',
        phase: 'transcribe',
        startedAt: '2026-08-29T00:00:00.000Z',
        outcome: 'succeeded',
        requestRisk: 'paid',
      },
    ],
    rawResponsePaths: ['raw/001-transcribe.response'],
    status: 'success',
  };

  try {
    await mkdir(path.join(runDirectory, 'raw'), { recursive: true });
    await writeFile(path.join(runDirectory, 'raw', '001-transcribe.response'), rawResponse);
    await writeFile(path.join(runDirectory, 'run.json'), `${JSON.stringify(run)}\n`);
    const beforeRaw = await readFile(
      path.join(runDirectory, 'raw', '001-transcribe.response'),
      'utf8',
    );

    const rederived = await rederiveDirectRunArtifacts({
      benchmarkRoot: root,
      runPath: 'runs/campaign-1/deepgram-1',
    });
    const afterRun = JSON.parse(await readFile(path.join(runDirectory, 'run.json'), 'utf8')) as {
      attempts: BenchmarkRun['attempts'];
      returnedModel?: string;
    };
    const comparable = JSON.parse(
      await readFile(path.join(runDirectory, 'comparable-segments.json'), 'utf8'),
    ) as { segments: Array<{ text: string }> };

    expect(await readFile(path.join(runDirectory, 'raw', '001-transcribe.response'), 'utf8')).toBe(
      beforeRaw,
    );
    expect(afterRun.attempts).toEqual(run.attempts);
    expect(rederived.returnedModel).toBe('nova-3');
    expect(afterRun.returnedModel).toBe('nova-3');
    expect(comparable.segments[0]?.text).toBe('Hello.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
