import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { ApiError, MissingApiKeyError, NetworkError } from '@inworld/tts';

import { InfrastructureError, type VoiceProviderErrorCategory } from '@esl-pipeline/contracts';
import {
  type InworldTtsModel,
  type SpeechDeliveryMode,
  throwIfTtsCancelled,
  type TtsRequestControl,
  TtsSynthesisCancelledError,
} from '@esl-pipeline/tts-core';

import {
  createInworldClientProvider,
  type InworldClientAdapter,
  type InworldClientProvider,
} from './client.js';

const DEFAULT_SAMPLE_RATE_HERTZ = 48_000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_MAX_RETRIES = 3;
const RETRY_BACKOFF_BASE_MS = [1000, 2000, 4000] as const;

export type InworldFailureKind =
  | 'caller_cancelled'
  | 'rate_limit'
  | 'timeout'
  | 'transient_network'
  | 'server'
  | 'auth'
  | 'permission'
  | 'invalid_request'
  | 'invalid_voice'
  | 'unknown';

export interface InworldFailure {
  kind: InworldFailureKind;
  retryable: boolean;
  status?: number;
  providerCode?: string;
  causeName?: string;
}

export interface InworldRetryDependencies {
  sleep(ms: number): Promise<void>;
  random(): number;
  now(): number;
}

interface InworldSynthesisOptions extends TtsRequestControl {
  model: InworldTtsModel;
  speakingRate?: number;
  temperature?: number;
  deliveryMode?: SpeechDeliveryMode;
  sampleRateHertz?: number;
  language?: string;
}

export class InworldSynthesisRuntimeError extends InfrastructureError {
  readonly category: VoiceProviderErrorCategory;
  readonly retryable: boolean;
  readonly provider = 'inworld';
  readonly model: InworldTtsModel;
  readonly voiceId: string;
  readonly language?: string;
  readonly contentHash: string;
  readonly characterCount: number;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly failure: InworldFailure;

  constructor(args: {
    model: InworldTtsModel;
    voiceId: string;
    language?: string;
    contentHash: string;
    characterCount: number;
    attempts: number;
    maxAttempts: number;
    failure: InworldFailure;
  }) {
    const category = mapInworldFailureToPublicCategory(args.failure);
    super(
      `Inworld TTS synthesis failed [${category}] ` +
        `(model=${args.model}, voiceId=${args.voiceId}, contentHash=${args.contentHash}, ` +
        `characterCount=${args.characterCount}, attempts=${args.attempts}/${args.maxAttempts}, ` +
        `failureKind=${args.failure.kind}${args.failure.status ? `, status=${args.failure.status}` : ''}).`,
    );
    this.name = 'InworldSynthesisRuntimeError';
    this.category = category;
    this.retryable = args.failure.retryable;
    this.model = args.model;
    this.voiceId = args.voiceId;
    this.language = args.language;
    this.contentHash = args.contentHash;
    this.characterCount = args.characterCount;
    this.attempts = args.attempts;
    this.maxAttempts = args.maxAttempts;
    this.failure = args.failure;
  }
}

export function resolveInworldSampleRateHertz(): number {
  const raw = process.env.ESL_TTS_PROVIDER_INWORLD_SAMPLE_RATE_HERTZ;
  if (!raw) return DEFAULT_SAMPLE_RATE_HERTZ;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SAMPLE_RATE_HERTZ;
  return Math.floor(parsed);
}

function clampMaxRetries(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_RETRIES;
  return Math.min(MAX_MAX_RETRIES, Math.max(0, Math.floor(value)));
}

function resolveInworldMaxRetries(): number {
  const raw = process.env.ESL_TTS_PROVIDER_INWORLD_RETRY_MAX;
  if (!raw) return DEFAULT_MAX_RETRIES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clampMaxRetries(parsed) : DEFAULT_MAX_RETRIES;
}

