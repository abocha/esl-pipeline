import { createClient } from '@deepgram/sdk';

export interface DeepgramClientConfig {
  apiKey?: string | null;
  accessToken?: string | null;
}

export function createDeepgramClient(config: DeepgramClientConfig) {
  if (config.accessToken) {
    return createClient({ accessToken: config.accessToken });
  }
  if (config.apiKey) {
    return createClient(config.apiKey);
  }
  return createClient();
}
