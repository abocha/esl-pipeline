import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';

import type {
  ProviderStreamEvent,
  ProviderStreamEvidence,
  ProviderStreamRequest,
  ProviderStreamResponse,
} from './providers/types';

export type WebSocketMessage = string | Buffer | ArrayBuffer | Uint8Array;

export type WebSocketLike = {
  readyState: number;
  on(event: string, listener: (...args: unknown[]) => void): WebSocketLike;
  send(data: string, callback?: (error?: Error) => void): void;
  close(): void;
};

export type WebSocketFactory = (
  url: string,
  options: { headers: Record<string, string> },
) => WebSocketLike;

export class BenchmarkWebSocketError extends Error {
  constructor(
    message: string,
    readonly outcome: 'failed' | 'uncertain',
    readonly category: string,
    readonly evidence: ProviderStreamEvidence,
  ) {
    super(message);
    this.name = 'BenchmarkWebSocketError';
  }

  get rawMessages(): string[] {
    return this.evidence.rawMessages;
  }

  get providerSideWork(): boolean {
    return this.evidence.providerSideWork;
  }
}

const OPEN = 1;
const defaultFactory: WebSocketFactory = (url, options) => new WebSocket(url, options);

export async function executeWebSocketRequest(
  request: ProviderStreamRequest,
  environment: NodeJS.ProcessEnv = process.env,
  factory: WebSocketFactory = defaultFactory,
): Promise<ProviderStreamResponse> {
  const credential = environment[request.credentialEnv];
  if (!credential) {
    throw new BenchmarkWebSocketError(
      `Missing credential ${request.credentialEnv}.`,
      'failed',
      'missing_credential',
      emptyEvidence(),
    );
  }
  validateStreamRequest(request);
  const pcm = await inspectWavPcm(request.filePath, request.sampleRateHz, request.channels);
  const blockAlign = request.channels * 2;
  if (pcm.dataLength % blockAlign !== 0) {
    throw new Error('Inworld streaming WAV data length is not aligned to complete PCM frames.');
  }
  if (request.chunkBytes % blockAlign !== 0) {
    throw new Error('Inworld streaming chunk size is not aligned to complete PCM frames.');
  }

  const startedAt = performance.now();
  const rawMessages: string[] = [];
  const events: ProviderStreamEvent[] = [];

  return new Promise<ProviderStreamResponse>((resolve, reject) => {
    let socket: WebSocketLike;
    let opened = false;
    let providerSideWork = false;
    let audioStartedElapsedMs: number | undefined;
    let audioFinishedElapsedMs: number | undefined;
    let endTurnSentElapsedMs: number | undefined;
    let closeStreamSentElapsedMs: number | undefined;
    let finalResultElapsedMs: number | undefined;
    let usageElapsedMs: number | undefined;
    let logicalCompletionElapsedMs: number | undefined;
    let physicalCloseElapsedMs: number | undefined;
    let physicalSocketBehavior: ProviderStreamEvidence['physicalSocketBehavior'] =
      'not_closed_before_failure';
    let audioBytes = 0;
    let outboundAudioChunkCount = 0;
    const audioHash = createHash('sha256');
    let settled = false;
    let logicalComplete = false;
    let clientCloseRequested = false;
    let physicalCloseObserved = false;
    let cleanupGraceExhausted = false;
    let logicalResultMessageCount: number | undefined;
    let finalTranscriptionAfterCloseStreamObserved = false;
    let pendingFailure:
      | { outcome: 'failed' | 'uncertain'; category: string; message: string }
      | undefined;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let closeGraceTimer: ReturnType<typeof setTimeout> | undefined;
    let logicalDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let lastRecordedElapsedMs = 0;

    const elapsed = () => Math.max(0, performance.now() - startedAt);
    const record = (event: Omit<ProviderStreamEvent, 'sequence' | 'elapsedMs'>) => {
      const eventElapsedMs = Math.max(lastRecordedElapsedMs, elapsed());
      lastRecordedElapsedMs = eventElapsedMs;
      events.push({ sequence: events.length, elapsedMs: eventElapsedMs, ...event });
    };
    const evidence = (): ProviderStreamEvidence => {
      const logicalResultMessages =
        logicalResultMessageCount === undefined
          ? []
          : rawMessages.slice(0, logicalResultMessageCount);
      return {
        rawMessages: [...rawMessages],
        logicalResultMessages,
        postCompletionTransportMessages:
          logicalResultMessageCount === undefined
            ? []
            : rawMessages.slice(logicalResultMessageCount),
        events: events.map((event) => ({ ...event })),
        outboundAudioBytes: audioBytes,
        outboundAudioSha256: audioHash.copy().digest('hex'),
        outboundAudioChunkCount,
        sendElapsedMs:
          audioStartedElapsedMs === undefined || audioFinishedElapsedMs === undefined
            ? 0
            : audioFinishedElapsedMs - audioStartedElapsedMs,
        audioStartedElapsedMs,
        audioFinishedElapsedMs,
        endTurnSentElapsedMs,
        closeStreamSentElapsedMs,
        finalResultElapsedMs,
        usageElapsedMs,
        logicalCompletionElapsedMs,
        physicalSocketBehavior,
        clientCloseRequested,
        physicalCloseObserved,
        cleanupGraceExhausted,
        physicalCloseElapsedMs,
        totalElapsedMs: elapsed(),
        providerSideWork,
      };
    };
    const finish = (error?: BenchmarkWebSocketError) => {
      if (settled) return;
      settled = true;
      if (logicalDeadlineTimer) clearTimeout(logicalDeadlineTimer);
      if (quietTimer) clearTimeout(quietTimer);
      if (closeGraceTimer) clearTimeout(closeGraceTimer);
      if (error) reject(error);
      else resolve(evidence());
    };
    const finishPendingFailure = () => {
      if (!pendingFailure || settled) return;
      finish(
        new BenchmarkWebSocketError(
          pendingFailure.message,
          pendingFailure.outcome,
          pendingFailure.category,
          evidence(),
        ),
      );
    };
    const beginCleanup = () => {
      if (settled || clientCloseRequested) return;
      clientCloseRequested = true;
      record({
        direction: 'client',
        kind: 'client_close',
        phase: logicalComplete ? 'after_logical_completion' : 'before_logical_completion',
      });
      try {
        socket?.close();
      } catch (error: unknown) {
        record({
          direction: 'transport',
          kind: 'socket_error',
          phase: logicalComplete ? 'after_logical_completion' : 'before_logical_completion',
          errorMessage: errorMessage(error),
        });
      }
      if (settled) return;
      closeGraceTimer = setTimeout(() => {
        cleanupGraceExhausted = physicalCloseObserved === false;
        if (!physicalCloseObserved) physicalSocketBehavior = 'client_close_not_observed';
        if (logicalComplete) finish();
        else finishPendingFailure();
      }, request.physicalCloseGraceMs);
    };
    const fail = (category: string, message: string) => {
      if (settled || logicalComplete || pendingFailure) return;
      if (logicalDeadlineTimer) clearTimeout(logicalDeadlineTimer);
      const outcome = providerSideWork || opened ? 'uncertain' : 'failed';
      pendingFailure = { outcome, category, message };
      if (!opened || physicalCloseObserved) finishPendingFailure();
      else beginCleanup();
    };
    logicalDeadlineTimer = setTimeout(() => {
      fail(
        'stream_timeout',
        'Inworld WebSocket stream exceeded the bounded wait before authoritative usage; the harness failed closed and will not resubmit.',
      );
    }, request.maxWaitMs);

    try {
      socket = factory(request.url, {
        headers: { Authorization: `Basic ${credential}` },
      });
    } catch (error: unknown) {
      fail(
        'connect_failed',
        `Inworld WebSocket connection could not be opened: ${errorMessage(error)}`,
      );
      return;
    }

    socket.on('open', () => {
      opened = true;
      record({ direction: 'transport', kind: 'socket_open' });
      void sendAudio();
    });
    socket.on('message', (message: unknown) => {
      const raw = messageToString(message);
      rawMessages.push(raw);
      record({
        direction: 'server',
        kind: 'server_message',
        phase: logicalComplete ? 'after_logical_completion' : 'before_logical_completion',
        rawMessage: raw,
      });
      const finalEvent = classifyFinalTranscriptionMessage(raw);
      if (finalEvent === 'invalid' && !logicalComplete) {
        fail(
          'final_transcription_invalid',
          'Inworld WebSocket returned a malformed final transcription; the harness failed closed.',
        );
        return;
      }
      if (finalEvent === 'valid') {
        if (closeStreamSentElapsedMs !== undefined) {
          finalTranscriptionAfterCloseStreamObserved = true;
        }
        if (finalResultElapsedMs === undefined) finalResultElapsedMs = elapsed();
      }
      const usageEvent = classifyUsageMessage(raw, request.config.modelId);
      if (usageEvent === 'invalid' && !logicalComplete) {
        fail(
          'usage_event_invalid',
          'Inworld WebSocket returned a malformed usage event; the harness failed closed.',
        );
        return;
      }
      if (usageEvent === 'valid' && !logicalComplete) {
        if (closeStreamSentElapsedMs === undefined) {
          fail(
            'usage_before_close_stream',
            'Inworld WebSocket returned usage before the required closeStream signal; the harness failed closed.',
          );
          return;
        }
        if (!finalTranscriptionAfterCloseStreamObserved) {
          fail(
            'usage_before_final_transcription',
            'Inworld WebSocket returned usage before a valid final transcription; the harness failed closed.',
          );
          return;
        }
        if (logicalDeadlineTimer) clearTimeout(logicalDeadlineTimer);
        usageElapsedMs = elapsed();
        logicalCompletionElapsedMs = usageElapsedMs;
        logicalComplete = true;
        logicalResultMessageCount = rawMessages.length;
        beginCleanup();
        return;
      }
      if (endTurnSentElapsedMs !== undefined && closeStreamSentElapsedMs === undefined) {
        scheduleCloseStream();
      }
    });
    socket.on('error', (error: unknown) => {
      record({
        direction: 'transport',
        kind: 'socket_error',
        phase: logicalComplete ? 'after_logical_completion' : 'before_logical_completion',
        errorMessage: errorMessage(error),
      });
      if (!logicalComplete) {
        fail('transport_uncertain', `Inworld WebSocket transport failed: ${errorMessage(error)}`);
      }
    });
    socket.on('close', (code?: unknown, reason?: unknown) => {
      physicalCloseElapsedMs = elapsed();
      physicalCloseObserved = true;
      record({
        direction: 'transport',
        kind: 'socket_close',
        phase: logicalComplete ? 'after_logical_completion' : 'before_logical_completion',
        ...(typeof code === 'number' ? { closeCode: code } : {}),
        ...(reason === undefined ? {} : { closeReason: messageToString(reason) }),
      });
      if (!logicalComplete) {
        physicalSocketBehavior = 'provider_closed_before_usage';
        if (!pendingFailure) {
          pendingFailure = {
            outcome: 'uncertain',
            category: 'stream_closed_without_usage',
            message:
              'Inworld WebSocket closed before the authoritative usage event; the harness failed closed.',
          };
        }
        finishPendingFailure();
        return;
      }
      physicalSocketBehavior = clientCloseRequested
        ? 'client_closed_after_usage'
        : 'provider_closed_before_usage';
      finish();
    });

    async function sendAudio(): Promise<void> {
      try {
        await sendFrame(JSON.stringify({ transcribeConfig: request.config }), {
          direction: 'client',
          kind: 'config',
        });
        const stream = createReadStream(request.filePath, {
          start: pcm.dataOffset,
          end: pcm.dataOffset + pcm.dataLength - 1,
          highWaterMark: request.chunkBytes,
        });
        const bytesPerSecond = request.sampleRateHz * request.channels * 2;
        let sentBeforeChunk = 0;
        let pacingStartedAt: number | undefined;
        for await (const chunk of stream) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          if (request.pacing !== 'unpaced') {
            pacingStartedAt ??= performance.now();
            const targetElapsedMs = pacingTargetElapsedMs(
              sentBeforeChunk,
              bytesPerSecond,
              request.pacing,
            );
            await delay(Math.max(0, pacingStartedAt + targetElapsedMs - performance.now()));
          }
          const chunkSha256 = createHash('sha256').update(bytes).digest('hex');
          await sendFrame(JSON.stringify({ audioChunk: { content: bytes.toString('base64') } }), {
            direction: 'client',
            kind: 'audio_chunk',
            audioOffsetBytes: sentBeforeChunk,
            audioBytes: bytes.length,
            audioSha256: chunkSha256,
          });
          audioStartedElapsedMs ??= elapsed();
          audioFinishedElapsedMs = elapsed();
          audioHash.update(bytes);
          audioBytes += bytes.length;
          outboundAudioChunkCount += 1;
          sentBeforeChunk += bytes.length;
        }
        if (audioBytes !== pcm.dataLength) {
          throw new Error(
            `Outbound PCM byte accounting mismatch: expected ${pcm.dataLength}, sent ${audioBytes}.`,
          );
        }
        await delay(request.endOfAudioDelayMs);
        endTurnSentElapsedMs = elapsed();
        await sendFrame(JSON.stringify({ endTurn: {} }), {
          direction: 'client',
          kind: 'end_turn',
        });
        scheduleCloseStream();
      } catch (error: unknown) {
        fail('send_failed', `Inworld WebSocket audio send failed: ${errorMessage(error)}`);
      }
    }

    function scheduleCloseStream(): void {
      if (settled || logicalComplete || closeStreamSentElapsedMs !== undefined) return;
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        closeStreamSentElapsedMs = elapsed();
        void sendFrame(JSON.stringify({ closeStream: {} }), {
          direction: 'client',
          kind: 'close_stream',
        }).catch((error: unknown) => {
          fail('send_failed', `Inworld WebSocket closeStream send failed: ${errorMessage(error)}`);
        });
      }, request.quietPeriodBeforeCloseMs);
    }

    function sendFrame(
      frame: string,
      event: Omit<ProviderStreamEvent, 'sequence' | 'elapsedMs'>,
    ): Promise<void> {
      if (settled || socket.readyState !== OPEN) {
        return Promise.reject(new Error('WebSocket is not open for the next frame.'));
      }
      providerSideWork = true;
      record(event.kind === 'audio_chunk' ? event : { ...event, rawMessage: frame });
      return new Promise<void>((resolveFrame, rejectFrame) => {
        socket.send(frame, (error?: Error) => (error ? rejectFrame(error) : resolveFrame()));
      });
    }
  });
}

