import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { WebSocketServer } from 'ws';

import { sha256File, writeJsonFile } from '../manifest';
import { buildInworldConfig, inworldAdapter, parseInworldMessages } from '../providers/inworld';
import { runBenchmark } from '../run';
import type { BenchmarkManifest } from '../schema';
import {
  executeWebSocketRequest,
  inspectWavPcm,
  type WebSocketFactory,
  type WebSocketLike,
} from '../websocket';

function context() {
  return {
    providerId: 'inworld-stt-1' as const,
    runMode: 'mixed_diarized' as const,
    inputPath: 'C:\\bench\\prepared\\fixture.wav',
    fileName: 'fixture.wav',
    sourceChannels: 2,
    preparedChannels: 1,
    sourceDurationMs: 47_144,
    preparedDurationMs: 47_144,
    options: {},
    runId: 'inworld-gate0-1',
    selectedInputSha256: 'a'.repeat(64),
  };
}

describe('Inworld benchmark adapter', () => {
  test('builds the declared WebSocket config without a forced language or voice profile', () => {
    expect(buildInworldConfig(context())).toEqual({
      modelId: 'inworld/inworld-stt-1',
      audioEncoding: 'LINEAR16',
      sampleRateHertz: 16_000,
      numberOfChannels: 1,
      enableSpeakerDiarization: true,
      includeWordTimestamps: true,
    });
    expect(inworldAdapter.buildIntent(context())).toMatchObject({
      providerId: 'inworld-stt-1',
      requestMode: 'websocket',
      credentialEnv: 'INWORLD_API_KEY',
    });
    const intent = inworldAdapter.buildIntent(context());
    const config = intent.steps[0]?.body;
    expect(config?.kind === 'json' ? config.value.transcribeConfig : undefined).not.toHaveProperty(
      'language',
    );
    expect(JSON.stringify(intent)).not.toMatch(/voiceProfile|test-secret/iu);
  });

  test('parses final word timestamps, speakers, language, confidence, and usage', () => {
    const parsed = parseInworldMessages([
      JSON.stringify({
        result: {
          transcription: {
            transcript: 'Hello привет',
            isFinal: true,
            wordTimestamps: [
              {
                word: 'Hello',
                startTimeMs: 10,
                endTimeMs: 210,
                confidence: 0.91,
                speakerId: 'speaker_0',
                languageCode: 'en',
              },
              {
                word: 'привет',
                startTimeMs: 220,
                endTimeMs: 420,
                confidence: 0.87,
                speakerId: 'speaker_1',
                languageCode: 'ru',
              },
            ],
          },
        },
      }),
      JSON.stringify({
        result: {
          usage: { transcribedAudioMs: 47_144, modelId: 'inworld/inworld-stt-1' },
        },
      }),
    ]);

    expect(parsed.nativeSegments).toEqual([
      expect.objectContaining({
        index: 0,
        kind: 'word',
        text: 'Hello',
        startMs: 10,
        endMs: 210,
        speakerLabel: 'speaker_0',
        language: 'en',
        confidence: 0.91,
      }),
      expect.objectContaining({
        index: 1,
        text: 'привет',
        speakerLabel: 'speaker_1',
        language: 'ru',
      }),
    ]);
    expect(parsed.usage).toMatchObject({
      audioDurationSec: 47.144,
      source: 'provider',
      rawUsage: { transcribedAudioMs: 47_144, modelId: 'inworld/inworld-stt-1' },
    });
  });

  test('preserves unattributed words instead of inventing a speaker', () => {
    const parsed = parseInworldMessages([
      JSON.stringify({
        result: {
          transcription: {
            transcript: 'hello there',
            isFinal: true,
            wordTimestamps: [
              { word: 'hello', startTimeMs: 0, endTimeMs: 100 },
              { word: 'there', startTimeMs: 100, endTimeMs: 200, speakerId: 'speaker_2' },
            ],
          },
        },
      }),
    ]);

    expect(parsed.nativeSegments[0]).not.toHaveProperty('speakerLabel');
    expect(parsed.nativeSegments[1]?.speakerLabel).toBe('speaker_2');
  });

  test('preserves a final transcript when the provider returns no word timestamps', () => {
    const parsed = parseInworldMessages([
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
        result: { usage: { transcribedAudioMs: 1_000, modelId: 'inworld/inworld-stt-1' } },
      }),
    ]);

    expect(parsed.nativeSegments).toEqual([
      expect.objectContaining({
        index: 0,
        kind: 'turn',
        text: 'Алексей Морозов and time ten thirty.',
      }),
    ]);
    expect(parsed.nativeSegments[0]).not.toHaveProperty('speakerLabel');
  });

  test('rejects unknown or malformed successful event shapes instead of succeeding empty', () => {
    expect(() => parseInworldMessages([JSON.stringify({ result: {} })])).toThrow(
      /expected|transcription|shape/iu,
    );
    expect(() => parseInworldMessages([JSON.stringify({ result: { transcription: {} } })])).toThrow(
      /expected|transcription|shape/iu,
    );
    expect(() =>
      parseInworldMessages([JSON.stringify({ result: { transcription: { isFinal: true } } })]),
    ).toThrow(/expected|transcription|shape/iu);
    expect(() =>
      parseInworldMessages([
        JSON.stringify({
          result: {
            transcription: { transcript: 'done', isFinal: true, wordTimestamps: [] },
            unexpected: true,
          },
        }),
        JSON.stringify({ result: { usage: null } }),
      ]),
    ).toThrow(/usage|shape/iu);
  });
});

