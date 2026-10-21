import { GoogleAuth } from 'google-auth-library';

import type { PipelineLogger, VoiceProviderErrorCategory } from '@esl-pipeline/contracts';
import { ConfigurationError } from '@esl-pipeline/contracts';
import {
  type TtsRequestControl,
  TtsSynthesisCancelledError,
  throwIfTtsCancelled,
} from '@esl-pipeline/tts-core';

export interface GeminiPart {
  text: string;
  speechMetadata?: { speaker: string };
}
export interface GeminiRequest {
  contents: [{ role: 'user'; parts: GeminiPart[] }];
  generationConfig: {
    responseModalities: ['AUDIO'];
    speechConfig:
      | { voiceConfig: { voice: string } }
      | {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: { speaker: string; voiceConfig: { voice: string } }[];
          };
        };
  };
}

export class GeminiTtsError extends Error {
  constructor(
    readonly category: VoiceProviderErrorCategory,
    readonly status?: number,
  ) {
    super(`Gemini Cloud TTS ${category}${status ? ` (HTTP ${status})` : ''}.`);
    this.name = 'GeminiTtsError';
  }
}

export function resolveGeminiProjectId(explicit?: string): string {
  const project = explicit?.trim() || process.env.ESL_TTS_PROVIDER_GEMINI_PROJECT_ID?.trim();
  if (!project || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)) {
    throw new ConfigurationError(
      'Set ESL_TTS_PROVIDER_GEMINI_PROJECT_ID to an explicit Google Cloud project ID.',
    );
  }
  return project;
}

function resolveTimeout(explicit?: number): number {
  const value = explicit ?? Number(process.env.ESL_TTS_PROVIDER_GEMINI_TIMEOUT_MS || 180000);
  if (!Number.isFinite(value) || value < 1000 || value > 300000) {
    throw new ConfigurationError(
      'Gemini TTS timeout must be between 1000 and 300000 milliseconds.',
    );
  }
  return Math.floor(value);
}

function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Parse only complete PCM WAV output; reject truncation before ffmpeg can accept a partial file. */
export function validateGeminiWav(audio: Buffer): number {
  if (
    audio.length < 44 ||
    audio.toString('ascii', 0, 4) !== 'RIFF' ||
    audio.toString('ascii', 8, 12) !== 'WAVE' ||
    audio.readUInt32LE(4) + 8 !== audio.length
  ) {
    throw new GeminiTtsError('provider_contract_error');
  }
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= audio.length) {
    const id = audio.toString('ascii', offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    if (offset + 8 + size > audio.length) throw new GeminiTtsError('provider_contract_error');
    if (id === 'fmt ') {
      if (
        size < 16 ||
        audio.readUInt16LE(offset + 8) !== 1 ||
        audio.readUInt16LE(offset + 10) !== 1 ||
        audio.readUInt32LE(offset + 12) !== 24000 ||
        audio.readUInt16LE(offset + 22) !== 16
      ) {
        throw new GeminiTtsError('provider_contract_error');
      }
      byteRate = audio.readUInt32LE(offset + 16);
      if (byteRate !== 48000) throw new GeminiTtsError('provider_contract_error');
    }
    if (id === 'data') dataSize += size;
    offset += 8 + size + (size % 2);
  }
  if (offset !== audio.length || !byteRate || dataSize <= 0 || dataSize % 2 !== 0)
    throw new GeminiTtsError('provider_contract_error');
  return dataSize / byteRate;
}

