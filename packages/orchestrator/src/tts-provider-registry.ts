import { getRegisteredTtsProvider, registerTtsProvider } from '@esl-pipeline/tts-core';
import { createElevenLabsTtsProvider } from '@esl-pipeline/tts-provider-elevenlabs';
import { createGoogleTtsProvider } from '@esl-pipeline/tts-provider-google';

let ttsProvidersRegistered = false;

export function ensureTtsProvidersRegistered(): void {
  if (ttsProvidersRegistered) return;
  if (!getRegisteredTtsProvider('elevenlabs')) {
    registerTtsProvider(createElevenLabsTtsProvider());
  }
  if (!getRegisteredTtsProvider('google')) {
    registerTtsProvider(createGoogleTtsProvider());
  }
  ttsProvidersRegistered = true;
}
