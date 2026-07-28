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
  PreparedStudyTextSynthesis,
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

export async function prepareStudyTextSynthesis(
  input: BuildStudyTextInput,
  options: BuildStudyTextOptions,
): Promise<PreparedStudyTextSynthesis> {
  return defaultEngine.prepareStudyTextSynthesis(input, options);
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
  getTtsModelCapabilities,
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
export {
  throwIfTtsCancelled,
  TtsSynthesisCancelledError,
  type TtsRequestControl,
} from './errors.js';
export { hashStudyText } from './hash.js';
export { resolveSpeakerRoutingHint } from './speaker-routing.js';
export {
  createIdentitySpeechPerformancePlan,
  createPreparedStudyTextSynthesis,
  normalizeStudyTextSpeakerToken,
  SpeechPerformancePlannerInvalidOutputError,
  validateSpeechPerformancePlan,
} from './speech-plan.js';
export type {
  RenderedSpeechSegmentSummary,
  SpeechCueTextField,
  SpeechPlanCandidateAnalysis,
  SpeechPlanQualityIssue,
  SpeechPlanQualityMetrics,
  ValidatedSpeechPlanAnalysis,
} from './speech-plan-analysis.js';
export {
  analyzeSpeechPlanCandidate,
  analyzeValidatedSpeechPlan,
  assertSpeechPlanSafeForSynthesis,
  normalizeSpeechCueText,
} from './speech-plan-analysis.js';
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
  PreparedStudyTextSynthesis,
  SpeakerRoutingHint,
  SpeakerVoiceAssignment,
  SpeechDeliveryMode,
  SpeechNonVerbal,
  SpeechPace,
  SpeechPerformancePlan,
  SpeechPerformancePlanner,
  SpeechPerformancePlannerBinding,
  SpeechPerformancePlannerFallbackReason,
  SpeechPerformancePlannerMetadata,
  SpeechPerformancePlanSegment,
  SpeechPerformancePromptPolicyId,
  TtsEngine,
  TtsModelCapabilities,
  TtsModelId,
  TtsProviderAdapter,
  TtsProviderDescriptor,
  TtsProviderId,
  TtsSelection,
  TtsSpeechPlanningMode,
  TtsStrategy,
  Voice,
  VoiceAssignmentCapabilities,
  VoiceAssignmentResolution,
  VoiceCatalog,
  VoicePlan,
  VoicePlanAssignment,
  VoicePlanRankCandidate,
  VoicePlanRanker,
  VoicePlanRankerMetadata,
  VoicePlanRankRequest,
  VoicePlanRankResult,
  VoicePlanRankSelection,
  VoicePlanRankSpeaker,
  VoiceProviderAdapter,
  VoiceSelectionSummary,
} from './types.js';
export {
  createResolvedVoicePlan,
  resolveVoicePlanForExecution,
  validateVoicePlan,
  voiceAssignmentCapabilitiesForModel,
  withVoicePlan,
} from './voice-plan.js';