export async function inspectWavPcm(
  filePath: string,
  expectedSampleRateHz: number,
  expectedChannels: number,
): Promise<{ dataOffset: number; dataLength: number }> {
  const handle = await open(filePath, 'r');
  try {
    const fileSize = (await handle.stat()).size;
    if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
      throw new Error('Inworld streaming WAV has an unsupported file size.');
    }
    if (
      !Number.isSafeInteger(expectedSampleRateHz) ||
      expectedSampleRateHz <= 0 ||
      !Number.isSafeInteger(expectedChannels) ||
      expectedChannels <= 0
    ) {
      throw new Error('Inworld streaming WAV expectations are invalid.');
    }
    const header = Buffer.alloc(12);
    const headerRead = await handle.read(header, 0, header.length, 0);
    if (
      headerRead.bytesRead !== header.length ||
      header.toString('ascii', 0, 4) !== 'RIFF' ||
      header.toString('ascii', 8, 12) !== 'WAVE'
    ) {
      throw new Error(`Inworld streaming requires a RIFF/WAVE input: ${path.basename(filePath)}`);
    }
    const riffSize = header.readUInt32LE(4);
    const riffEnd = 8 + riffSize;
    if (!Number.isSafeInteger(riffEnd) || riffEnd < 12 || riffEnd > fileSize) {
      throw new Error('Inworld streaming WAV has an invalid RIFF declared extent.');
    }
    let offset = 12;
    let format:
      | {
          audioFormat: number;
          channels: number;
          sampleRateHz: number;
          byteRate: number;
          blockAlign: number;
          bitsPerSample: number;
        }
      | undefined;
    let firstDataChunk: { dataOffset: number; dataLength: number } | undefined;
    while (offset < riffEnd) {
      if (offset + 8 > riffEnd) {
        throw new Error('Inworld streaming WAV has an incomplete chunk header within RIFF.');
      }
      const chunkHeader = Buffer.alloc(8);
      const chunkRead = await handle.read(chunkHeader, 0, chunkHeader.length, offset);
      if (chunkRead.bytesRead !== chunkHeader.length) {
        throw new Error('Inworld streaming WAV could not read a complete chunk header.');
      }
      const chunkId = chunkHeader.toString('ascii', 0, 4);
      const chunkLength = chunkHeader.readUInt32LE(4);
      const dataOffset = offset + 8;
      const chunkEnd = dataOffset + chunkLength;
      const nextOffset = chunkEnd + (chunkLength % 2);
      if (
        !Number.isSafeInteger(chunkEnd) ||
        !Number.isSafeInteger(nextOffset) ||
        chunkEnd > riffEnd ||
        nextOffset > riffEnd
      ) {
        throw new Error(`Inworld streaming WAV ${chunkId} chunk crosses the RIFF boundary.`);
      }
      if (chunkId === 'fmt ') {
        if (chunkLength < 16) throw new Error('Inworld streaming found an invalid WAV fmt chunk.');
        const fmt = Buffer.alloc(16);
        const fmtRead = await handle.read(fmt, 0, fmt.length, dataOffset);
        if (fmtRead.bytesRead !== fmt.length) {
          throw new Error('Inworld streaming could not read WAV fmt data.');
        }
        format = {
          audioFormat: fmt.readUInt16LE(0),
          channels: fmt.readUInt16LE(2),
          sampleRateHz: fmt.readUInt32LE(4),
          byteRate: fmt.readUInt32LE(8),
          blockAlign: fmt.readUInt16LE(12),
          bitsPerSample: fmt.readUInt16LE(14),
        };
      }
      if (chunkId === 'data') {
        if (firstDataChunk !== undefined) {
          throw new Error('Inworld streaming WAV contains more than one data chunk.');
        }
        if (!format || format.audioFormat !== 1 || format.bitsPerSample !== 16) {
          throw new Error('Inworld streaming requires PCM s16le WAV input.');
        }
        if (format.blockAlign !== format.channels * 2) {
          throw new Error('Inworld streaming WAV has an inconsistent PCM blockAlign.');
        }
        if (format.byteRate !== format.sampleRateHz * format.blockAlign) {
          throw new Error('Inworld streaming WAV has an inconsistent PCM byteRate.');
        }
        if (format.sampleRateHz !== expectedSampleRateHz || format.channels !== expectedChannels) {
          throw new Error(
            `Inworld streaming WAV topology mismatch: expected ${expectedSampleRateHz} Hz/${expectedChannels} channel(s), observed ${format.sampleRateHz} Hz/${format.channels}.`,
          );
        }
        if (chunkLength % format.blockAlign !== 0) {
          throw new Error('Inworld streaming WAV data is not aligned to complete PCM frames.');
        }
        firstDataChunk = { dataOffset, dataLength: chunkLength };
      }
      offset = nextOffset;
    }
    if (firstDataChunk === undefined) {
      throw new Error('Inworld streaming WAV did not contain a data chunk.');
    }
    return firstDataChunk;
  } finally {
    await handle.close();
  }
}