function readStringField(value: unknown, field: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = Reflect.get(value, field);
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

function readProviderCode(error: ApiError): string | undefined {
  return readStringField(error.details, 'code') ?? readStringField(error.details, 'errorCode');
}

function isInvalidVoiceCode(code: string | undefined): boolean {
  return Boolean(code && /(?:voice.*(?:invalid|not[_ -]?found)|invalid.*voice)/i.test(code));
}

function readCause(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? Reflect.get(error, 'cause') : undefined;
}

function readCausalCode(error: unknown): string | undefined {
  return readStringField(error, 'code') ?? readStringField(readCause(error), 'code');
}

function readCauseName(error: unknown): string | undefined {
  const cause = readCause(error);
  return readStringField(cause, 'name') ?? readStringField(error, 'name');
}

export function classifyInworldFailure(error: unknown): InworldFailure {
  if (error instanceof InworldSynthesisRuntimeError) return error.failure;
  if (error instanceof MissingApiKeyError) {
    return { kind: 'auth', retryable: false, causeName: error.name };
  }
  if (error instanceof ApiError) {
    const status = error.code ?? undefined;
    const providerCode = readProviderCode(error);
    const common = {
      ...(status !== undefined ? { status } : {}),
      ...(providerCode ? { providerCode } : {}),
      causeName: error.name,
    };
    if (isInvalidVoiceCode(providerCode)) {
      return { kind: 'invalid_voice', retryable: false, ...common };
    }
    if (status === 408) return { kind: 'timeout', retryable: true, ...common };
    if (status === 429) return { kind: 'rate_limit', retryable: true, ...common };
    if (status !== undefined && status >= 500 && status <= 599) {
      return { kind: 'server', retryable: true, ...common };
    }
    if (status === 401) return { kind: 'auth', retryable: false, ...common };
    if (status === 403) return { kind: 'permission', retryable: false, ...common };
    if (status !== undefined && status >= 400 && status <= 499) {
      return { kind: 'invalid_request', retryable: false, ...common };
    }
    return { kind: 'unknown', retryable: false, ...common };
  }
  if (error instanceof NetworkError) {
    return { kind: 'transient_network', retryable: true, causeName: error.name };
  }

  const code = readCausalCode(error)?.toUpperCase();
  const causeName = readCauseName(error);
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return { kind: 'timeout', retryable: true, ...(causeName ? { causeName } : {}) };
  }
  if (
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    code === 'ECONNABORTED' ||
    code === 'UND_ERR_SOCKET'
  ) {
    return { kind: 'transient_network', retryable: true, ...(causeName ? { causeName } : {}) };
  }

  const message = error instanceof Error ? error.message.toLowerCase().slice(0, 240) : '';
  if (/\b(?:timed? out|timeout)\b/.test(message)) {
    return { kind: 'timeout', retryable: true, ...(causeName ? { causeName } : {}) };
  }
  if (/\b(?:connection reset|socket hang up|transient disconnect)\b/.test(message)) {
    return { kind: 'transient_network', retryable: true, ...(causeName ? { causeName } : {}) };
  }
  return { kind: 'unknown', retryable: false, ...(causeName ? { causeName } : {}) };
}

function mapInworldFailureToPublicCategory(failure: InworldFailure): VoiceProviderErrorCategory {
  if (failure.kind === 'invalid_voice') return 'invalid_voice_id';
  if (failure.kind === 'rate_limit') return 'provider_rate_limit';
  if (
    failure.kind === 'timeout' ||
    failure.kind === 'transient_network' ||
    failure.kind === 'server' ||
    failure.kind === 'caller_cancelled'
  ) {
    return 'provider_timeout';
  }
  return 'provider_contract_error';
}

