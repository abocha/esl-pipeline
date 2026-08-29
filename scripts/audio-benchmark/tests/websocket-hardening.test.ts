import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { buildInworldConfig } from '../providers/inworld';
import {
  executeWebSocketRequest,
  inspectWavPcm,
  pacingTargetElapsedMs,
  validateTerminalUsage,
  type WebSocketFactory,
  type WebSocketLike,
} from '../websocket';

function finalMessage(text = 'done'): string {
  return JSON.stringify({
    result: { transcription: { transcript: text, isFinal: true, wordTimestamps: [] } },
  });
}

function usageMessage(
  value: unknown = { transcribedAudioMs: 10, modelId: 'inworld/inworld-stt-1' },
): string {
  return JSON.stringify({ result: { usage: value } });
}

function transportRequest(inputPath: string) {
  return {
    url: 'wss://example.test/stt',
    credentialEnv: 'INWORLD_API_KEY',
    config: buildInworldConfig({
      providerId: 'inworld-stt-1',
      runMode: 'mixed_diarized',
      inputPath,
      fileName: 'fixture.wav',
      sourceChannels: 1,
      preparedChannels: 1,
      sourceDurationMs: 10,
      preparedDurationMs: 10,
      options: {},
    }),
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
  onClose?: (listeners: Map<string, (...args: unknown[]) => void>) => void,
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
          onClose?.(listeners);
        },
      };
      queueMicrotask(() => listeners.get('open')?.());
      return socket;
    },
  };
}

