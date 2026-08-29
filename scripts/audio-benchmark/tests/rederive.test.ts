import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

import { rederiveDirectRunArtifacts, rederiveWebSocketRunArtifacts } from '../rederive';
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

test('supersedes a logically complete Inworld timeout without mutating the physical attempt record', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'audio-benchmark-inworld-rederive-'));
  const runDirectory = path.join(root, 'runs', 'campaign-1', 'inworld-timeout');
  const rawEvents = [
    JSON.stringify({
      result: {
        transcription: {
          transcript: 'Алексей Морозов and time ten thirty.',
          isFinal: true,
          wordTimestamps: [],
        },
      },
    }),
    JSON.stringify({
      result: { usage: { transcribedAudioMs: 44_850, modelId: 'inworld/inworld-stt-1' } },
    }),
  ];
  const rawEvidence = {
    schemaVersion: '1.0',
    logicalResultMessages: rawEvents,
    postCompletionTransportMessages: [],
    summary: {
      logicalResultMessages: rawEvents,
      postCompletionTransportMessages: [],
    },
    rawMessages: rawEvents,
    events: [
      {
        sequence: 0,
        elapsedMs: 1,
        direction: 'client',
        kind: 'close_stream',
        rawMessage: JSON.stringify({ closeStream: {} }),
      },
      {
        sequence: 1,
        elapsedMs: 2,
        direction: 'server',
        kind: 'server_message',
        phase: 'before_logical_completion',
        rawMessage: rawEvents[0],
      },
      {
        sequence: 2,
        elapsedMs: 3,
        direction: 'server',
        kind: 'server_message',
        phase: 'before_logical_completion',
        rawMessage: rawEvents[1],
      },
    ],
  };
  const run: BenchmarkRun = {
    schemaVersion: '1.0',
    runId: 'inworld-timeout',
    campaignId: 'campaign-1',
    caseId: 'case-1',
    providerId: 'inworld-stt-1',
    requestedModel: 'inworld/inworld-stt-1',
    requestMode: 'websocket',
    runMode: 'mixed_diarized',
    sourceSha256: 'a'.repeat(64),
    sourceWallClockDurationMs: 47_144,
    sourceChannels: 1,
    mediaIngest: { inputArtifact: 'prepared_artifact', originalSourceDirect: 'not_tested' },
    startedAt: '2026-08-29T00:00:00.000Z',
    attempts: [
      {
        attemptId: '001-transcribe',
        phase: 'transcribe',
        startedAt: '2026-08-29T00:00:00.000Z',
        outcome: 'uncertain',
        requestRisk: 'paid',
        responsePath: 'raw/001-transcribe.events.json',
        errorCategory: 'stream_timeout',
      },
    ],
    status: 'uncertain',
    errorCategory: 'stream_timeout',
  };

  try {
    await mkdir(path.join(runDirectory, 'raw'), { recursive: true });
    await writeFile(
      path.join(runDirectory, 'raw', '001-transcribe.events.json'),
      `${JSON.stringify(rawEvidence, null, 2)}\n`,
    );
    await writeFile(path.join(runDirectory, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
    const originalRunBytes = await readFile(path.join(runDirectory, 'run.json'));

    const result = await rederiveWebSocketRunArtifacts({
      benchmarkRoot: root,
      runPath: 'runs/campaign-1/inworld-timeout',
    });

    expect(await readFile(path.join(runDirectory, 'run.json'))).toEqual(originalRunBytes);
    expect(result.originalStatus).toBe('uncertain');
    expect(result.supersedingStatus).toBe('success');
    expect(result.physicalAttempts).toEqual(run.attempts);
    expect(result.basis).toMatchObject({ finalTranscriptionCount: 1, usageObserved: true });
    const derivedNative = JSON.parse(
      await readFile(path.join(runDirectory, 'rederived-native-segments.json'), 'utf8'),
    ) as { segments: Array<{ text: string }> };
    expect(derivedNative.segments[0]?.text).toBe('Алексей Морозов and time ten thirty.');
    expect(await readFile(path.join(runDirectory, 'rederived-run.json'), 'utf8')).toContain(
      'supersedingStatus',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('does not reclassify Inworld raw messages without structured outbound chronology', async () => {
  const fixture = await makeInworldReclassificationFixture([
    JSON.stringify({
      result: {
        transcription: { transcript: 'done', isFinal: true, wordTimestamps: [] },
      },
    }),
    JSON.stringify({
      result: { usage: { transcribedAudioMs: 10, modelId: 'inworld/inworld-stt-1' } },
    }),
  ]);
  try {
    const result = await rederiveWebSocketRunArtifacts(fixture.options);
    expect(result.supersedingStatus).toBe('uncertain');
    expect(result.interpretation).toBe('insufficient_evidence_for_reclassification');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('records insufficient evidence instead of throwing when structured logical events are malformed', async () => {
  const final = JSON.stringify({
    result: { transcription: { transcript: 'done', isFinal: true, wordTimestamps: [] } },
  });
  const malformedUsage = JSON.stringify({ result: { usage: {} } });
  const fixture = await makeInworldReclassificationFixture(
    [final, malformedUsage],
    [
      {
        sequence: 0,
        elapsedMs: 1,
        direction: 'client',
        kind: 'close_stream',
        rawMessage: JSON.stringify({ closeStream: {} }),
      },
      { sequence: 1, elapsedMs: 2, direction: 'server', kind: 'server_message', rawMessage: final },
      {
        sequence: 2,
        elapsedMs: 3,
        direction: 'server',
        kind: 'server_message',
        rawMessage: malformedUsage,
      },
    ],
  );
  try {
    const result = await rederiveWebSocketRunArtifacts(fixture.options);
    expect(result.supersedingStatus).toBe('uncertain');
    expect(result.interpretation).toBe('insufficient_evidence_for_reclassification');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test.each([
  [
    'missing closeStream',
    [
      { direction: 'server', kind: 'server_message', rawMessage: 'FINAL' },
      { direction: 'server', kind: 'server_message', rawMessage: 'USAGE' },
    ],
  ],
  [
    'closeStream after usage',
    [
      { direction: 'server', kind: 'server_message', rawMessage: 'FINAL' },
      { direction: 'server', kind: 'server_message', rawMessage: 'USAGE' },
      {
        direction: 'client',
        kind: 'close_stream',
        rawMessage: JSON.stringify({ closeStream: {} }),
      },
    ],
  ],
])('does not reclassify Inworld evidence with %s', async (_name, events) => {
  const final = JSON.stringify({
    result: { transcription: { transcript: 'done', isFinal: true, wordTimestamps: [] } },
  });
  const usage = JSON.stringify({
    result: { usage: { transcribedAudioMs: 10, modelId: 'inworld/inworld-stt-1' } },
  });
  const normalizedEvents = events.map((event, index) => ({
    sequence: index,
    elapsedMs: index + 1,
    ...event,
    ...(event.rawMessage === 'FINAL' ? { rawMessage: final } : {}),
    ...(event.rawMessage === 'USAGE' ? { rawMessage: usage } : {}),
  }));
  const fixture = await makeInworldReclassificationFixture([final, usage], normalizedEvents);
  try {
    const result = await rederiveWebSocketRunArtifacts(fixture.options);
    expect(result.supersedingStatus).toBe('uncertain');
    expect(result.interpretation).toBe('insufficient_evidence_for_reclassification');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function makeInworldReclassificationFixture(
  rawMessages: string[],
  events?: Array<Record<string, unknown>>,
): Promise<{
  root: string;
  options: { benchmarkRoot: string; runPath: string };
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'audio-benchmark-inworld-rederive-case-'));
  const runDirectory = path.join(root, 'runs', 'campaign-1', 'inworld-case');
  const run: BenchmarkRun = {
    schemaVersion: '1.0',
    runId: 'inworld-case',
    campaignId: 'campaign-1',
    caseId: 'case-1',
    providerId: 'inworld-stt-1',
    requestedModel: 'inworld/inworld-stt-1',
    requestMode: 'websocket',
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
        outcome: 'uncertain',
        requestRisk: 'paid',
        responsePath: 'raw/001-transcribe.events.json',
      },
    ],
    status: 'uncertain',
  };
  await mkdir(path.join(runDirectory, 'raw'), { recursive: true });
  await writeFile(path.join(runDirectory, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
  await writeFile(
    path.join(runDirectory, 'raw', '001-transcribe.events.json'),
    `${JSON.stringify(
      events === undefined
        ? rawMessages
        : {
            schemaVersion: '1.0',
            logicalResultMessages: rawMessages,
            postCompletionTransportMessages: [],
            summary: { logicalResultMessages: rawMessages, postCompletionTransportMessages: [] },
            rawMessages,
            events,
          },
      null,
      2,
    )}\n`,
  );
  return { root, options: { benchmarkRoot: root, runPath: 'runs/campaign-1/inworld-case' } };
}
