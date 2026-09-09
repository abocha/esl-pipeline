import type { Readable } from 'node:stream';
import { DeepgramClient } from '@deepgram/sdk';

import {
  mergeSegments,
  normalizeSegmentEnds,
  normalizeTranscriptText,
  type SttProviderAdapter,
  type TranscriptSegment,
} from '@esl-pipeline/stt-core';

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
  trustedSplitChannels?: boolean;
}

export interface DeepgramSttDependencies {
  clientFactory?: (
    config: DeepgramSttConfig,
    transport?: { fetch: typeof fetch; signal: AbortSignal },
  ) => DeepgramClientLike;
}

export function createDeepgramSttProvider(
  deps: DeepgramSttDependencies = {},
): SttProviderAdapter<DeepgramSttConfig> {
  const clientFactory = deps.clientFactory ?? defaultClientFactory;

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
    async transcribe({ context, config }) {
      const client = clientFactory(config, context.providerTransport);

      const primaryOptions = {
        model: config.model,
        language: config.language,
        multichannel: true,
        punctuate: true,
        smart_format: true,
        utterances: true,
      };
      if (config.trustedSplitChannels) {
        const result = await transcribeAttempt({
          client,
          getStream: context.getStream,
          options: primaryOptions,
        });
        if (getChannelCount(result) !== 2) {
          throw controlledProviderError('PROVIDER_RESPONSE_INVALID');
        }
        const segments = mergeSegments(getTrustedSplitTranscriptSegments(result));
        if (
          !segments.some((segment) => segment.speaker === 0) ||
          !segments.some((segment) => segment.speaker === 1)
        ) {
          throw controlledProviderError('PROVIDER_RESPONSE_INVALID');
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

      // A single run slot must map to at most one adapter submission. In particular,
      // do not turn a multichannel response into a hidden diarization retry.
      const result = await transcribeAttempt({
        client,
        getStream: context.getStream,
        options: primaryOptions,
      });
      const fallbackUsed = false;

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

function defaultClientFactory(
  config: DeepgramSttConfig,
  transport?: { fetch: typeof fetch; signal: AbortSignal },
) {
  const transportOptions = transport ? { fetch: transport.fetch } : {};
  if (config.accessToken) {
    return new DeepgramClient({
      accessToken: config.accessToken,
      maxRetries: 0,
      ...transportOptions,
    }) as unknown as DeepgramClientLike;
  }
  if (config.apiKey) {
    return new DeepgramClient({
      apiKey: config.apiKey,
      maxRetries: 0,
      ...transportOptions,
    }) as unknown as DeepgramClientLike;
  }
  return new DeepgramClient({ maxRetries: 0, ...transportOptions }) as unknown as DeepgramClientLike;
}

async function transcribeAttempt(args: {
  client: DeepgramClientLike;
  getStream: () => Promise<Readable>;
  options: Record<string, unknown>;
}): Promise<DeepgramResult> {
  const stream = await args.getStream();
  try {
    const response = await args.client.listen.v1.media.transcribeFile(stream, args.options);
    return resolveDeepgramResponse(response);
  } catch (error) {
    throw toControlledProviderError(error);
  } finally {
    stream.destroy();
  }
}

function isDeepgramAcceptedResponse(value: unknown): value is DeepgramAcceptedResponseLike {
  if (!value || typeof value !== 'object') return false;
  return typeof (value as DeepgramAcceptedResponseLike).request_id === 'string';
}

function resolveDeepgramResponse(value: unknown): DeepgramResult {
  if (isDeepgramAcceptedResponse(value)) {
    throw controlledProviderError('PROVIDER_RESPONSE_INVALID');
  }

  return asDeepgramResult(value);
}

function asDeepgramResult(value: unknown): DeepgramResult {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as DeepgramResult;
}

function toControlledProviderError(error: unknown): Error {
  const sourceCode = readSafeCode(error);
  if (
    error instanceof Error &&
    new Set([
      'PROVIDER_RESPONSE_INVALID',
      'AMBIGUOUS_PROVIDER_OUTCOME',
      'PROVIDER_RETRYABLE_HTTP',
      'PROVIDER_PERMANENT_REJECTION',
      'PROVIDER_TIMEOUT',
      'PROVIDER_TRANSPORT_ERROR',
    ]).has(sourceCode ?? '')
  ) {
    return error;
  }
  const status = readSafeStatus(error);
  if (status === 408 || status === 429 || (status !== undefined && status >= 500)) {
    return controlledProviderError('PROVIDER_RETRYABLE_HTTP', status);
  }
  if (status !== undefined && status >= 400) {
    return controlledProviderError('PROVIDER_PERMANENT_REJECTION', status);
  }
  if (sourceCode === 'ETIMEDOUT' || sourceCode === 'ESOCKETTIMEDOUT') {
    return controlledProviderError('PROVIDER_TIMEOUT');
  }
  return controlledProviderError('PROVIDER_TRANSPORT_ERROR');
}

function controlledProviderError(code: string, status?: number): Error {
  const error = new Error('Deepgram transcription request failed.');
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  if (status !== undefined)
    Object.defineProperty(error, 'status', { value: status, enumerable: true });
  return error;
}

function readSafeStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status = candidate.status ?? candidate.statusCode;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined;
}

function readSafeCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code.toUpperCase() : undefined;
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
          throw controlledProviderError('PROVIDER_RESPONSE_INVALID');
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
