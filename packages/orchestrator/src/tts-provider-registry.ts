import { getRegisteredTtsProvider, registerTtsProvider } from '@esl-pipeline/tts-core';
import { createElevenLabsTtsProvider } from '@esl-pipeline/tts-provider-elevenlabs';
import { createGoogleTtsProvider } from '@esl-pipeline/tts-provider-google';
import { createInworldTtsProvider } from '@esl-pipeline/tts-provider-inworld';

let ttsProvidersRegistered = false;

export function ensureTtsProvidersRegistered(): void {
  if (ttsProvidersRegistered) return;
  if (!getRegisteredTtsProvider('elevenlabs')) {
    registerTtsProvider(createElevenLabsTtsProvider());
  }
  if (!getRegisteredTtsProvider('google')) {
    registerTtsProvider(createGoogleTtsProvider());
  }
  if (!getRegisteredTtsProvider('inworld')) {
    registerTtsProvider(createInworldTtsProvider());
  }
  ttsProvidersRegistered = true;
}