export function classifyInworldTtsProviderError(error: unknown): VoiceProviderErrorCategory {
  if (error instanceof InworldSynthesisRuntimeError) return error.category;
  return mapInworldFailureToPublicCategory(classifyInworldFailure(error));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const defaultRetryDependencies: InworldRetryDependencies = {
  sleep: wait,
  random: Math.random,
  now: Date.now,
};

function buildGenerateOptions(text: string, voiceId: string, options: InworldSynthesisOptions) {
  return {
    text,
    voice: voiceId,
    model: options.model,
    encoding: 'MP3' as const,
    sampleRate: options.sampleRateHertz ?? resolveInworldSampleRateHertz(),
    ...(options.speakingRate !== undefined ? { speakingRate: options.speakingRate } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.deliveryMode !== undefined ? { deliveryMode: options.deliveryMode } : {}),
    ...(options.language !== undefined ? { language: options.language } : {}),
  };
}

function buildRuntimeError(args: {
  text: string;
  voiceId: string;
  options: InworldSynthesisOptions;
  language?: string;
  attempts: number;
  maxAttempts: number;
  failure: InworldFailure;
}): InworldSynthesisRuntimeError {
  return new InworldSynthesisRuntimeError({
    model: args.options.model,
    voiceId: args.voiceId,
    language: args.language ?? args.options.language,
    contentHash: createHash('sha256').update(args.text).digest('hex'),
    characterCount: args.text.length,
    attempts: args.attempts,
    maxAttempts: args.maxAttempts,
    failure: args.failure,
  });
}

export async function runInworldSynthesisWithRetry(args: {
  text: string;
  voiceId: string;
  options: InworldSynthesisOptions;
  language?: string;
  client: InworldClientAdapter;
  maxRetries?: number;
  deadlineAtMs?: number;
  signal?: AbortSignal;
  dependencies?: Partial<InworldRetryDependencies>;
}): Promise<Buffer> {
  const dependencies = { ...defaultRetryDependencies, ...args.dependencies };
  const maxRetries = clampMaxRetries(args.maxRetries ?? resolveInworldMaxRetries());
  const maxAttempts = maxRetries + 1;
  let attempts = 0;

  while (attempts < maxAttempts) {
    throwIfTtsCancelled(args, dependencies.now);
    attempts += 1;
    let audio: Uint8Array;
    try {
      audio = await args.client.generate(
        buildGenerateOptions(args.text, args.voiceId, args.options),
      );
    } catch (error) {
      if (error instanceof TtsSynthesisCancelledError) throw error;
      const failure = classifyInworldFailure(error);
      if (!failure.retryable || attempts >= maxAttempts) {
        throw buildRuntimeError({ ...args, attempts, maxAttempts, failure });
      }

      throwIfTtsCancelled(args, dependencies.now);
      const baseMs = RETRY_BACKOFF_BASE_MS[attempts - 1]!;
      const sample = Math.min(1, Math.max(0, dependencies.random()));
      const delayMs = Math.max(0, Math.round(baseMs * (0.8 + sample * 0.4)));
      throwIfTtsCancelled(args, () => dependencies.now() + delayMs);
      await dependencies.sleep(delayMs);
      throwIfTtsCancelled(args, dependencies.now);
      continue;
    }

    throwIfTtsCancelled(args, dependencies.now);
    return Buffer.from(audio);
  }

  throw new Error('Unreachable Inworld retry state');
}

export async function synthesizeInworldSpeech(
  text: string,
  voiceId: string,
  options: InworldSynthesisOptions,
  dependencies: { clientProvider?: InworldClientProvider } = {},
): Promise<Buffer> {
  const client = (dependencies.clientProvider ?? createInworldClientProvider()).get();
  return runInworldSynthesisWithRetry({
    text,
    voiceId,
    options,
    client,
    maxRetries: 0,
    signal: options.signal,
    deadlineAtMs: options.deadlineAtMs,
  });
}

export async function synthesizeInworldChunkWithRetry(
  text: string,
  voiceId: string,
  outFile: string,
  options: InworldSynthesisOptions,
  dependencies: {
    clientProvider?: InworldClientProvider;
    retry?: Partial<InworldRetryDependencies>;
  } = {},
): Promise<void> {
  const client = (dependencies.clientProvider ?? createInworldClientProvider()).get();
  const audio = await runInworldSynthesisWithRetry({
    text,
    voiceId,
    options,
    client,
    signal: options.signal,
    deadlineAtMs: options.deadlineAtMs,
    dependencies: dependencies.retry,
  });
  await writeFile(outFile, audio);
}
