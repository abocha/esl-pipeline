import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const clientCache = new Map<string, ElevenLabsClient>();

export function getElevenClient() {
  const apiKey = process.env.ESL_TTS_PROVIDER_ELEVENLABS_API_KEY || process.env.ESL_TTS_PROVIDER_ELEVENLABS_API_TOKEN;
  if (!apiKey) throw new Error('Missing ESL_TTS_PROVIDER_ELEVENLABS_API_KEY');
  const cached = clientCache.get(apiKey);
  if (cached) return cached;
  const client = new ElevenLabsClient({ apiKey });
  clientCache.set(apiKey, client);
  return client;
}
