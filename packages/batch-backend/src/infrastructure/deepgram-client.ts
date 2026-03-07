import { DeepgramClient } from '@deepgram/sdk';

export interface DeepgramClientConfig {
  apiKey?: string | null;
  accessToken?: string | null;
}

export function createDeepgramClient(config: DeepgramClientConfig) {
  if (config.accessToken) {
    return new DeepgramClient({ accessToken: config.accessToken });
  }
  if (config.apiKey) {
    return new DeepgramClient({ apiKey: config.apiKey });
  }
  return new DeepgramClient();
}
