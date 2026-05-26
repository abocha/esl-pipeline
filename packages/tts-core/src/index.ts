import { createTtsEngine } from './engine.js';
import type {
  BuildPronunciationShadowSentenceInput,
  BuildPronunciationShadowSentenceOptions,
  BuildPronunciationShadowSentenceResult,
  BuildPronunciationTextInput,
  BuildPronunciationTextOptions,
  BuildPronunciationTextResult,
  BuildStudyTextInput,
  BuildStudyTextOptions,
  BuildStudyTextResult,
  TtsEngine,
  TtsProviderAdapter,
  TtsProviderId,
  VoiceCatalog,
} from './types.js';

let defaultEngine: TtsEngine = createTtsEngine();

export function configureTtsEngine(engine: TtsEngine): void {
  defaultEngine = engine;
}

export function registerTtsProviders(providers: TtsProviderAdapter[]): void {
  defaultEngine.registerProviders(providers);
}

export function registerTtsProvider(provider: TtsProviderAdapter): void {
  defaultEngine.registerProvider(provider);
}

export function getRegisteredTtsProvider(id: TtsProviderId): TtsProviderAdapter | undefined {
  return defaultEngine.getProvider(id);
}

export async function buildStudyTextMp3(
  input: BuildStudyTextInput,
  options: BuildStudyTextOptions,
): Promise<BuildStudyTextResult> {
  return defaultEngine.buildStudyTextMp3(input, options);
}

export async function buildPronunciationShadowSentenceMp3(
  input: BuildPronunciationShadowSentenceInput,
  options: BuildPronunciationShadowSentenceOptions,
): Promise<BuildPronunciationShadowSentenceResult> {
  return defaultEngine.buildPronunciationShadowSentenceMp3(input, options);
}

export async function buildPronunciationTextMp3(
  input: BuildPronunciationTextInput,
  options: BuildPronunciationTextOptions,
): Promise<BuildPronunciationTextResult> {
  return defaultEngine.buildPronunciationTextMp3(input, options);
}

export async function loadVoicesCatalog(provider?: TtsProviderId): Promise<VoiceCatalog> {
  return defaultEngine.loadVoicesCatalog(provider);
}

export {
  buildDefaultTtsModelByProvider,
  buildTtsModelOptionsByProvider,
  ELEVENLABS_TTS_DESCRIPTOR,
  ELEVENLABS_TTS_MODELS,
  GOOGLE_TTS_DESCRIPTOR,
  GOOGLE_TTS_MODELS,
  getTtsProviderDescriptor,
  getTtsProviderDescriptors,
  INWORLD_TTS_DESCRIPTOR,
  INWORLD_TTS_MODELS,
  isTtsModelForProvider,
  parseTtsModelId,
  parseTtsProviderId,
  resolveDefaultTtsModel,
  resolveDefaultTtsProvider,
  resolveTtsProviderOrder,
  resolveTtsSelection,
  TTS_PROVIDER_DESCRIPTORS,
  validateTtsSelection,
} from './descriptors.js';
export { createTtsEngine } from './engine.js';
export { hashStudyText } from './hash.js';
export type {
  BuildPronunciationShadowSentenceInput,
  BuildPronunciationShadowSentenceOptions,
  BuildPronunciationShadowSentenceResult,
  BuildPronunciationTextInput,
  BuildPronunciationTextOptions,
  BuildPronunciationTextResult,
  BuildStudyTextInput,
  BuildStudyTextOptions,
  BuildStudyTextResult,
  ElevenLabsTtsModelId,
  GoogleTtsModel,
  InworldTtsModel,
  SpeakerVoiceAssignment,
  TtsEngine,
  TtsModelId,
  TtsProviderAdapter,
  TtsProviderDescriptor,
  TtsProviderId,
  TtsSelection,
  TtsStrategy,
  Voice,
  VoiceCatalog,
  VoiceProviderAdapter,
  VoiceSelectionSummary,
} from './types.js';
