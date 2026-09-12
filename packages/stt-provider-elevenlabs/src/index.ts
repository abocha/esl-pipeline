import { openAsBlob } from 'node:fs';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

import {
  mergeSegments,
  type SttProviderAdapter,
  type SttSubmissionSource,
  type TranscriptSegment,
} from '@esl-pipeline/stt-core';

interface ElevenLabsWord {
  text?: string;
  speakerId?: string | null;
  speaker_id?: string | null;
  start?: number;
  end?: number;
  type?: string;
  channelIndex?: number;
  channel_index?: number;
}

interface ElevenLabsChannelTranscript {
  text?: string;
  words?: ElevenLabsWord[];
  channelIndex?: number;
  channel_index?: number;
}

interface ElevenLabsMultichannelResponse {
  transcripts?: ElevenLabsChannelTranscript[];
  text?: string;
}

type ElevenLabsModelId = 'scribe_v1' | 'scribe_v2';

interface ElevenLabsClientLike {
  speechToText: {
    convert: (
      args: Record<string, unknown>,
      requestOptions?: { abortSignal?: AbortSignal },
    ) => Promise<unknown>;
  };
}

export interface ElevenLabsSttConfig {
  apiKey: string;
  modelId?: ElevenLabsModelId;
}

export interface ElevenLabsSttDependencies {
  clientFactory?: (
    apiKey: string,
    transport?: { fetch: typeof fetch; signal: AbortSignal },
  ) => ElevenLabsClientLike;
}

const DEFAULT_MODEL_ID = 'scribe_v2';

export function createElevenLabsSttProvider(
  deps: ElevenLabsSttDependencies = {},
): SttProviderAdapter<ElevenLabsSttConfig> {
  const clientFactory = deps.clientFactory ?? defaultClientFactory;

  return {
    id: 'elevenlabs',
    validateConfig(config) {
      if (!config || typeof config !== 'object') {
        throw new Error('ElevenLabs STT config is required.');
      }
      const typed = config as ElevenLabsSttConfig;
      if (!typed.apiKey?.trim()) {
        throw new Error('ELEVENLABS_API_KEY is required when STT_PROVIDER=elevenlabs');
      }
    },
    async transcribe({ context, config }) {
      if (!config.apiKey.trim()) {
        throw new Error('ELEVENLABS_API_KEY is required when STT_PROVIDER=elevenlabs');
      }
      const modelId = config.modelId ?? DEFAULT_MODEL_ID;
      const client = clientFactory(config.apiKey, context.providerTransport);

      const submissionSource = await context.getSubmissionSource?.();
      if (!submissionSource) {
        throw new Error('ElevenLabs provider submission source is unavailable.');
      }

      let knownUrlSecretMaterials: readonly string[] | undefined;
      if (submissionSource.kind === 'url') {
        try {
          knownUrlSecretMaterials = deriveKnownUrlSecretMaterials(submissionSource.url);
        } catch {
          throw createSafeUrlSubmissionError();
        }
      }

      const sourceFields =
        submissionSource.kind === 'url'
          ? { sourceUrl: submissionSource.url }
          : { file: await toElevenLabsFileSource(submissionSource) };
      let response: unknown;
      try {
        const request = {
          ...sourceFields,
          modelId,
          useMultiChannel: false,
          diarize: true,
          numSpeakers: 2,
          timestampsGranularity: 'word',
          noVerbatim: false,
        };
        response = context.providerTransport
          ? await client.speechToText.convert(request, {
              abortSignal: context.providerTransport.signal,
            })
          : await client.speechToText.convert(request);
      } catch (error) {
        if (submissionSource.kind === 'url') {
          throw createSafeUrlSubmissionError(error);
        }
        throw createSafeProviderSubmissionError(error);
      }
      const parsed = parseElevenLabsDiarizedResponse(response);
      if (knownUrlSecretMaterials && containsKnownSecretMaterial(parsed, knownUrlSecretMaterials)) {
        throw createSafeUrlSubmissionError();
      }
      return {
        provider: 'elevenlabs',
        model: modelId,
        language: 'auto',
        text: parsed.text,
        segments: parsed.segments,
        // The worker owns opt-in raw-response storage and persists this before
        // structural validation, including for the normal S3 source_url path.
        rawResponse: response,
        fallbackUsed: false,
        summary: {
          segmentCount: parsed.segments.length,
          fallbackUsed: false,
          elevenLabsPreMergeTiming: parsed.preMergeTiming,
        },
      };
    },
  };
}

function defaultClientFactory(
  apiKey: string,
  transport?: { fetch: typeof fetch; signal: AbortSignal },
) {
  // The recording run owns the paid-boundary retry budget. The SDK defaults to two
  // invisible replays, which would make one reserved submission slot dishonest.
  return new ElevenLabsClient({
    apiKey,
    maxRetries: 0,
    ...(transport ? { fetch: transport.fetch } : {}),
  }) as unknown as ElevenLabsClientLike;
}