describe('Inworld logical completion and cleanup', () => {
  test('disarms the logical deadline before cleanup and remains successful when physical close is absent', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-logical-deadline-'));
    const inputPath = path.join(root, 'fixture.wav');
    await writeFile(inputPath, makeWav(Buffer.from('0123456789')));
    const socket = scriptedSocket((frame, listeners) => {
      if (frame === JSON.stringify({ closeStream: {} })) {
        listeners.get('message')?.(finalMessage());
        listeners.get('message')?.(usageMessage());
      }
    });
    try {
      const result = await executeWebSocketRequest(
        {
          ...transportRequest(inputPath),
          physicalCloseGraceMs: 60,
          maxWaitMs: 20,
        },
        { INWORLD_API_KEY: 'test-only' },
        socket.factory,
      );

      expect(result.logicalCompletionElapsedMs).toBeDefined();
      expect(result.physicalCloseObserved).toBe(false);
      expect(result.cleanupGraceExhausted).toBe(true);
      expect(result.clientCloseRequested).toBe(true);
      expect(socket.closeCalls()).toBe(1);
      const offsets = result.events.map((event) => event.elapsedMs);
      expect(offsets).toEqual([...offsets].sort((left, right) => left - right));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('cannot settle twice when cleanup close races the cleanup timer', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-settle-once-'));
    const inputPath = path.join(root, 'fixture.wav');
    await writeFile(inputPath, makeWav(Buffer.from('0123456789')));
    const socket = scriptedSocket(
      (frame, listeners) => {
        if (frame === JSON.stringify({ closeStream: {} })) {
          listeners.get('message')?.(finalMessage());
          listeners.get('message')?.(usageMessage());
        }
      },
      (listeners) => setTimeout(() => listeners.get('close')?.(1000, ''), 2),
    );
    try {
      const result = await executeWebSocketRequest(
        { ...transportRequest(inputPath), physicalCloseGraceMs: 20, maxWaitMs: 50 },
        { INWORLD_API_KEY: 'test-only' },
        socket.factory,
      );
      expect(result.physicalCloseObserved).toBe(true);
      expect(result.events.filter((event) => event.kind === 'socket_close')).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each([
    ['empty object', {}],
    ['missing duration', { modelId: 'inworld/inworld-stt-1' }],
    ['negative duration', { transcribedAudioMs: -1, modelId: 'inworld/inworld-stt-1' }],
    ['non-finite duration', { transcribedAudioMs: Number.NaN, modelId: 'inworld/inworld-stt-1' }],
    ['wrong type', 'not-an-object'],
  ])('rejects %s as terminal usage', (_name, value) => {
    expect(() => validateTerminalUsage(value, 'inworld/inworld-stt-1')).toThrow();
  });

  test('does not accept usage before a valid final transcription', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-usage-order-'));
    const inputPath = path.join(root, 'fixture.wav');
    await writeFile(inputPath, makeWav(Buffer.from('0123456789')));
    const socket = scriptedSocket((frame, listeners) => {
      if (frame === JSON.stringify({ closeStream: {} })) listeners.get('message')?.(usageMessage());
    });
    try {
      await expect(
        executeWebSocketRequest(
          { ...transportRequest(inputPath), physicalCloseGraceMs: 5 },
          { INWORLD_API_KEY: 'test-only' },
          socket.factory,
        ),
      ).rejects.toMatchObject({
        outcome: 'uncertain',
        category: 'usage_before_final_transcription',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('does not accept a final received before closeStream as terminal completion', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-final-before-close-'));
    const inputPath = path.join(root, 'fixture.wav');
    await writeFile(inputPath, makeWav(Buffer.from('0123456789')));
    const socket = scriptedSocket((frame, listeners) => {
      if (frame === JSON.stringify({ endTurn: {} })) listeners.get('message')?.(finalMessage());
      if (frame === JSON.stringify({ closeStream: {} })) listeners.get('message')?.(usageMessage());
    });
    try {
      await expect(
        executeWebSocketRequest(
          { ...transportRequest(inputPath), physicalCloseGraceMs: 5 },
          { INWORLD_API_KEY: 'test-only' },
          socket.factory,
        ),
      ).rejects.toMatchObject({
        outcome: 'uncertain',
        category: 'usage_before_final_transcription',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('does not accept usage before closeStream', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-usage-before-close-'));
    const inputPath = path.join(root, 'fixture.wav');
    await writeFile(inputPath, makeWav(Buffer.from('0123456789')));
    const socket = scriptedSocket((frame, listeners) => {
      if (frame === JSON.stringify({ endTurn: {} })) {
        listeners.get('message')?.(finalMessage());
        listeners.get('message')?.(usageMessage());
      }
    });
    try {
      await expect(
        executeWebSocketRequest(
          { ...transportRequest(inputPath), physicalCloseGraceMs: 5 },
          { INWORLD_API_KEY: 'test-only' },
          socket.factory,
        ),
      ).rejects.toMatchObject({ outcome: 'uncertain', category: 'usage_before_close_stream' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('keeps duplicate usage after logical completion as post-completion evidence', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-duplicate-usage-'));
    const inputPath = path.join(root, 'fixture.wav');
    await writeFile(inputPath, makeWav(Buffer.from('0123456789')));
    const duplicate = usageMessage({ transcribedAudioMs: 10, modelId: 'inworld/inworld-stt-1' });
    const socket = scriptedSocket((frame, listeners) => {
      if (frame === JSON.stringify({ closeStream: {} })) {
        listeners.get('message')?.(finalMessage());
        listeners.get('message')?.(usageMessage());
        listeners.get('message')?.(duplicate);
      }
    });
    try {
      const result = await executeWebSocketRequest(
        transportRequest(inputPath),
        { INWORLD_API_KEY: 'test-only' },
        socket.factory,
      );
      expect(result.logicalResultMessages).toHaveLength(2);
      expect(result.postCompletionTransportMessages).toEqual([duplicate]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('freezes parsing at usage while preserving a post-completion provider error', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-post-completion-'));
    const inputPath = path.join(root, 'fixture.wav');
    await writeFile(inputPath, makeWav(Buffer.from('0123456789')));
    const error = JSON.stringify({ error: { message: 'late transport notice' } });
    const socket = scriptedSocket((frame, listeners) => {
      if (frame === JSON.stringify({ closeStream: {} })) {
        listeners.get('message')?.(finalMessage());
        listeners.get('message')?.(usageMessage());
        listeners.get('message')?.(error);
      }
    });
    try {
      const result = await executeWebSocketRequest(
        transportRequest(inputPath),
        { INWORLD_API_KEY: 'test-only' },
        socket.factory,
      );
      expect(result.logicalResultMessages).toEqual([finalMessage(), usageMessage()]);
      expect(result.postCompletionTransportMessages).toEqual([error]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('timeout cleanup evidence records client close and observed physical close', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-timeout-close-'));
    const inputPath = path.join(root, 'fixture.wav');
    await writeFile(inputPath, makeWav(Buffer.from('0123456789')));
    const socket = scriptedSocket(
      () => undefined,
      (listeners) => listeners.get('close')?.(1000, ''),
    );
    try {
      await expect(
        executeWebSocketRequest(
          { ...transportRequest(inputPath), maxWaitMs: 20, physicalCloseGraceMs: 20 },
          { INWORLD_API_KEY: 'test-only' },
          socket.factory,
        ),
      ).rejects.toMatchObject({
        outcome: 'uncertain',
        evidence: expect.objectContaining({
          clientCloseRequested: true,
          physicalCloseObserved: true,
          cleanupGraceExhausted: false,
        }),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('timeout cleanup evidence records an unobserved physical close after grace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-timeout-no-close-'));
    const inputPath = path.join(root, 'fixture.wav');
    await writeFile(inputPath, makeWav(Buffer.from('0123456789')));
    const socket = scriptedSocket(() => undefined);
    try {
      await expect(
        executeWebSocketRequest(
          { ...transportRequest(inputPath), maxWaitMs: 20, physicalCloseGraceMs: 5 },
          { INWORLD_API_KEY: 'test-only' },
          socket.factory,
        ),
      ).rejects.toMatchObject({
        outcome: 'uncertain',
        evidence: expect.objectContaining({
          clientCloseRequested: true,
          physicalCloseObserved: false,
          cleanupGraceExhausted: true,
        }),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('preserves a socket error during timeout cleanup', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-timeout-error-'));
    const inputPath = path.join(root, 'fixture.wav');
    await writeFile(inputPath, makeWav(Buffer.from('0123456789')));
    const socket = scriptedSocket(
      () => undefined,
      (listeners) => listeners.get('error')?.(new Error('cleanup error')),
    );
    try {
      await expect(
        executeWebSocketRequest(
          { ...transportRequest(inputPath), maxWaitMs: 20, physicalCloseGraceMs: 5 },
          { INWORLD_API_KEY: 'test-only' },
          socket.factory,
        ),
      ).rejects.toMatchObject({
        outcome: 'uncertain',
        evidence: expect.objectContaining({
          clientCloseRequested: true,
          events: expect.arrayContaining([
            expect.objectContaining({ kind: 'socket_error', errorMessage: 'cleanup error' }),
          ]),
        }),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('Inworld WAV validation and pacing math', () => {
  test('accepts a valid WAV with metadata before the data chunk', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-wav-list-'));
    try {
      const inputPath = path.join(root, 'fixture.wav');
      await writeFile(inputPath, makeChunkedWav(Buffer.from('0123456789'), { metadata: true }));
      await expect(inspectWavPcm(inputPath, 16_000, 1)).resolves.toMatchObject({ dataLength: 10 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects a malformed trailing chunk before opening the WebSocket', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-wav-trailing-invalid-'));
    try {
      const inputPath = path.join(root, 'fixture.wav');
      await writeFile(
        inputPath,
        appendMalformedTrailingChunk(makeChunkedWav(Buffer.from('01234567'))),
      );
      let factoryCalls = 0;
      await expect(
        executeWebSocketRequest(
          transportRequest(inputPath),
          { INWORLD_API_KEY: 'test-only' },
          () => {
            factoryCalls += 1;
            throw new Error('socket factory must not be called');
          },
        ),
      ).rejects.toThrow(/RIFF|boundary|chunk|extent/iu);
      expect(factoryCalls).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('retains the first data chunk when valid trailing metadata follows it', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-wav-trailing-valid-'));
    try {
      const inputPath = path.join(root, 'fixture.wav');
      await writeFile(
        inputPath,
        makeChunkedWav(Buffer.from('01234567'), { trailingMetadata: true }),
      );
      await expect(inspectWavPcm(inputPath, 16_000, 1)).resolves.toEqual({
        dataOffset: 44,
        dataLength: 8,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects a second data chunk', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-wav-second-data-'));
    try {
      const inputPath = path.join(root, 'fixture.wav');
      await writeFile(inputPath, makeChunkedWav(Buffer.from('01234567'), { secondData: true }));
      await expect(inspectWavPcm(inputPath, 16_000, 1)).rejects.toThrow(/more than one data/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('ignores physical bytes beyond the declared RIFF extent', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-wav-trailing-bytes-'));
    try {
      const inputPath = path.join(root, 'fixture.wav');
      const wav = makeChunkedWav(Buffer.from('01234567'));
      await writeFile(inputPath, Buffer.concat([wav, Buffer.from('outside-riFF')]));
      await expect(inspectWavPcm(inputPath, 16_000, 1)).resolves.toEqual({
        dataOffset: 44,
        dataLength: 8,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each([
    ['blockAlign', (wav: Buffer) => wav.writeUInt16LE(4, 32)],
    ['byteRate', (wav: Buffer) => wav.writeUInt32LE(1, 28)],
    ['RIFF shorter than data', (wav: Buffer) => wav.writeUInt32LE(36, 4)],
    ['RIFF beyond EOF', (wav: Buffer) => wav.writeUInt32LE(wav.length, 4)],
  ])('rejects %s', async (_name, mutate) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-wav-invalid-'));
    try {
      const inputPath = path.join(root, 'fixture.wav');
      const wav = makeChunkedWav(Buffer.from('0123456789'));
      mutate(wav);
      await writeFile(inputPath, wav);
      await expect(inspectWavPcm(inputPath, 16_000, 1)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects a chunk that crosses the declared RIFF boundary', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-wav-boundary-'));
    try {
      const inputPath = path.join(root, 'fixture.wav');
      const wav = makeChunkedWav(Buffer.from('0123456789'), { metadata: true });
      wav.writeUInt32LE(wav.readUInt32LE(4) - 2, 4);
      await writeFile(inputPath, wav);
      await expect(inspectWavPcm(inputPath, 16_000, 1)).rejects.toThrow(
        /RIFF|boundary|chunk|extent/iu,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('handles odd-sized chunk padding and keeps PCM frame alignment', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'inworld-wav-padding-'));
    try {
      const inputPath = path.join(root, 'fixture.wav');
      await writeFile(inputPath, makeChunkedWav(Buffer.from('01234567'), { metadata: true }));
      const parsed = await inspectWavPcm(inputPath, 16_000, 1);
      expect(parsed.dataLength % 2).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('uses monotonic deterministic pacing targets and records nondecreasing offsets', () => {
    expect(pacingTargetElapsedMs(32_000, 32_000, 1)).toBe(1_000);
    expect(pacingTargetElapsedMs(32_000, 32_000, 2)).toBe(500);
    expect(pacingTargetElapsedMs(16_000, 32_000, 1)).toBe(500);
    expect(pacingTargetElapsedMs(10, 32_000, 1)).toBeCloseTo(0.3125);
  });
});

function makeWav(pcm: Buffer): Buffer {
  return makeChunkedWav(pcm);
}

function makeChunkedWav(
  pcm: Buffer,
  options: { metadata?: boolean; trailingMetadata?: boolean; secondData?: boolean } = {},
): Buffer {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(16_000, 4);
  fmt.writeUInt32LE(32_000, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const chunks = [chunk('fmt ', fmt)];
  if (options.metadata) chunks.push(chunk('LIST', Buffer.from('odd')));
  chunks.push(chunk('data', pcm));
  if (options.secondData) chunks.push(chunk('data', pcm));
  if (options.trailingMetadata) chunks.push(chunk('LIST', Buffer.from('tail')));
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WAVE', 8, 'ascii');
  return Buffer.concat([header, body]);
}

function appendMalformedTrailingChunk(wav: Buffer): Buffer {
  const trailingHeader = Buffer.alloc(8);
  trailingHeader.write('LIST', 0, 'ascii');
  trailingHeader.writeUInt32LE(100, 4);
  const malformed = Buffer.concat([wav, trailingHeader]);
  malformed.writeUInt32LE(wav.readUInt32LE(4) + trailingHeader.length, 4);
  return malformed;
}

function chunk(id: string, data: Buffer): Buffer {
  const padding = data.length % 2;
  const result = Buffer.alloc(8 + data.length + padding);
  result.write(id, 0, 'ascii');
  result.writeUInt32LE(data.length, 4);
  data.copy(result, 8);
  return result;
}