describe('Inworld bounded prerecorded WebSocket sender', () => {
  test('sends PCM payload as fast as callback flow control permits and records its exact hash', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-benchmark-'));
    try {
      const pcm = Buffer.from('pcm-payload-for-test');
      const wav = makeWav(pcm);
      const inputPath = path.join(root, 'fixture.wav');
      await writeFile(inputPath, wav);
      const frames: string[] = [];
      const listeners = new Map<string, (...args: unknown[]) => void>();
      const fakeSocket = {
        readyState: 1,
        on(event: string, listener: (...args: unknown[]) => void) {
          listeners.set(event, listener);
          return fakeSocket;
        },
        send(frame: string, callback?: (error?: Error) => void) {
          frames.push(frame);
          callback?.();
          if (frame === JSON.stringify({ closeStream: {} })) {
            listeners.get('message')?.(
              JSON.stringify({
                result: {
                  transcription: { transcript: 'done', isFinal: true, wordTimestamps: [] },
                },
              }),
            );
            listeners.get('message')?.(
              JSON.stringify({
                result: { usage: { transcribedAudioMs: 10, modelId: 'inworld/inworld-stt-1' } },
              }),
            );
            listeners.get('close')?.();
          }
        },
        close() {},
      };
      const result = await executeWebSocketRequest(
        {
          url: 'wss://example.test/stt',
          credentialEnv: 'INWORLD_API_KEY',
          config: buildInworldConfig(context()),
          filePath: inputPath,
          fileName: 'fixture.wav',
          chunkBytes: 4,
          sampleRateHz: 16_000,
          channels: 1,
          description: 'test',
          requestRisk: 'paid',
          pacing: 'unpaced',
          endOfAudioDelayMs: 0,
          quietPeriodBeforeCloseMs: 0,
          physicalCloseGraceMs: 10,
          maxWaitMs: 1_000,
        },
        { INWORLD_API_KEY: 'not-persisted' },
        () => {
          queueMicrotask(() => listeners.get('open')?.());
          return fakeSocket;
        },
      );

      const audioFrames = frames
        .map((frame) => JSON.parse(frame) as Record<string, unknown>)
        .filter((frame) => frame.audioChunk)
        .map((frame) => {
          const content = (frame.audioChunk as Record<string, unknown>).content;
          if (typeof content !== 'string') throw new Error('fake audio frame lacked content');
          return Buffer.from(content, 'base64');
        });
      expect(Buffer.concat(audioFrames)).toEqual(pcm);
      expect(result.outboundAudioBytes).toBe(pcm.length);
      expect(result.outboundAudioSha256).toBe(createHash('sha256').update(pcm).digest('hex'));
      expect(result.rawMessages).toHaveLength(2);
      expect(frames[0]).toBe(JSON.stringify({ transcribeConfig: buildInworldConfig(context()) }));
      expect(frames.at(-2)).toBe(JSON.stringify({ endTurn: {} }));
      expect(frames.at(-1)).toBe(JSON.stringify({ closeStream: {} }));
      expect(frames.join('\n')).not.toContain('not-persisted');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('treats usage after closeStream as logical completion when the physical socket stays open', async () => {
    const fixture = await makeTransportFixture();
    const { factory, frames, closeCalls } = scriptedSocket((frame, listeners) => {
      if (frame !== JSON.stringify({ closeStream: {} })) return;
      listeners.get('message')?.(
        JSON.stringify({
          result: {
            transcription: { transcript: 'done', isFinal: true, wordTimestamps: [] },
          },
        }),
      );
      listeners.get('message')?.(
        JSON.stringify({
          result: { usage: { transcribedAudioMs: 10, modelId: 'inworld/inworld-stt-1' } },
        }),
      );
    });
    try {
      const result = await executeWebSocketRequest(
        transportRequest(fixture.inputPath),
        { INWORLD_API_KEY: 'test-only' },
        factory,
      );

      expect(frames.at(-1)).toBe(JSON.stringify({ closeStream: {} }));
      expect(result.usageElapsedMs).toBeDefined();
      expect(result.logicalCompletionElapsedMs).toBe(result.usageElapsedMs);
      expect(result.physicalSocketBehavior).toBe('client_close_not_observed');
      expect(closeCalls()).toBe(1);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test('completes against a local WebSocket server that sends usage but never initiates close', async () => {
    const fixture = await makeTransportFixture();
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    let serverObservedClientClose = false;
    let resolveServerClose: (() => void) | undefined;
    const serverCloseObserved = new Promise<void>((resolve) => {
      resolveServerClose = resolve;
    });
    const receivedAudio: Buffer[] = [];
    server.on('connection', (serverSocket: unknown) => {
      const socket = serverSocket as {
        on(event: string, listener: (...args: unknown[]) => void): void;
        send(frame: string): void;
      };
      socket.on('message', (message: unknown) => {
        const frame = JSON.parse(messageToText(message)) as Record<string, unknown>;
        if (frame.audioChunk) {
          const content = (frame.audioChunk as Record<string, unknown>).content;
          if (typeof content === 'string') receivedAudio.push(Buffer.from(content, 'base64'));
        }
        if (frame.closeStream) {
          socket.send(
            JSON.stringify({
              result: {
                transcription: { transcript: 'done', isFinal: true, wordTimestamps: [] },
              },
            }),
          );
          socket.send(
            JSON.stringify({
              result: { usage: { transcribedAudioMs: 10, modelId: 'inworld/inworld-stt-1' } },
            }),
          );
        }
      });
      socket.on('close', () => {
        serverObservedClientClose = true;
        resolveServerClose?.();
      });
    });
    await new Promise<void>((resolve) => server.on('listening', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Local WebSocket server lacks port');
    try {
      const result = await executeWebSocketRequest(
        {
          ...transportRequest(fixture.inputPath),
          url: `ws://127.0.0.1:${address.port}`,
          physicalCloseGraceMs: 1_000,
        },
        { INWORLD_API_KEY: 'test-only' },
      );

      expect(Buffer.concat(receivedAudio)).toEqual(Buffer.from('0123456789'));
      expect(result.logicalCompletionElapsedMs).toBeDefined();
      expect(result.physicalSocketBehavior).toBe('client_closed_after_usage');
      await serverCloseObserved;
      expect(serverObservedClientClose).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error?: Error) => (error ? reject(error) : resolve())),
      );
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test('times out uncertain when closeStream is sent but usage never arrives', async () => {
    const fixture = await makeTransportFixture();
    const { factory } = scriptedSocket((frame, listeners) => {
      if (frame === JSON.stringify({ closeStream: {} })) {
        listeners.get('message')?.(
          JSON.stringify({
            result: {
              transcription: { transcript: 'done', isFinal: true, wordTimestamps: [] },
            },
          }),
        );
      }
    });
    try {
      await expect(
        executeWebSocketRequest(
          { ...transportRequest(fixture.inputPath), maxWaitMs: 25 },
          { INWORLD_API_KEY: 'test-only' },
          factory,
        ),
      ).rejects.toMatchObject({
        outcome: 'uncertain',
        category: 'stream_timeout',
        evidence: expect.objectContaining({
          closeStreamSentElapsedMs: expect.any(Number),
          outboundAudioBytes: 10,
        }),
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test('rejects usage received before the required closeStream signal', async () => {
    const fixture = await makeTransportFixture();
    const { factory } = scriptedSocket((frame, listeners) => {
      if (JSON.parse(frame).transcribeConfig) {
        listeners.get('message')?.(
          JSON.stringify({
            result: { usage: { transcribedAudioMs: 10, modelId: 'inworld/inworld-stt-1' } },
          }),
        );
      }
    });
    try {
      await expect(
        executeWebSocketRequest(
          transportRequest(fixture.inputPath),
          { INWORLD_API_KEY: 'test-only' },
          factory,
        ),
      ).rejects.toMatchObject({
        outcome: 'uncertain',
        category: 'usage_before_close_stream',
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test('fails uncertain on a socket error before usage but not after authoritative usage', async () => {
    const fixture = await makeTransportFixture();
    try {
      const beforeUsage = scriptedSocket((frame, listeners) => {
        if (frame === JSON.stringify({ closeStream: {} })) {
          listeners.get('error')?.(new Error('before usage'));
        }
      });
      await expect(
        executeWebSocketRequest(
          transportRequest(fixture.inputPath),
          { INWORLD_API_KEY: 'test-only' },
          beforeUsage.factory,
        ),
      ).rejects.toMatchObject({ outcome: 'uncertain', category: 'transport_uncertain' });

      const afterUsage = scriptedSocket((frame, listeners) => {
        if (frame !== JSON.stringify({ closeStream: {} })) return;
        listeners.get('message')?.(
          JSON.stringify({
            result: {
              transcription: { transcript: 'done', isFinal: true, wordTimestamps: [] },
            },
          }),
        );
        listeners.get('message')?.(
          JSON.stringify({
            result: { usage: { transcribedAudioMs: 10, modelId: 'inworld/inworld-stt-1' } },
          }),
        );
        listeners.get('error')?.(new Error('after usage'));
      });
      const result = await executeWebSocketRequest(
        transportRequest(fixture.inputPath),
        { INWORLD_API_KEY: 'test-only' },
        afterUsage.factory,
      );
      expect(result.logicalCompletionElapsedMs).toBeDefined();
      expect(result.events).toContainEqual(
        expect.objectContaining({ kind: 'socket_error', phase: 'after_logical_completion' }),
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test('rejects a WAV whose declared data chunk is truncated instead of silently sending less PCM', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-truncated-wav-'));
    try {
      const wav = makeWav(Buffer.from('0123456789'));
      wav.writeUInt32LE(20, 40);
      const inputPath = path.join(root, 'truncated.wav');
      await writeFile(inputPath, wav);
      await expect(inspectWavPcm(inputPath, 16_000, 1)).rejects.toThrow(/truncated|data chunk/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('records one successful physical stream and keeps raw/native/comparable layers separate', async () => {
    const fixture = await makeRunFixture();
    try {
      const run = await runBenchmark({
        manifestPath: fixture.manifestPath,
        caseId: 'lesson-1',
        providerId: 'inworld-stt-1',
        runMode: 'mixed_diarized',
        benchmarkRoot: fixture.root,
        runId: 'inworld-success',
        environment: { INWORLD_API_KEY: 'not-persisted' },
        webSocketFactory: makeSuccessfulSocket,
      });

      expect(run.status).toBe('success');
      expect(run.attempts).toHaveLength(1);
      expect(run.attempts[0]).toMatchObject({ method: 'WS', outcome: 'succeeded' });
      expect(run.nativeSegmentsPath).toBe('native-segments.json');
      expect(run.comparableSegmentsPath).toBe('comparable-segments.json');
      expect(run.providerMetadata).not.toHaveProperty('secret');
      expect(run.providerUsage?.rawUsage).toMatchObject({ transcribedAudioMs: 10 });
      const rawPath = path.join(
        fixture.root,
        'runs/campaign-run/inworld-success',
        'raw',
        '001-transcribe.events.json',
      );
      expect(JSON.parse(await readFile(rawPath, 'utf8'))).toMatchObject({
        schemaVersion: '1.0',
        summary: {
          outboundAudioBytes: 10,
          logicalCompletionElapsedMs: expect.any(Number),
        },
        events: expect.arrayContaining([
          expect.objectContaining({
            kind: 'config',
            direction: 'client',
            rawMessage: JSON.stringify({ transcribeConfig: buildInworldConfig(context()) }),
          }),
          expect.objectContaining({
            kind: 'close_stream',
            direction: 'client',
            rawMessage: JSON.stringify({ closeStream: {} }),
          }),
          expect.objectContaining({
            kind: 'server_message',
            rawMessage: expect.stringContaining('usage'),
          }),
        ]),
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test('marks a post-stream raw evidence persistence failure uncertain without resubmitting', async () => {
    const fixture = await makeRunFixture();
    const rawEvidencePath = path.join(
      fixture.root,
      'runs/campaign-run/inworld-persistence-failure/raw/001-transcribe.events.json',
    );
    await mkdir(rawEvidencePath, { recursive: true });
    let streamCount = 0;
    try {
      await expect(
        runBenchmark({
          manifestPath: fixture.manifestPath,
          caseId: 'lesson-1',
          providerId: 'inworld-stt-1',
          runMode: 'mixed_diarized',
          benchmarkRoot: fixture.root,
          runId: 'inworld-persistence-failure',
          environment: { INWORLD_API_KEY: 'not-persisted' },
          webSocketFactory: (...args) => {
            streamCount += 1;
            return makeSuccessfulSocket(...args);
          },
        }),
      ).rejects.toThrow(/^uncertain:/u);
      const run = JSON.parse(
        await readFile(
          path.join(fixture.root, 'runs/campaign-run/inworld-persistence-failure/run.json'),
          'utf8',
        ),
      ) as { status: string; attempts: Array<{ outcome: string }> };
      expect(run.status).toBe('uncertain');
      expect(run.attempts).toHaveLength(1);
      expect(run.attempts[0]?.outcome).toBe('uncertain');
      expect(streamCount).toBe(1);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

async function makeRunFixture(): Promise<{ root: string; manifestPath: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-run-'));
  const inputPath = path.join(root, 'fixture.wav');
  await writeFile(inputPath, makeWav(Buffer.from('0123456789')));
  const inputHash = await sha256File(inputPath);
  const manifest: BenchmarkManifest = {
    schemaVersion: '1.0',
    campaignId: 'campaign-run',
    runnerVersion: '1.0.0',
    createdAt: '2026-08-29T00:00:00.000Z',
    corpusHash: '',
    preparationVersion: 'downmix-mono-pcm-s16le-16k-v1',
    cases: [
      {
        caseId: 'lesson-1',
        topology: 'mixed_recording',
        tags: ['synthetic'],
        source: {
          relativePath: 'fixture.wav',
          sha256: inputHash,
          bytes: (await readFile(inputPath)).byteLength,
          wallClockDurationMs: 10,
          channels: 1,
          sampleRateHz: 16_000,
          container: 'wav',
          codec: 'pcm_s16le',
        },
        prepared: {
          relativePath: 'fixture.wav',
          sha256: inputHash,
          bytes: (await readFile(inputPath)).byteLength,
          durationMs: 10,
          channels: 1,
          sampleRateHz: 16_000,
          preparationVersion: 'downmix-mono-pcm-s16le-16k-v1',
          kind: 'controlled_downmix_to_mono',
        },
      },
    ],
  };
  const manifestPath = path.join(root, 'manifest.json');
  await writeJsonFile(manifestPath, manifest);
  return { root, manifestPath };
}

const makeSuccessfulSocket: WebSocketFactory = (..._args): WebSocketLike => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    readyState: 1,
    on(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, listener);
      return socket;
    },
    send(frame: string, callback?: (error?: Error) => void) {
      callback?.();
      if (frame === JSON.stringify({ closeStream: {} })) {
        listeners.get('message')?.(
          JSON.stringify({
            result: {
              transcription: {
                transcript: 'hello',
                isFinal: true,
                wordTimestamps: [
                  {
                    word: 'hello',
                    startTimeMs: 0,
                    endTimeMs: 10,
                    speakerId: 'speaker_0',
                    languageCode: 'en',
                    confidence: 0.9,
                  },
                ],
              },
            },
          }),
        );
        listeners.get('message')?.(
          JSON.stringify({
            result: { usage: { transcribedAudioMs: 10, modelId: 'inworld/inworld-stt-1' } },
          }),
        );
        listeners.get('close')?.();
      }
    },
    close() {},
  };
  queueMicrotask(() => listeners.get('open')?.());
  return socket;
};

function makeWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function makeTransportFixture(): Promise<{ root: string; inputPath: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-transport-'));
  const inputPath = path.join(root, 'fixture.wav');
  await writeFile(inputPath, makeWav(Buffer.from('0123456789')));
  return { root, inputPath };
}

function transportRequest(inputPath: string) {
  return {
    url: 'wss://example.test/stt',
    credentialEnv: 'INWORLD_API_KEY',
    config: buildInworldConfig(context()),
    filePath: inputPath,
    fileName: 'fixture.wav',
    chunkBytes: 4,
    sampleRateHz: 16_000,
    channels: 1,
    description: 'test',
    requestRisk: 'paid' as const,
    pacing: 'unpaced' as const,
    endOfAudioDelayMs: 0,
    quietPeriodBeforeCloseMs: 0,
    physicalCloseGraceMs: 5,
    maxWaitMs: 250,
  };
}

function scriptedSocket(
  onFrame: (frame: string, listeners: Map<string, (...args: unknown[]) => void>) => void,
): { factory: WebSocketFactory; frames: string[]; closeCalls: () => number } {
  const frames: string[] = [];
  let closes = 0;
  return {
    frames,
    closeCalls: () => closes,
    factory: () => {
      const listeners = new Map<string, (...args: unknown[]) => void>();
      const socket: WebSocketLike = {
        readyState: 1,
        on(event, listener) {
          listeners.set(event, listener);
          return socket;
        },
        send(frame, callback) {
          frames.push(frame);
          callback?.();
          onFrame(frame, listeners);
        },
        close() {
          closes += 1;
        },
      };
      queueMicrotask(() => listeners.get('open')?.());
      return socket;
    },
  };
}

function messageToText(message: unknown): string {
  if (typeof message === 'string') return message;
  if (Buffer.isBuffer(message)) return message.toString('utf8');
  if (message instanceof ArrayBuffer) return Buffer.from(message).toString('utf8');
  if (message instanceof Uint8Array) return Buffer.from(message).toString('utf8');
  return String(message);
}
