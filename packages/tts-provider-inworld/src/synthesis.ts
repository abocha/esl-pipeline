import { writeFile } from 'node:fs/promises';
import { ApiError, MissingApiKeyError, NetworkError } from '@inworld/tts';

import { InfrastructureError, type VoiceProviderErrorCategory } from '@esl-pipeline/contracts';
import { runProviderFallbackLadder } from '@esl-pipeline/provider-runtime';
import type { InworldTtsModel, SpeechDeliveryMode } from '@esl-pipeline/tts-core';

import { createInworldClientProvider, type InworldClientProvider } from './client.js';

const DEFAULT_SAMPLE_RATE_HERTZ = 48_000;
const DEFAULT_MAX_RETRIES = 2;

class InworldSynthesisRuntimeError extends InfrastructureError {
  readonly category: VoiceProviderErrorCategory;
  readonly retryable: boolean;

  constructor(args: { message: string; category: VoiceProviderErrorCategory; retryable: boolean }) {
    super(args.message);
    this.name = 'InworldSynthesisRuntimeError';
    this.category = args.category;
    this.retryable = args.retryable;
  }
}

export function resolveInworldSampleRateHertz(): number {
  const raw = process.env.ESL_TTS_PROVIDER_INWORLD_SAMPLE_RATE_HERTZ;
  if (!raw) return DEFAULT_SAMPLE_RATE_HERTZ;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SAMPLE_RATE_HERTZ;
  return Math.floor(parsed);
}

function resolveInworldMaxRetries(): number {
  const raw = process.env.ESL_TTS_PROVIDER_INWORLD_RETRY_MAX;
  if (!raw) return DEFAULT_MAX_RETRIES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MAX_RETRIES;
  return Math.floor(parsed);
}

function classifyInworldStatus(status: number | null | undefined): VoiceProviderErrorCategory {
  if (status === 400 || status === 404) return 'invalid_voice_id';
  if (status === 408 || status === 504) return 'provider_timeout';
  if (status === 429) return 'provider_rate_limit';
  return 'provider_contract_error';
}

export function classifyInworldTtsProviderError(error: unknown): VoiceProviderErrorCategory {
  if (error instanceof MissingApiKeyError) return 'provider_contract_error';
  if (error instanceof NetworkError) return 'provider_timeout';
  if (error instanceof ApiError) return classifyInworldStatus(error.code);
  return 'provider_contract_error';
}

function mapInworldSynthesisRuntimeError(
  error: unknown,
  context: { voiceId: string; text: string },
): InworldSynthesisRuntimeError {
  if (error instanceof InworldSynthesisRuntimeError) return error;
  const category = classifyInworldTtsProviderError(error);
  const retryable = category === 'provider_rate_limit' || category === 'provider_timeout';
  const message = error instanceof Error ? error.message : String(error);
  return new InworldSynthesisRuntimeError({
    category,
    retryable,
    message:
      `Failed to synthesize line with Inworld voice "${context.voiceId}" ` +
      `[${category}]: ${message}\nLine: ${context.text}`,
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function synthesizeInworldSpeech(
  text: string,
  voiceId: string,
  options: {
    model: InworldTtsModel;
    speakingRate?: number;
    temperature?: number;
    deliveryMode?: SpeechDeliveryMode;
    sampleRateHertz?: number;
    language?: string;
  },
  dependencies: { clientProvider?: InworldClientProvider } = {},
): Promise<Buffer> {
  const client = (dependencies.clientProvider ?? createInworldClientProvider()).get();
  const audio = await client.generate({
    text,
    voice: voiceId,
    model: options.model,
    encoding: 'MP3',
    sampleRate: options.sampleRateHertz ?? resolveInworldSampleRateHertz(),
    ...(options.speakingRate !== undefined ? { speakingRate: options.speakingRate } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.deliveryMode !== undefined ? { deliveryMode: options.deliveryMode } : {}),
    ...(options.language !== undefined ? { language: options.language } : {}),
  });
  return Buffer.from(audio);
}

export async function synthesizeInworldChunkWithRetry(
  text: string,
  voiceId: string,
  outFile: string,
  options: {
    model: InworldTtsModel;
    speakingRate?: number;
    temperature?: number;
    deliveryMode?: SpeechDeliveryMode;
    sampleRateHertz?: number;
    language?: string;
  },
  dependencies: { clientProvider?: InworldClientProvider } = {},
): Promise<void> {
  const candidate = { text, voiceId, outFile };
  let backoffAttempt = 0;
  await runProviderFallbackLadder<typeof candidate, void, InworldSynthesisRuntimeError>({
    candidates: [candidate],
    runCandidate: async (current) => {
      const audio = await synthesizeInworldSpeech(
        current.text,
        current.voiceId,
        options,
        dependencies,
      );
      await writeFile(current.outFile, audio);
    },
    mapError: (current, error) => mapInworldSynthesisRuntimeError(error, current),
    isTimeoutError: (mappedError) => mappedError.retryable,
    isFailFastError: (mappedError) => !mappedError.retryable,
    getRetryMax: () => resolveInworldMaxRetries(),
    getRetryBackoffMs: () => {
      const backoffMs = 400 * Math.pow(2, backoffAttempt);
      backoffAttempt += 1;
      return backoffMs;
    },
    sleep: wait,
  });
}
