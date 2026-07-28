import type {
  ElevenLabsTtsModelId,
  GoogleTtsModel,
  InworldTtsModel,
  PipelineLogger,
  SpeakerProfile,
  TtsModelId,
  TtsProviderId,
  VoiceProviderErrorCategory,
  VoiceSelectionDiagnostics,
} from '@esl-pipeline/contracts';
import type { ParsedMarkdownContext } from '@esl-pipeline/pmd';

export type TtsStrategy = 'auto' | 'tts' | 'dialogue';
export type { ElevenLabsTtsModelId, GoogleTtsModel, InworldTtsModel, TtsModelId, TtsProviderId };

export type TtsCapabilitySnapshotMode = 'static' | 'credentialed' | 'none';
export type TtsSpeechPlanningMode = 'identity' | 'prompted';
export type SpeechDeliveryMode = 'STABLE' | 'BALANCED' | 'CREATIVE';
export type SpeechPace = 'slow' | 'measured' | 'natural' | 'brisk';
export type SpeechNonVerbal = 'sigh' | 'laugh' | 'chuckle' | 'breath';
export type SpeechPerformancePromptPolicyId =
  | 'speech-performance-v1-restrained-natural'
  | 'speech-performance-v2-inworld-tts2';

export interface TtsModelCapabilities {
  planningMode: TtsSpeechPlanningMode;
  speakingRate?: { min: number; max: number };
  temperature?: { min: number; max: number };
  deliveryModes?: readonly SpeechDeliveryMode[];
  naturalLanguageSteering?: boolean;
  metadataInstructions?: boolean;
  ssmlBreaks?: boolean;
  nonVerbals?: boolean;
  uppercaseEmphasis?: boolean;
}

export interface TtsProviderDescriptor<
  ProviderId extends TtsProviderId = TtsProviderId,
  ModelId extends TtsModelId = TtsModelId,
> {
  id: ProviderId;
  label: string;
  models: readonly ModelId[];
  defaultModel: ModelId;
  envModelKey?: string;
  defaultVoiceId?: string;
  capabilitySnapshotMode: TtsCapabilitySnapshotMode;
}

export interface TtsSelection<
  ProviderId extends TtsProviderId = TtsProviderId,
  ModelId extends TtsModelId = TtsModelId,
> {
  provider: ProviderId;
  model: ModelId;
}

export interface BuildStudyTextInput {
  context: ParsedMarkdownContext;
  mdPath?: string;
}

export interface SpeechPerformancePlanSegment {
  id: string;
  speaker?: string;
  text: string;
  emotion?: string;
  intonation?: string;
  pace?: SpeechPace;
  emphasis?: string[];
  pauseBeforeMs?: number;
  pauseAfterMs?: number;
  nonVerbalsBefore?: SpeechNonVerbal[];
  nonVerbalsAfter?: SpeechNonVerbal[];
  deliveryMode?: SpeechDeliveryMode;
  freeFormDirection?: string;
}

export interface SpeechPerformancePlannerMetadata {
  provider: string;
  model: string;
  generatedAt: string;
  promptPolicyVersion?: SpeechPerformancePromptPolicyId;
  promptHash?: string;
}

export interface SpeechPerformancePlan {
  schemaVersion: 1;
  mode: TtsSpeechPlanningMode;
  provider: TtsProviderId;
  model: TtsModelId;
  sourceHash: string;
  planner?: SpeechPerformancePlannerMetadata;
  fallbackReason?: string;
  segments: SpeechPerformancePlanSegment[];
}

export interface PreparedStudyTextSynthesis {
  selection: TtsSelection;
  sourceHash: string;
  segments: SpeechPerformancePlanSegment[];
  speakerLabels?: string[];
  voices: VoiceSelectionSummary[];
  voiceAssignments: Record<string, string>;
  voicePlan?: VoicePlan;
}

export interface VoiceAssignmentCapabilities {
  supportsMetadataInstructions: boolean;
  supportsNonVerbals: boolean;
  supportsUppercaseEmphasis: boolean;
  supportsFreeFormDirection: boolean;
}

export interface VoicePlanAssignment extends SpeakerVoiceAssignment {
  capabilities: VoiceAssignmentCapabilities;
  language?: string;
}

export interface VoicePlanRankerMetadata {
  provider: string;
  model: string;
  generatedAt: string;
}

export interface VoicePlan {
  schemaVersion: 1;
  capabilityPolicyVersion?: 'model-scoped-v1';
  mode: 'ranked' | 'deterministic' | 'fallback';
  provider: TtsProviderId;
  model: TtsModelId;
  sourceHash: string;
  ranker?: VoicePlanRankerMetadata;
  fallbackReason?: string;
  assignments: VoicePlanAssignment[];
}

