import type { Readable } from 'node:stream';
import { DeepgramClient } from '@deepgram/sdk';

import { classifyProviderRuntimeFailure } from '@esl-pipeline/provider-runtime';
import {
  mergeSegments,
  normalizeSegmentEnds,
  normalizeTranscriptText,
  type SttProviderAdapter,
  type TranscriptSegment,
} from '@esl-pipeline/stt-core';

interface RetryableStatusError {
  status?: unknown;
  statusCode?: unknown;
}

interface DeepgramAcceptedResponseLike {
  request_id?: unknown;
}

interface DeepgramResult {
  metadata?: Record<string, unknown>;
  results?: {
    channels?: {
      alternatives?: {
        transcript?: string;
        words?: {
          end?: number;
          speaker?: number;
          start?: number;
          punctuated_word?: string;
          word?: string;
        }[];
      }[];
    }[];
    utterances?: {
      channel?: number;
      end?: number;
      transcript?: string;
      speaker?: number;
      start?: number;
    }[];
  };
}

interface DeepgramClientLike {
  listen: {
    v1: {
      media: {
        transcribeFile: (...args: unknown[]) => Promise<unknown>;
      };
    };
  };
}

export interface DeepgramSttConfig {
  apiKey?: string;
  accessToken?: string;
  model: string;
  language: string;
  retryMax?: number;
  retryBaseDelayMs?: number;
  trustedSplitChannels?: boolean;
}

export interface DeepgramSttDependencies {
  clientFactory?: (config: DeepgramSttConfig) => DeepgramClientLike;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_RETRY_MAX = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = process.env.NODE_ENV === 'test' ? 0 : 250;
const RETRYABLE_DEEPGRAM_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_DEEPGRAM_MESSAGE_PATTERNS = [
  'terminated',
  'fetch failed',
  'network',
  'socket',
  'timeout',
  'timed out',
  'etimedout',
  'econnreset',
  'econnrefused',
  'aborted',
];

export function createDeepgramSttProvider(
  deps: DeepgramSttDependencies = {},
): SttProviderAdapter<DeepgramSttConfig> {
  const clientFactory = deps.clientFactory ?? defaultClientFactory;
  const sleep =
    deps.sleep ?? (async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  return {
    id: 'deepgram',
    validateConfig(config) {
      if (!config || typeof config !== 'object') {
        throw new Error('Deepgram STT config is required.');
      }
      const typed = config as DeepgramSttConfig;
      if (!typed.model?.trim()) {
        throw new Error('Deepgram STT model is required.');
      }
      if (!typed.language?.trim()) {
        throw new Error('Deepgram STT language is required.');
      }
    },
    classifyProviderError(error) {
      const details = getErrorDetails(error);
      return classifyProviderRuntimeFailure({
        provider: 'deepgram',
        message: details.message,
        status: details.status,
        code: details.code,
        name: details.name,
        rules: {
          byProvider: {
            deepgram: {
              timeoutStatusMin: 500,
            },
          },
        },
      });
    },
    async transcribe({ context, config }) {
      const retryMax = Math.max(1, config.retryMax ?? DEFAULT_RETRY_MAX);
      const retryBaseDelayMs = Math.max(0, config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS);
      const client = clientFactory(config);

      const primaryOptions = {
        model: config.model,
        language: config.language,
        multichannel: true,
        punctuate: true,
        smart_format: true,
        utterances: true,
      };
      const fallbackOptions = {
        model: config.model,
        language: config.language,
        diarize: true,
        utterances: true,
        punctuate: true,
        smart_format: true,
      };

      if (config.trustedSplitChannels) {
        const result = await transcribeAttempt({
          client,
          getStream: context.getStream,
          options: primaryOptions,
          retryMax,
          retryBaseDelayMs,
          sleep,
        });
        if (getChannelCount(result) !== 2) {
          throw new Error(
            'Trusted split-channel recording did not preserve its declared two-channel contract. Re-upload or retry it as an ordinary mixed recording.',
          );
        }
        const segments = mergeSegments(getTrustedSplitTranscriptSegments(result));
        if (
          !segments.some((segment) => segment.speaker === 0) ||
          !segments.some((segment) => segment.speaker === 1)
        ) {
          throw new Error(
            'Trusted split-channel recording did not return both declared channel roles. Re-upload or retry it as an ordinary mixed recording.',
          );
        }
        return {
          provider: 'deepgram',
          model: config.model,
          language: config.language,
          text: getRawTranscript(result),
          segments,
          rawResponse: result,
          fallbackUsed: false,
          summary: {
            ...(buildSummary(result) ?? undefined),
            segmentCount: segments.length,
            fallbackUsed: false,
          },
        };
      }

      let result: DeepgramResult;
      let fallbackUsed = false;

      try {
        const primaryResult = await transcribeAttempt({
          client,
          getStream: context.getStream,
          options: primaryOptions,
          retryMax,
          retryBaseDelayMs,
          sleep,
        });
        const channelCount = getChannelCount(primaryResult);
        if (channelCount === 1) {
          try {
            result = await transcribeAttempt({
              client,
              getStream: context.getStream,
              options: fallbackOptions,
              retryMax,
              retryBaseDelayMs,
              sleep,
            });
            fallbackUsed = true;
          } catch {
            result = primaryResult;
            fallbackUsed = false;
          }
        } else {
          result = primaryResult;
        }
      } catch (primaryError) {
        try {
          result = await transcribeAttempt({
            client,
            getStream: context.getStream,
            options: fallbackOptions,
            retryMax,
            retryBaseDelayMs,
            sleep,
          });
          fallbackUsed = true;
        } catch (fallbackError) {
          throw asError(fallbackError ?? primaryError, 'Deepgram transcription failed');
        }
      }

      const segments = mergeSegments(getTranscriptSegments(result));
      return {
        provider: 'deepgram',
        model: config.model,
        language: config.language,
        text: getRawTranscript(result),
        segments,
        rawResponse: result,
        fallbackUsed,
        summary: {
          ...(buildSummary(result) ?? undefined),
          segmentCount: segments.length,
          fallbackUsed,
        },
      };
    },
  };
}

function defaultClientFactory(config: DeepgramSttConfig) {
  if (config.accessToken) {
    return new DeepgramClient({ accessToken: config.accessToken }) as unknown as DeepgramClientLike;
  }
  if (config.apiKey) {
    return new DeepgramClient({ apiKey: config.apiKey }) as unknown as DeepgramClientLike;
  }
  return new DeepgramClient() as unknown as DeepgramClientLike;
}

async function transcribeAttempt(args: {
  client: DeepgramClientLike;
  getStream: () => Promise<Readable>;
  options: Record<string, unknown>;
  retryMax: number;
  retryBaseDelayMs: number;
  sleep: (ms: number) => Promise<void>;
}): Promise<DeepgramResult> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= args.retryMax; attempt += 1) {
    const stream = await args.getStream();
    try {
      const response = await args.client.listen.v1.media.transcribeFile(stream, args.options);
      return resolveDeepgramResponse(response);
    } catch (error) {
      if (!isRetryableTranscriptionError(error)) {
        throw asError(error, 'Deepgram transcription failed');
      }
      lastError = error;
    } finally {
      stream.destroy();
    }

    if (attempt < args.retryMax) {
      await args.sleep(getRetryDelayMs(attempt, args.retryBaseDelayMs));
    }
  }