function createSafeUrlSubmissionError(error?: unknown): Error {
  const safeError = new Error('ElevenLabs source URL submission failed.');
  safeError.name = 'ElevenLabsUrlSubmissionError';

  const status = readSafeStatus(error);
  const code = controlledProviderErrorCode(error, status);
  Object.defineProperty(safeError, 'code', {
    configurable: false,
    enumerable: true,
    value: code,
    writable: false,
  });
  if (status !== undefined) {
    Object.defineProperty(safeError, 'status', {
      configurable: false,
      enumerable: true,
      value: status,
      writable: false,
    });
  }

  return safeError;
}

function createSafeProviderSubmissionError(error?: unknown): Error {
  const safeError = new Error('ElevenLabs transcription request failed.');
  Object.defineProperty(safeError, 'code', {
    configurable: false,
    enumerable: true,
    value: controlledProviderErrorCode(error, readSafeStatus(error)),
    writable: false,
  });
  const status = readSafeStatus(error);
  if (status !== undefined) {
    Object.defineProperty(safeError, 'status', {
      configurable: false,
      enumerable: true,
      value: status,
      writable: false,
    });
  }
  return safeError;
}

function controlledProviderErrorCode(error: unknown, status: number | undefined): string {
  if (status === 408 || status === 429 || (status !== undefined && status >= 500)) {
    return 'PROVIDER_RETRYABLE_HTTP';
  }
  if (status !== undefined && status >= 400) return 'PROVIDER_PERMANENT_REJECTION';
  const sourceCode = readSafeCode(error);
  if (sourceCode === 'ETIMEDOUT' || sourceCode === 'ESOCKETTIMEDOUT') return 'PROVIDER_TIMEOUT';
  return 'PROVIDER_TRANSPORT_ERROR';
}

const URL_SECRET_QUERY_KEYS = new Set([
  'x-amz-signature',
  'x-amz-security-token',
  'x-amz-credential',
]);

function deriveKnownUrlSecretMaterials(url: string): string[] {
  const parsed = new URL(url);
  const materials = new Set<string>([url]);
  for (const [key, value] of parsed.searchParams) {
    if (URL_SECRET_QUERY_KEYS.has(key.toLowerCase()) && value) {
      materials.add(value);
    }
  }
  return [...materials];
}

function containsKnownSecretMaterial(
  parsed: { text: string; segments: TranscriptSegment[] },
  knownSecretMaterials: readonly string[],
): boolean {
  const mappedStrings = [parsed.text, ...parsed.segments.map((segment) => segment.text)];
  return mappedStrings.some((mappedString) =>
    knownSecretMaterials.some(
      (secretMaterial) => secretMaterial.length > 0 && mappedString.includes(secretMaterial),
    ),
  );
}

function readSafeStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  try {
    const candidate = error as { status?: unknown; statusCode?: unknown };
    const status = candidate.status ?? candidate.statusCode;
    return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
      ? status
      : undefined;
  } catch {
    return undefined;
  }
}

function readSafeCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code.toUpperCase() : undefined;
}

async function toElevenLabsFileSource(source: Extract<SttSubmissionSource, { kind: 'file' }>) {
  return {
    data: await openAsBlob(source.path, { type: source.contentType }),
    filename: source.filename,
    contentType: source.contentType,
    contentLength: source.contentLength,
  };
}

function parseElevenLabsMultichannelResponse(
  response: unknown,
): { text: string; segments: TranscriptSegment[] } | null {
  const transcripts = (response as ElevenLabsMultichannelResponse | null)?.transcripts;
  if (!Array.isArray(transcripts) || transcripts.length === 0) {
    return null;
  }

  const wordsWithContext: {
    word: ElevenLabsWord;
    channelIndex?: number;
  }[] = [];
  const textParts: string[] = [];

  for (const transcript of transcripts) {
    const transcriptText = (transcript.text ?? '').trim();
    if (transcriptText) {
      textParts.push(transcriptText);
    }
    const transcriptChannelIndex = normalizeElevenLabsChannelIndex(
      transcript.channelIndex ?? transcript.channel_index,
    );
    const words = transcript.words;
    if (!Array.isArray(words) || words.length === 0) continue;
    for (const word of words) {
      wordsWithContext.push({ word, channelIndex: transcriptChannelIndex });
    }
  }

  if (wordsWithContext.length === 0) {
    return null;
  }

  const text = textParts.join(' ').trim();
  const segments = buildElevenLabsSegments(wordsWithContext);
  return { text, segments };
}

function parseElevenLabsDiarizedResponse(response: unknown): {
  text: string;
  segments: TranscriptSegment[];
  preMergeTiming: ElevenLabsPreMergeTiming;
} {
  const text = ((response as { text?: string }).text ?? '').trim();
  const words: ElevenLabsWord[] = (response as { words?: ElevenLabsWord[] }).words ?? [];
  const preMergeTiming = inspectElevenLabsTiming(words);
  const segments = buildElevenLabsSegments(words.map((word) => ({ word })));
  return { text, segments, preMergeTiming };
}