export interface VoicePlanRankCandidate {
  voiceId: string;
  name: string;
  score: number;
  description?: string;
  tags?: string[];
  capabilities: VoiceAssignmentCapabilities;
}

export interface VoicePlanRankSpeaker {
  speaker: string;
  profile?: SpeakerProfile;
  candidates: VoicePlanRankCandidate[];
}

export interface VoicePlanRankRequest {
  provider: TtsProviderId;
  model: TtsModelId;
  speakers: VoicePlanRankSpeaker[];
}

export interface VoicePlanRankSelection {
  speaker: string;
  voiceId: string;
  reason?: string;
}

export interface VoicePlanRankResult {
  selections: VoicePlanRankSelection[];
}

export interface VoicePlanRanker {
  metadata: VoicePlanRankerMetadata;
  debugLogPlan?: boolean;
  rank(request: VoicePlanRankRequest): Promise<VoicePlanRankResult>;
}

export interface SpeechPerformancePlanner {
  plan(prepared: PreparedStudyTextSynthesis): Promise<SpeechPerformancePlan>;
}

export type SpeechPerformancePlannerFallbackReason =
  | 'planner_disabled'
  | 'planner_missing_credentials'
  | 'planner_unavailable'
  | 'planner_budget_exceeded'
  | 'planner_execution_failed'
  | 'planner_invalid';

export interface SpeechPerformancePlannerBinding {
  planner?: SpeechPerformancePlanner;
  unavailableReason?: Extract<
    SpeechPerformancePlannerFallbackReason,
    'planner_disabled' | 'planner_missing_credentials' | 'planner_unavailable'
  >;
}

export interface BuildPronunciationShadowSentenceInput {
  context: ParsedMarkdownContext;
  voiceId: string;
  mdPath?: string;
}

export interface BuildPronunciationTextInput {
  text: string;
  voiceId: string;
  mdPath?: string;
  title?: string;
  kind?: string;
}

export interface BuildStudyTextOptions {
  voiceMapPath: string;
  outPath: string;
  preview?: boolean;
  force?: boolean;
  defaultAccent?: string;
  defaultVoiceId?: string;
  ffmpegPath?: string;
  outputFormat?: string;
  logger?: PipelineLogger;
  ttsStrategy?: TtsStrategy;
  dialogueLanguage?: string;
  dialogueStability?: number;
  dialogueSeed?: number;
  ttsProvider?: TtsProviderId;
  ttsModel?: TtsModelId;
  googleLanguageCode?: string;
  googleApiEndpoint?: string;
  googleModelName?: string;
  voicePlan?: VoicePlan;
  voiceRanker?: VoicePlanRanker;
  speechPlan?: SpeechPerformancePlan;
}

export interface BuildPronunciationShadowSentenceOptions {
  outPath: string;
  preview?: boolean;
  force?: boolean;
  ffmpegPath?: string;
  outputFormat?: string;
  logger?: PipelineLogger;
  ttsProvider?: TtsProviderId;
  ttsModel?: TtsModelId;
  googleLanguageCode?: string;
  googleApiEndpoint?: string;
  googleModelName?: string;
}

export interface BuildPronunciationTextOptions {
  outPath: string;
  preview?: boolean;
  force?: boolean;
  ffmpegPath?: string;
  outputFormat?: string;
  logger?: PipelineLogger;
  ttsProvider?: TtsProviderId;
  ttsModel?: TtsModelId;
  googleLanguageCode?: string;
  googleApiEndpoint?: string;
  googleModelName?: string;
  fileStem?: string;
  titleSuffix?: string;
}

export interface VoiceSelectionSummary {
  speaker: string;
  voiceId: string;
  source: string;
  score?: number;
  voiceName?: string;
  gender?: string;
  accent?: string;
  useCase?: string;
  selectionReason?: VoiceSelectionDiagnostics['selectionReason'];
  capabilityMatches?: VoiceSelectionDiagnostics['capabilityMatches'];
  capabilityMismatches?: VoiceSelectionDiagnostics['capabilityMismatches'];
}

export interface BuildStudyTextResult {
  path: string;
  duration?: number;
  hash: string;
  provider?: string;
  modelId?: string;
  voices: VoiceSelectionSummary[];
  voiceAssignments?: Record<string, string>;
  generatedCharacters?: number;
  cachedCharacters?: number;
}