function validateStreamRequest(request: ProviderStreamRequest): void {
  if (request.pacing !== 'unpaced' && (!Number.isFinite(request.pacing) || request.pacing <= 0)) {
    throw new Error(
      'Inworld streaming pacing must be unpaced or a positive audio-rate multiplier.',
    );
  }
  for (const [name, value] of [
    ['endOfAudioDelayMs', request.endOfAudioDelayMs],
    ['quietPeriodBeforeCloseMs', request.quietPeriodBeforeCloseMs],
    ['physicalCloseGraceMs', request.physicalCloseGraceMs],
    ['maxWaitMs', request.maxWaitMs],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || (name === 'maxWaitMs' && value === 0)) {
      throw new Error(`Inworld streaming ${name} must be a valid bounded duration.`);
    }
  }
}

function emptyEvidence(): ProviderStreamEvidence {
  return {
    rawMessages: [],
    logicalResultMessages: [],
    postCompletionTransportMessages: [],
    events: [],
    outboundAudioBytes: 0,
    outboundAudioSha256: createHash('sha256').digest('hex'),
    outboundAudioChunkCount: 0,
    sendElapsedMs: 0,
    physicalSocketBehavior: 'not_closed_before_failure',
    clientCloseRequested: false,
    physicalCloseObserved: false,
    cleanupGraceExhausted: false,
    totalElapsedMs: 0,
    providerSideWork: false,
  };
}

