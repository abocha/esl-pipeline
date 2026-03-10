import type { Readable } from 'node:stream';

import { classifyProviderRuntimeFailure } from '@esl-pipeline/provider-runtime';
import { mergeSegments, type SttProviderAdapter, type TranscriptSegment } from '@esl-pipeline/stt-core';
import { SpeechClient } from '@google-cloud/speech';
import { Storage } from '@google-cloud/storage';

interface GoogleWordLike {
  word?: string;
  startOffset?: unknown;
  endOffset?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  speakerLabel?: unknown;
  speakerTag?: unknown;
  channelTag?: unknown;
}

interface GoogleAltLike {
  transcript?: string;
  words?: GoogleWordLike[];
}

interface GoogleResultLike {
  channelTag?: unknown;
  alternatives?: GoogleAltLike[];
}

interface GoogleResponseLike {
  results?: GoogleResultLike[];
  totalBilledDuration?: unknown;
}

interface GoogleSpeechClientLike {
  recognize: (request: Record<string, unknown>) => Promise<unknown>;
}

export interface GoogleSttConfig {
  projectId: string;
  location: string;
  recognizer?: string;
  languageCodes?: string[];
  model?: string;
  gcsStagingBucket: string;
  gcsStagingPrefix?: string;
}

export interface GoogleSttDependencies {
  speechClientFactory?: (config: GoogleSttConfig) => GoogleSpeechClientLike;
  storageClientFactory?: (config: GoogleSttConfig) => {
    bucket: (name: string) => {
      file: (name: string) => {
        save: (data: Buffer, options?: Record<string, unknown>) => Promise<void>;
      };
    };
  };
  now?: () => Date;
}

export function createGoogleSttProvider(
  deps: GoogleSttDependencies = {},
): SttProviderAdapter<GoogleSttConfig> {
  const speechClientFactory = deps.speechClientFactory ?? defaultSpeechClientFactory;
  const storageClientFactory = deps.storageClientFactory ?? defaultStorageClientFactory;
  const now = deps.now ?? (() => new Date());

  return {
    id: 'google',
    validateConfig(config) {
      if (!config || typeof config !== 'object') {
        throw new Error('Google STT config is required.');
      }
      const typed = config as GoogleSttConfig;
      if (!typed.projectId?.trim()) {
        throw new Error('GOOGLE_STT_PROJECT_ID is required when STT_PROVIDER=google');
      }
      if (!typed.location?.trim()) {
        throw new Error('GOOGLE_STT_LOCATION is required when STT_PROVIDER=google');
      }
      if (!typed.gcsStagingBucket?.trim()) {
        throw new Error('GOOGLE_STT_GCS_STAGING_BUCKET is required when STT_PROVIDER=google');
      }
    },
    classifyProviderError(error) {
      const details = getErrorDetails(error);
      return classifyProviderRuntimeFailure({
        provider: 'google',
        message: details.message,
        status: details.status,
        code: details.code,
        name: details.name,
        rules: {
          byProvider: {
            google: {
              timeoutStatusMin: 500,
            },
          },
        },
      });
    },
    async transcribe({ context, config }) {
      const speechClient = speechClientFactory(config);
      const storageClient = storageClientFactory(config);
      const inputUri = await resolveGoogleInputUri({
        context,
        config,
        storageClient,
        now,
      });

      const recognizer = config.recognizer?.trim() || buildDefaultRecognizer(config);
      const languageCodes = config.languageCodes?.filter(Boolean) ?? ['en-US'];
      const model = config.model?.trim() || 'latest_long';

      let primaryError: unknown;

      try {
        const response = resolveRecognizeResponse(
          await speechClient.recognize({
            recognizer,
            config: {
              autoDecodingConfig: {},
              languageCodes,
              model,
              features: {
                enableWordTimeOffsets: true,
                multiChannelMode: 'SEPARATE_RECOGNITION_PER_CHANNEL',
              },
            } as Record<string, unknown>,
            uri: inputUri,
          }),
        );
        const primaryParsed = parseGoogleResponse(response);
        const channelCount = countDistinctChannels(primaryParsed.segments);

        if (channelCount > 1 && primaryParsed.segments.length > 0) {
          return {
            provider: 'google',
            model,
            language: languageCodes[0] ?? 'auto',
            text: primaryParsed.text,
            segments: primaryParsed.segments,
            rawResponse: response,
            fallbackUsed: false,
            summary: {
              segmentCount: primaryParsed.segments.length,
              fallbackUsed: false,
              channels: channelCount,
              totalBilledDuration: response.totalBilledDuration ?? null,
            },
          };
        }
      } catch (error) {
        primaryError = error;
      }

      try {
        const fallbackResponse = resolveRecognizeResponse(
          await speechClient.recognize({
            recognizer,
            config: {
              autoDecodingConfig: {},
              languageCodes,
              model,
              features: {
                enableWordTimeOffsets: true,
                diarizationConfig: {
                  minSpeakerCount: 2,
                  maxSpeakerCount: 2,
                },
              },
            } as Record<string, unknown>,
            uri: inputUri,
          }),
        );

        const fallbackParsed = parseGoogleResponse(fallbackResponse);
        return {
          provider: 'google',
          model,
          language: languageCodes[0] ?? 'auto',
          text: fallbackParsed.text,
          segments: fallbackParsed.segments,
          rawResponse: fallbackResponse,
          fallbackUsed: true,
          summary: {
            segmentCount: fallbackParsed.segments.length,
            fallbackUsed: true,
            channels: countDistinctChannels(fallbackParsed.segments),
            totalBilledDuration: fallbackResponse.totalBilledDuration ?? null,
          },
        };
      } catch (fallbackError) {
        throw asError(fallbackError ?? primaryError, 'Google STT transcription failed');
      }
    },
  };
}