export interface BuildPronunciationShadowSentenceResult {
  path: string;
  duration?: number;
  hash: string;
  provider?: string;
  modelId?: string;
  voiceId: string;
  generatedCharacters?: number;
  cachedCharacters?: number;
}

export interface BuildPronunciationTextResult {
  path: string;
  duration?: number;
  hash: string;
  provider?: string;
  modelId?: string;
  voiceId: string;
  generatedCharacters?: number;
  cachedCharacters?: number;
}

export interface VoiceCatalog {
  generatedAt?: string;
  capabilities?: VoiceCatalogCapabilities;
  voices: Voice[];
}

export type { SpeakerRoutingHint } from './speaker-routing.js';

export interface Voice {
  id: string;
  name: string;
  category?: string | null;
  labels?: Record<string, unknown>;
  useCase?: string;
  verifiedLanguages?: { language?: string; locale?: string }[];
  previewUrl?: string | null;
  preview_url?: string | null;
}

export interface VoiceCatalogCapabilities {
  generatedAt?: string;
  provider?: string;
  role?: string[];
  gender?: string[];
  age?: string[];
  accent?: string[];
  style?: string[];
}

export interface SpeakerVoiceAssignment {
  speaker: string;
  voiceId: string;
  source: 'profile' | 'voiceMap' | 'default' | 'auto' | 'fallback' | 'reuse';
  score?: number;
  selectionReason?: string;
  capabilityMatches?: string[];
  capabilityMismatches?: string[];
  capabilities?: VoiceAssignmentCapabilities;
}

export interface VoiceAssignmentResolution {
  assignments: SpeakerVoiceAssignment[];
  mode: 'ranked' | 'deterministic' | 'fallback';
  fallbackReason?:
    | 'ranker_disabled'
    | 'model_not_supported'
    | 'no_rankable_credentialed_english_candidates'
    | 'ranker_failed';
}

export interface VoiceProviderAdapter {
  loadCatalog(): Promise<VoiceCatalog>;
  resolveSpeakerAssignments(args: {
    input: BuildStudyTextInput;
    options: BuildStudyTextOptions;
  }): Promise<VoiceAssignmentResolution | SpeakerVoiceAssignment[]>;
  buildVoiceDiagnostics?(args: {
    assignments: SpeakerVoiceAssignment[];
    catalog: VoiceCatalog;
  }): Promise<void> | void;
  syncCatalog?(): Promise<{ count: number; outPath: string }>;
}

export interface TtsProviderMetadata {
  provider: TtsProviderId;
  modelFamily?: string;
  pricingToken: string;
}

export interface TtsProviderAdapter {
  id: TtsProviderId;
  providerMetadata(args: {
    studyTextOptions?: BuildStudyTextOptions;
    shadowOptions?: BuildPronunciationShadowSentenceOptions;
  }): TtsProviderMetadata;
  classifyProviderError?(error: unknown): VoiceProviderErrorCategory | null;
  voice: VoiceProviderAdapter;
  synthesizeStudyText(
    input: BuildStudyTextInput,
    options: BuildStudyTextOptions,
  ): Promise<BuildStudyTextResult>;
  synthesizeShadowSentence(
    input: BuildPronunciationShadowSentenceInput,
    options: BuildPronunciationShadowSentenceOptions,
  ): Promise<BuildPronunciationShadowSentenceResult>;
  synthesizePronunciationText(
    input: BuildPronunciationTextInput,
    options: BuildPronunciationTextOptions,
  ): Promise<BuildPronunciationTextResult>;
}

export interface TtsEngine {
  registerProvider(provider: TtsProviderAdapter): void;
  registerProviders(providers: TtsProviderAdapter[]): void;
  getProvider(id: TtsProviderId): TtsProviderAdapter | undefined;
  prepareStudyTextSynthesis(
    input: BuildStudyTextInput,
    options: BuildStudyTextOptions,
  ): Promise<PreparedStudyTextSynthesis>;
  buildStudyTextMp3(
    input: BuildStudyTextInput,
    options: BuildStudyTextOptions,
  ): Promise<BuildStudyTextResult>;
  buildPronunciationShadowSentenceMp3(
    input: BuildPronunciationShadowSentenceInput,
    options: BuildPronunciationShadowSentenceOptions,
  ): Promise<BuildPronunciationShadowSentenceResult>;
  buildPronunciationTextMp3(
    input: BuildPronunciationTextInput,
    options: BuildPronunciationTextOptions,
  ): Promise<BuildPronunciationTextResult>;
  loadVoicesCatalog(provider?: TtsProviderId): Promise<VoiceCatalog>;
}