export function validateTerminalUsage(
  value: unknown,
  expectedModel?: unknown,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Inworld usage must be an object.');
  }
  const usage = value as Record<string, unknown>;
  const duration = usage.transcribedAudioMs;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
    throw new Error('Inworld usage.transcribedAudioMs must be a finite non-negative number.');
  }
  if (typeof usage.modelId !== 'string' || usage.modelId.length === 0) {
    throw new Error('Inworld usage.modelId is required for terminal usage.');
  }
  if (typeof expectedModel === 'string' && usage.modelId !== expectedModel) {
    throw new Error(`Inworld usage model ${usage.modelId} did not match ${expectedModel}.`);
  }
  return usage;
}

function classifyFinalTranscriptionMessage(raw: string): 'none' | 'valid' | 'invalid' {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result = parsed.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return 'none';
    const transcription = (result as Record<string, unknown>).transcription;
    if (transcription === undefined) return 'none';
    if (
      transcription === null ||
      typeof transcription !== 'object' ||
      Array.isArray(transcription)
    ) {
      return 'invalid';
    }
    const value = transcription as Record<string, unknown>;
    if (
      typeof value.transcript !== 'string' ||
      typeof value.isFinal !== 'boolean' ||
      !Array.isArray(value.wordTimestamps)
    ) {
      return 'invalid';
    }
    return value.isFinal ? 'valid' : 'none';
  } catch {
    return 'none';
  }
}