function defaultSpeechClientFactory(config: GoogleSttConfig) {
  return new SpeechClient({
    projectId: config.projectId,
    apiEndpoint: `${config.location}-speech.googleapis.com`,
  }) as unknown as GoogleSpeechClientLike;
}

function defaultStorageClientFactory(config: GoogleSttConfig) {
  return new Storage({
    projectId: config.projectId,
  });
}

function buildDefaultRecognizer(config: GoogleSttConfig): string {
  return `projects/${config.projectId}/locations/${config.location}/recognizers/_`;
}

async function resolveGoogleInputUri(args: {
  context: {
    storageUri: string;
    recordingId: string;
    getStream: () => Promise<Readable>;
  };
  config: GoogleSttConfig;
  storageClient: {
    bucket: (name: string) => {
      file: (name: string) => {
        save: (data: Buffer, options?: Record<string, unknown>) => Promise<void>;
      };
    };
  };
  now: () => Date;
}): Promise<string> {
  if (args.context.storageUri.startsWith('gs://')) {
    return args.context.storageUri;
  }

  if (!args.config.gcsStagingBucket?.trim()) {
    throw new Error('GOOGLE_STT_GCS_STAGING_BUCKET is required for non-gs:// audio URIs.');
  }

  const buffer = await readStreamToBuffer(await args.context.getStream());
  const prefix = args.config.gcsStagingPrefix?.trim() || 'stt-staging';
  const objectName = `${prefix}/${args.context.recordingId}-${args.now().getTime()}.audio`;

  await args.storageClient
    .bucket(args.config.gcsStagingBucket)
    .file(objectName)
    .save(buffer, {
      resumable: false,
      contentType: 'application/octet-stream',
    });

  return `gs://${args.config.gcsStagingBucket}/${objectName}`;
}

async function readStreamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  stream.destroy();
  return Buffer.concat(chunks);
}

function countDistinctChannels(segments: TranscriptSegment[]): number {
  const channels = new Set<number>();
  for (const segment of segments) {
    channels.add(segment.speaker ?? 0);
  }
  return channels.size;
}

function resolveRecognizeResponse(value: unknown): GoogleResponseLike {
  if (!value) return {};
  if (Array.isArray(value)) {
    const first = value[0];
    if (first && typeof first === 'object') {
      return first as GoogleResponseLike;
    }
    return {};
  }
  if (typeof value === 'object') {
    return value as GoogleResponseLike;
  }
  return {};
}

function parseGoogleResponse(response: GoogleResponseLike): {
  text: string;
  segments: TranscriptSegment[];
} {
  const results = Array.isArray(response.results) ? response.results : [];
  const words: {
    text: string;
    speaker?: number;
    start?: number;
    end?: number;
  }[] = [];

  for (const result of results) {
    const channelTag = toFiniteNumber(result.channelTag);
    const alt = result.alternatives?.[0];
    const altWords = Array.isArray(alt?.words) ? alt.words : [];
    for (const word of altWords) {
      const text = (word.word ?? '').trim();
      if (!text) continue;
      const speakerTag =
        toFiniteNumber(word.speakerTag) ?? toSpeakerIdFromLabel(word.speakerLabel) ?? channelTag;
      words.push({
        text,
        speaker: speakerTag,
        start: parseDurationLike(word.startOffset ?? word.startTime),
        end: parseDurationLike(word.endOffset ?? word.endTime),
      });
    }
  }

  const segments = buildSegments(words);
  const text = segments.map((segment) => segment.text).join(' ').trim();
  return { text, segments };
}

function buildSegments(
  words: {
    text: string;
    speaker?: number;
    start?: number;
    end?: number;
  }[],
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;

  for (const word of words) {
    if (!current || current.speaker !== word.speaker) {
      if (current) {
        segments.push(current);
      }
      current = {
        text: word.text,
        speaker: word.speaker,
        start: word.start,
        end: word.end,
      };
      continue;
    }

    current.text = `${current.text} ${word.text}`.trim();
    if (typeof word.end === 'number') {
      current.end = word.end;
    }
  }

  if (current) {
    segments.push(current);
  }

  return mergeSegments(segments);
}

function parseDurationLike(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return undefined;
    if (normalized.endsWith('s')) {
      const parsed = Number.parseFloat(normalized.slice(0, -1));
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  if (value && typeof value === 'object') {
    const secondsRaw = (value as { seconds?: unknown }).seconds;
    const nanosRaw = (value as { nanos?: unknown }).nanos;
    const seconds = toFiniteNumber(secondsRaw) ?? 0;
    const nanos = toFiniteNumber(nanosRaw) ?? 0;
    return seconds + nanos / 1_000_000_000;
  }

  return undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toSpeakerIdFromLabel(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /(\d+)$/.exec(value);
  if (!match?.[1]) return undefined;
  return Number.parseInt(match[1], 10);
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
