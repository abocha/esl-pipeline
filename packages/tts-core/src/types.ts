import type {
  PipelineLogger,
  VoiceProviderErrorCategory,
  VoiceSelectionDiagnostics,
} from '@esl-pipeline/contracts';
import type { ParsedMarkdownContext } from '@esl-pipeline/pmd';

export type TtsProviderId = 'elevenlabs' | 'google';
export type TtsStrategy = 'auto' | 'tts' | 'dialogue';
export type GoogleTtsModel = 'chirp3_hd' | 'studio' | 'neural2' | 'wavenet';

export interface BuildStudyTextInput {
  context: ParsedMarkdownContext;
  mdPath?: string;
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
  modelId?: string;
  logger?: PipelineLogger;
  ttsStrategy?: TtsStrategy;
  dialogueLanguage?: string;
  dialogueStability?: number;
  dialogueSeed?: number;
  ttsProvider?: TtsProviderId;
  googleTtsModel?: GoogleTtsModel;
  googleLanguageCode?: string;
  googleApiEndpoint?: string;
  googleModelName?: string;
}

export interface BuildPronunciationShadowSentenceOptions {
  outPath: string;
  preview?: boolean;
  force?: boolean;
  ffmpegPath?: string;
  outputFormat?: string;
  modelId?: string;
  logger?: PipelineLogger;
  ttsProvider?: TtsProviderId;
  googleTtsModel?: GoogleTtsModel;
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
  modelId?: string;
  logger?: PipelineLogger;
  ttsProvider?: TtsProviderId;
  googleTtsModel?: GoogleTtsModel;
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
  capabilities?: VoiceCapabilitiesSnapshot;
  voices: Voice[];
}

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

export interface VoiceCapabilitiesSnapshot {
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
}

export interface VoiceProviderAdapter {
  loadCatalog(): Promise<VoiceCatalog>;
  resolveSpeakerAssignments(args: {
    input: BuildStudyTextInput;
    options: BuildStudyTextOptions;
  }): Promise<SpeakerVoiceAssignment[]>;
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
