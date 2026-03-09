import textToSpeech from '@google-cloud/text-to-speech';

type TextToSpeechClient = InstanceType<typeof textToSpeech.TextToSpeechClient>;

const clientCache = new Map<string, TextToSpeechClient>();

export interface GoogleTtsClientOptions {
  apiEndpoint?: string;
}

export interface GoogleSynthesizeSpeechRequest {
  text: string;
  voiceName: string;
  languageCode: string;
  modelName?: string;
}

export interface GoogleVoiceListEntry {
  name: string;
  languageCodes: string[];
  ssmlGender?: string;
}

function buildCacheKey(options?: GoogleTtsClientOptions): string {
  return options?.apiEndpoint?.trim() || 'default';
}

export function getGoogleTtsClient(options?: GoogleTtsClientOptions): TextToSpeechClient {
  const cacheKey = buildCacheKey(options);
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  const client = new textToSpeech.TextToSpeechClient(
    options?.apiEndpoint?.trim() ? { apiEndpoint: options.apiEndpoint.trim() } : undefined,
  );
  clientCache.set(cacheKey, client);
  return client;
}

function normalizeAudioContent(audioContent: unknown): Buffer {
  if (audioContent instanceof Uint8Array) {
    return Buffer.from(audioContent);
  }
  if (typeof audioContent === 'string') {
    return Buffer.from(audioContent, 'base64');
  }
  if (Array.isArray(audioContent)) {
    return Buffer.from(audioContent);
  }
  throw new Error('Google TTS response did not include audioContent.');
}

export async function synthesizeGoogleSpeech(
  request: GoogleSynthesizeSpeechRequest,
  options?: GoogleTtsClientOptions,
): Promise<Buffer> {
  const client = getGoogleTtsClient(options);
  const [response] = await client.synthesizeSpeech({
    input: { text: request.text },
    voice: {
      name: request.voiceName,
      languageCode: request.languageCode,
      modelName: request.modelName,
    },
    audioConfig: { audioEncoding: 'MP3' },
  });

  return normalizeAudioContent(response.audioContent);
}

export async function listGoogleVoices(
  options?: GoogleTtsClientOptions,
): Promise<GoogleVoiceListEntry[]> {
  const client = getGoogleTtsClient(options);
  const [response] = await client.listVoices({});
  const rawVoices = Array.isArray(response.voices) ? response.voices : [];
  const voices: GoogleVoiceListEntry[] = [];
  for (const voice of rawVoices) {
    const name = typeof voice.name === 'string' ? voice.name.trim() : '';
    if (!name) continue;
    const languageCodes = Array.isArray(voice.languageCodes)
      ? voice.languageCodes
        .map((code) => (typeof code === 'string' ? code.trim() : ''))
        .filter((code) => code.length > 0)
      : [];
    const ssmlGender =
      typeof voice.ssmlGender === 'string' ? voice.ssmlGender.trim() : String(voice.ssmlGender ?? '').trim();
    voices.push({
      name,
      languageCodes,
      ssmlGender: ssmlGender.length > 0 ? ssmlGender : undefined,
    });
  }
  return voices;
}