function classifyUsageMessage(raw: string, expectedModel?: unknown): 'none' | 'valid' | 'invalid' {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return 'none';
  }
  try {
    const result = parsed.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return 'none';
    if (!Object.hasOwn(result, 'usage')) return 'none';
    validateTerminalUsage((result as Record<string, unknown>).usage, expectedModel);
    return 'valid';
  } catch {
    return 'invalid';
  }
}

export function pacingTargetElapsedMs(
  sentBytes: number,
  bytesPerSecond: number,
  pacing: number,
): number {
  if (
    !Number.isFinite(sentBytes) ||
    sentBytes < 0 ||
    !Number.isFinite(bytesPerSecond) ||
    bytesPerSecond <= 0 ||
    !Number.isFinite(pacing) ||
    pacing <= 0
  ) {
    throw new Error('Inworld pacing math requires non-negative bytes and positive rates.');
  }
  return (sentBytes / bytesPerSecond / pacing) * 1000;
}

function messageToString(message: unknown): string {
  if (typeof message === 'string') return message;
  if (Buffer.isBuffer(message)) return message.toString('utf8');
  if (message instanceof ArrayBuffer) return Buffer.from(message).toString('utf8');
  if (message instanceof Uint8Array) return Buffer.from(message).toString('utf8');
  return String(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