  throw asError(lastError, 'Deepgram transcription failed after retries');
}

function getRetryDelayMs(attempt: number, baseDelayMs: number): number {
  return Math.min(baseDelayMs * 2 ** (attempt - 1), 2_000);
}

function isDeepgramAcceptedResponse(value: unknown): value is DeepgramAcceptedResponseLike {
  if (!value || typeof value !== 'object') return false;
  return typeof (value as DeepgramAcceptedResponseLike).request_id === 'string';
}

function resolveDeepgramResponse(value: unknown): DeepgramResult {
  if (isDeepgramAcceptedResponse(value)) {
    const requestId = String(value.request_id);
    throw new Error(
      `Deepgram returned async accepted response (request_id=${requestId}); synchronous transcription response is required.`,
    );
  }

  return asDeepgramResult(value);
}

function asDeepgramResult(value: unknown): DeepgramResult {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as DeepgramResult;
}

function getErrorDetails(error: unknown): {
  status?: number;
  code?: string;
  message: string;
  name?: string;
} {
  if (error instanceof Error) {
    const typed = error as Error & {
      status?: number;
      statusCode?: number;
      code?: unknown;
    };
    const code = typeof typed.code === 'string' ? typed.code : undefined;
    return {
      status: typeof typed.status === 'number' ? typed.status : typed.statusCode,
      code,
      message: error.message,
      name: error.name,
    };
  }

  return {
    message: String(error),
  };
}

function asError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return new Error(message);
    }
  }
  return new Error(fallbackMessage);
}

function isRetryableTranscriptionError(error: unknown): boolean {
  const status = getRetryableStatus(error);
  if (typeof status === 'number' && RETRYABLE_DEEPGRAM_STATUS_CODES.has(status)) {
    return true;
  }

  const message = extractErrorMessage(error).toLowerCase();
  if (!message) return false;
  return RETRYABLE_DEEPGRAM_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
}

function getRetryableStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const status = (error as RetryableStatusError).status;
  if (typeof status === 'number') return status;
  const statusCode = (error as RetryableStatusError).statusCode;
  return typeof statusCode === 'number' ? statusCode : null;
}

function extractErrorMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : '';
  }
  return String(error);
}