export function createGeminiClient(options: { projectId?: string; timeoutMs?: number } = {}) {
  // GoogleAuth is lazy: catalog, preview and cache hits do not discover ADC or make auth calls.
  let auth: GoogleAuth | undefined;
  return {
    projectId: () => resolveGeminiProjectId(options.projectId),
    async synthesize(
      request: GeminiRequest,
      model: string,
      control: TtsRequestControl & { logger?: PipelineLogger },
    ): Promise<{ audio: Buffer; duration: number }> {
      throwIfTtsCancelled(control);
      const project = resolveGeminiProjectId(options.projectId);
      const timeout = Math.min(
        resolveTimeout(options.timeoutMs),
        control.deadlineAtMs === undefined ? Infinity : control.deadlineAtMs - Date.now(),
      );
      const signal = AbortSignal.any([
        AbortSignal.timeout(Math.max(1, timeout)),
        ...(control.signal ? [control.signal] : []),
      ]);
      const started = Date.now();
      try {
        auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
        let token: string | null | undefined;
        try {
          token = await bounded(auth.getAccessToken(), signal);
        } catch {
          if (signal.aborted) throw signal.reason;
          throw new ConfigurationError(
            'Gemini Cloud TTS could not obtain Application Default Credentials. Configure GOOGLE_APPLICATION_CREDENTIALS, workload identity, or local ADC.',
          );
        }
        throwIfTtsCancelled(control);
        if (!token) throw new ConfigurationError('Gemini Cloud TTS ADC returned no access token.');
        const response = await fetch(
          `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal,
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new GeminiTtsError(
            response.status === 429
              ? 'provider_rate_limit'
              : response.status === 408 || response.status >= 500
                ? 'provider_timeout'
                : 'provider_contract_error',
            response.status,
          );
        }
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        if (!response.body) throw new GeminiTtsError('provider_contract_error');
        const reader = response.body.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 48 * 1024 * 1024) {
            await reader.cancel();
            throw new GeminiTtsError('provider_contract_error');
          }
          chunks.push(value);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const candidates = body?.candidates;
        if (
          !Array.isArray(candidates) ||
          candidates.length !== 1 ||
          candidates[0]?.finishReason !== 'STOP'
        )
          throw new GeminiTtsError('provider_contract_error');
        const parts = candidates[0].content?.parts;
        const audioParts = Array.isArray(parts)
          ? parts.filter((part: { inlineData?: { data?: unknown } } | null) => part?.inlineData)
          : [];
        if (
          audioParts.length !== 1 ||
          audioParts[0].inlineData.mimeType !== 'audio/wav' ||
          typeof audioParts[0].inlineData.data !== 'string' ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(audioParts[0].inlineData.data)
        )
          throw new GeminiTtsError('provider_contract_error');
        const audio = Buffer.from(audioParts[0].inlineData.data, 'base64');
        const duration = validateGeminiWav(audio);
        throwIfTtsCancelled(control);
        const numeric = (value: unknown) =>
          typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
        const details = body.usageMetadata?.candidatesTokensDetails;
        const audioTokens = numeric(
          Array.isArray(details)
            ? details.find((detail: { modality?: string }) => detail.modality === 'AUDIO')
                ?.tokenCount
            : undefined,
        );
        const textInputTokens = numeric(body.usageMetadata?.promptTokenCount);
        control.logger?.log({
          level: 'info',
          stage: 'tts',
          message: 'Gemini Cloud TTS synthesis completed',
          detail: {
            provider: 'gemini',
            model,
            duration,
            elapsedMs: Date.now() - started,
            outputBytes: audio.length,
            audioOutputTokens: audioTokens,
            textInputTokens,
            pricingToken: 'GEMINI_TTS',
          },
        });
        return { audio, duration };
      } catch (error) {
        if (
          control.signal?.aborted ||
          (control.deadlineAtMs !== undefined && control.deadlineAtMs <= Date.now())
        )
          throw new TtsSynthesisCancelledError(control.signal?.reason ?? 'deadline_expired');
        if (signal.aborted) throw new GeminiTtsError('provider_timeout');
        if (error instanceof GeminiTtsError || error instanceof ConfigurationError) throw error;
        throw new GeminiTtsError(
          error instanceof SyntaxError ? 'provider_contract_error' : 'provider_timeout',
        );
      }
    },
  };
}
