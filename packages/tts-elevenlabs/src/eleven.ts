import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

export function getElevenClient() {
  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_TOKEN;
  if (!apiKey) throw new Error('Missing ELEVENLABS_API_KEY');
  return new ElevenLabsClient({ apiKey });
}
