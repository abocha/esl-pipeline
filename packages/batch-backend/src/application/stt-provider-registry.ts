import { getRegisteredSttProvider, registerSttProvider } from '@esl-pipeline/stt-core';
import { createDeepgramSttProvider } from '@esl-pipeline/stt-provider-deepgram';
import { createElevenLabsSttProvider } from '@esl-pipeline/stt-provider-elevenlabs';
import { createGoogleSttProvider } from '@esl-pipeline/stt-provider-google';

let sttProvidersRegistered = false;

export function ensureSttProvidersRegistered(): void {
  if (sttProvidersRegistered) return;

  if (!getRegisteredSttProvider('deepgram')) {
    registerSttProvider(createDeepgramSttProvider());
  }
  if (!getRegisteredSttProvider('elevenlabs')) {
    registerSttProvider(createElevenLabsSttProvider());
  }
  if (!getRegisteredSttProvider('google')) {
    registerSttProvider(createGoogleSttProvider());
  }

  sttProvidersRegistered = true;
}