function resolveSpeakerIndex(channel?: number, speaker?: number): number | undefined {
  if (typeof channel === 'number') return channel;
  if (typeof speaker === 'number') return speaker;
  return undefined;
}

function getTranscriptSegments(result: DeepgramResult): TranscriptSegment[] {
  const utterances = result.results?.utterances;
  if (Array.isArray(utterances) && utterances.length > 0) {
    const segments = utterances
      .map((item) => ({
        text: (item.transcript ?? '').trim(),
        speaker: resolveSpeakerIndex(item.channel, item.speaker),
        start: typeof item.start === 'number' ? item.start : undefined,
        end: typeof item.end === 'number' ? item.end : undefined,
      }))
      .filter((item) => item.text.length > 0);
    return normalizeSegmentEnds(segments).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  }

  return buildSegmentsFromWords(result);
}

function getTrustedSplitTranscriptSegments(result: DeepgramResult): TranscriptSegment[] {
  const utterances = result.results?.utterances;
  if (Array.isArray(utterances) && utterances.length > 0) {
    const segments = utterances
      .map((item) => {
        if (item.channel !== 0 && item.channel !== 1) {
          throw new Error(
            'Trusted split-channel recording did not return explicit channel 0/1 provenance.',
          );
        }
        return {
          text: (item.transcript ?? '').trim(),
          speaker: item.channel,
          start: typeof item.start === 'number' ? item.start : undefined,
          end: typeof item.end === 'number' ? item.end : undefined,
        };
      })
      .filter((item) => item.text.length > 0);
    return normalizeSegmentEnds(segments).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  }

  return buildTrustedSplitSegmentsFromChannels(result);
}

function getRawTranscript(result: DeepgramResult): string {
  const channel = result.results?.channels?.[0];
  const alternative = channel?.alternatives?.[0];
  const transcript = alternative?.transcript ?? '';
  return normalizeTranscriptText(transcript).trim();
}

function buildSummary(result: DeepgramResult): Record<string, unknown> | null {
  const metadata = result.metadata ?? null;
  const channelCount = result.results?.channels?.length;

  if (!metadata && !channelCount) {
    return null;
  }

  const summary: Record<string, unknown> = metadata ? { ...metadata } : {};
  if (channelCount) {
    summary.channels = channelCount;
  }

  return summary;
}

function getChannelCount(result: DeepgramResult): number | null {
  const metadataChannels = (result.metadata as { channels?: unknown } | undefined)?.channels;
  if (typeof metadataChannels === 'number') {
    return metadataChannels;
  }
  if (Array.isArray(result.results?.channels)) {
    return result.results?.channels?.length ?? null;
  }
  return null;
}

function buildSegmentsFromWords(result: DeepgramResult): TranscriptSegment[] {
  const channels = result.results?.channels;
  if (!Array.isArray(channels) || channels.length === 0) {
    return [];
  }

  const segments: TranscriptSegment[] = [];

  for (const [channelIndex, channel] of channels.entries()) {
    const words = channel.alternatives?.[0]?.words;
    if (!Array.isArray(words) || words.length === 0) {
      continue;
    }

    let current: TranscriptSegment | null = null;
    for (const word of words) {
      const text = (word.punctuated_word ?? word.word ?? '').trim();
      if (!text) continue;

      const speaker = resolveSpeakerIndex(channelIndex, word.speaker);
      const start = typeof word.start === 'number' ? word.start : undefined;
      const end = typeof word.end === 'number' ? word.end : undefined;

      if (!current || current.speaker !== speaker) {
        if (current) {
          segments.push(current);
        }
        current = { text, speaker, start, end };
        continue;
      }

      current.text = `${current.text} ${text}`.trim();
      if (typeof end === 'number') {
        current.end = end;
      }
    }

    if (current) {
      segments.push(current);
    }
  }

  return normalizeSegmentEnds(segments).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}

function buildTrustedSplitSegmentsFromChannels(result: DeepgramResult): TranscriptSegment[] {
  const channels = result.results?.channels;
  if (!Array.isArray(channels) || channels.length !== 2) return [];

  const segments: TranscriptSegment[] = [];
  for (const channelIndex of [0, 1] as const) {
    const words = channels[channelIndex]?.alternatives?.[0]?.words;
    if (!Array.isArray(words) || words.length === 0) continue;
    let current: TranscriptSegment | null = null;
    for (const word of words) {
      const text = (word.punctuated_word ?? word.word ?? '').trim();
      if (!text) continue;
      const start = typeof word.start === 'number' ? word.start : undefined;
      const end = typeof word.end === 'number' ? word.end : undefined;
      if (!current) {
        current = { text, speaker: channelIndex, start, end };
        continue;
      }
      current.text = `${current.text} ${text}`.trim();
      if (typeof end === 'number') current.end = end;
    }
    if (current) segments.push(current);
  }
  return normalizeSegmentEnds(segments).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}