interface ElevenLabsPreMergeTiming {
  indexBasis: 'provider_words_zero_based';
  lexicalTokenCount: number;
  invalidTimingTokenCount: number;
  firstInvalidTokenIndex?: number;
  firstInvalidTimingIssue?:
    | 'missing_start'
    | 'missing_end'
    | 'non_finite_start'
    | 'non_finite_end'
    | 'negative_start'
    | 'non_positive_duration';
}

/** Inspect the same lexical inputs as buildElevenLabsSegments, before timing mapping or merging. */
function inspectElevenLabsTiming(words: ElevenLabsWord[]): ElevenLabsPreMergeTiming {
  const diagnostic: ElevenLabsPreMergeTiming = {
    indexBasis: 'provider_words_zero_based',
    lexicalTokenCount: 0,
    invalidTimingTokenCount: 0,
  };
  for (const [index, word] of words.entries()) {
    if (
      typeof word.text !== 'string' ||
      !word.text.trim() ||
      classifyElevenLabsTokenType(word.type) !== 'lexical'
    )
      continue;
    diagnostic.lexicalTokenCount += 1;
    const issue = classifyElevenLabsTiming(word);
    if (!issue) continue;
    diagnostic.invalidTimingTokenCount += 1;
    if (diagnostic.firstInvalidTokenIndex === undefined) {
      diagnostic.firstInvalidTokenIndex = index;
      diagnostic.firstInvalidTimingIssue = issue;
    }
  }
  return diagnostic;
}

function classifyElevenLabsTiming(
  word: ElevenLabsWord,
): ElevenLabsPreMergeTiming['firstInvalidTimingIssue'] {
  if (word.start == null) return 'missing_start';
  if (word.end == null) return 'missing_end';
  if (!Number.isFinite(word.start)) return 'non_finite_start';
  if (!Number.isFinite(word.end)) return 'non_finite_end';
  if (word.start < 0) return 'negative_start';
  if (word.end <= word.start) return 'non_positive_duration';
  return undefined;
}

function buildElevenLabsSegments(
  wordsWithContext: { word: ElevenLabsWord; channelIndex?: number }[],
): TranscriptSegment[] {
  if (wordsWithContext.length === 0) {
    return [];
  }

  const turnChunks: TranscriptSegment[][] = [[]];

  for (const entry of wordsWithContext) {
    const word = entry.word;
    const normalizedText = typeof word.text === 'string' ? word.text.trim() : '';
    if (!normalizedText) {
      continue;
    }

    const tokenType = classifyElevenLabsTokenType(word.type);
    const currentChunk = turnChunks.at(-1)!;
    if (tokenType === 'spacing') {
      continue;
    }
    if (tokenType === 'punctuation') {
      const previousLexical = currentChunk.at(-1);
      if (previousLexical) previousLexical.text = `${previousLexical.text}${normalizedText}`;
      continue;
    }
    if (tokenType === 'audio_event') {
      if (currentChunk.length > 0) turnChunks.push([]);
      continue;
    }

    const speaker = resolveElevenLabsSpeakerIndex(word, entry.channelIndex);
    const start = typeof word.start === 'number' ? word.start : undefined;
    const end = typeof word.end === 'number' ? word.end : undefined;

    currentChunk.push({ text: normalizedText, speaker, start, end });
  }

  // Use the shared turn coalescing path, but retain malformed provider timing for
  // the worker's deterministic structural validation rather than synthesizing it.
  return turnChunks
    .flatMap((chunk) => mergeSegments(chunk, { preserveSegmentTimings: true }))
    .sort((left, right) => (left.start ?? 0) - (right.start ?? 0));
}

function classifyElevenLabsTokenType(
  type: unknown,
): 'lexical' | 'spacing' | 'punctuation' | 'audio_event' {
  if (typeof type !== 'string') return 'lexical';
  const normalized = type.toLowerCase();
  if (normalized === 'spacing') return 'spacing';
  if (normalized === 'punctuation') return 'punctuation';
  if (normalized === 'audio_event') return 'audio_event';
  return 'lexical';
}

function resolveElevenLabsSpeakerIndex(
  word: ElevenLabsWord,
  channelIndex?: number,
): number | undefined {
  const speakerId = resolveElevenLabsSpeakerId(word);
  const fromSpeaker = parseElevenLabsSpeakerId(speakerId);
  if (typeof fromSpeaker === 'number') return fromSpeaker;

  const fromWordChannel = normalizeElevenLabsChannelIndex(word.channelIndex ?? word.channel_index);
  if (typeof fromWordChannel === 'number') return fromWordChannel;
  if (typeof channelIndex === 'number') return channelIndex;
  return undefined;
}

function resolveElevenLabsSpeakerId(word: ElevenLabsWord): string | null {
  if (typeof word.speakerId === 'string') return word.speakerId;
  if (typeof word.speaker_id === 'string') return word.speaker_id;
  return null;
}

function parseElevenLabsSpeakerId(speakerId: string | null): number | undefined {
  if (!speakerId) return undefined;
  const match = /(\d+)$/.exec(speakerId);
  if (!match?.[1]) return undefined;
  return Number.parseInt(match[1], 10);
}

function normalizeElevenLabsChannelIndex(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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
