import { InworldTTS, type ClientOptions, type GenerateOptions, type VoiceInfo } from '@inworld/tts';

import { ConfigurationError } from '@esl-pipeline/contracts';

export interface InworldClientAdapter {
  listVoices(): Promise<VoiceInfo[]>;
  generate(options: GenerateOptions): Promise<Uint8Array>;
}

export type InworldClientFactory = (options: ClientOptions) => InworldClientAdapter;

export interface InworldClientProvider {
  get(): InworldClientAdapter;
  isConfigured(): boolean;
}

export interface InworldClientProviderOptions {
  apiKey?: string;
  timeoutMs?: number;
  sdkFactory?: InworldClientFactory;
}

export function resolveInworldApiKey(): string | undefined {
  return (
    process.env.ESL_TTS_PROVIDER_INWORLD_API_KEY?.trim() ||
    process.env.INWORLD_API_KEY?.trim() ||
    undefined
  );
}

export function resolveInworldTimeoutMs(): number | undefined {
  const raw = process.env.ESL_TTS_PROVIDER_INWORLD_TIMEOUT_MS;
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

export function createInworldClientProvider(
  options: InworldClientProviderOptions = {},
): InworldClientProvider {
  let client: InworldClientAdapter | undefined;
  const resolveApiKey = () => options.apiKey?.trim() || resolveInworldApiKey();

  return {
    isConfigured() {
      return Boolean(resolveApiKey());
    },
    get() {
      if (client) return client;
      const apiKey = resolveApiKey();
      if (!apiKey) {
        throw new ConfigurationError(
          'Inworld TTS requires ESL_TTS_PROVIDER_INWORLD_API_KEY or INWORLD_API_KEY.',
        );
      }
      const timeout = options.timeoutMs ?? resolveInworldTimeoutMs();
      client = (options.sdkFactory ?? InworldTTS)({
        apiKey,
        maxRetries: 0,
        ...(timeout ? { timeout } : {}),
      });
      return client;
    },
  };
}
