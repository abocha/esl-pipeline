import { createTtsEngine } from './engine.js';
import type {
  BuildPronunciationShadowSentenceInput,
  BuildPronunciationShadowSentenceOptions,
  BuildPronunciationShadowSentenceResult,
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

export async function loadVoicesCatalog(provider?: TtsProviderId): Promise<VoiceCatalog> {
  return defaultEngine.loadVoicesCatalog(provider);
}

export { hashStudyText } from './hash.js';

export { createTtsEngine } from './engine.js';
export type {
  BuildPronunciationShadowSentenceInput,
  BuildPronunciationShadowSentenceOptions,
  BuildPronunciationShadowSentenceResult,
  BuildStudyTextInput,
  BuildStudyTextOptions,
  BuildStudyTextResult,
  GoogleTtsModel,
  SpeakerVoiceAssignment,
  TtsEngine,
  TtsProviderAdapter,
  TtsProviderId,
  TtsStrategy,
  Voice,
  VoiceCatalog,
  VoiceProviderAdapter,
  VoiceSelectionSummary,
} from './types.js';
