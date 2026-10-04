/**
 * TTS strategy selection
 */
import type {
  ElevenLabsTtsModelId,
  PipelineLogger,
  VoiceSelectionDiagnostics,
} from '@esl-pipeline/contracts';
import type { AssignmentExecutionInput } from '@esl-pipeline/tts-core';

export type TtsStrategy = 'auto' | 'tts' | 'dialogue';
export type TtsProvider = 'elevenlabs';

/**
 * Dialogue input for ElevenLabs Text-to-Dialogue API
 */
export interface DialogueInput {
  text: string;
  voiceId: string;
}

/**
 * Options for dialogue synthesis
 */
export interface DialogueSynthesisOptions {
  inputs: DialogueInput[];
  modelId?: string;
  languageCode?: string;
  stability?: number;
  seed?: number;
  outputFormat?: string;
  applyTextNormalization?: 'auto' | 'on' | 'off';
  timeoutInSeconds?: number;
  maxRetries?: number;
  force?: boolean;
  ffmpegPath?: string;
}

/**
 * Result from dialogue synthesis
 */
export interface DialogueSynthesisResult {
  audioPath: string;
  duration?: number;
  hash: string;
  generatedCharacters?: number;
  cachedCharacters?: number;
}

/**
 * Chunking strategy for large dialogues
 */
export interface DialogueChunk {
  inputs: DialogueInput[];
  chunkIndex: number;
  totalChunks: number;
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
  ttsModel?: ElevenLabsTtsModelId;
  logger?: PipelineLogger;

  // Strategy selection (auto chooses based on content heuristics)
  ttsStrategy?: TtsStrategy;
  dialogueLanguage?: string;
  dialogueStability?: number;
  dialogueSeed?: number;

  // Provider selection
  ttsProvider?: TtsProvider;
}

export type BuildStudyTextInput = AssignmentExecutionInput & {
  mdPath?: string;
};

export interface BuildStudyTextResult {
  path: string;
  duration?: number;
  hash: string;
  provider?: string;
  modelId?: string;
  voices: {
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
  }[];
  voiceAssignments?: Record<string, string>;
  generatedCharacters?: number;
  cachedCharacters?: number;
}

export type BuildPronunciationShadowSentenceInput = AssignmentExecutionInput & {
  voiceId: string;
  mdPath?: string;
};

export interface BuildPronunciationTextInput {
  plainText?: boolean;
  text: string;
  voiceId: string;
  mdPath?: string;
  title?: string;
  kind?: string;
}

export interface BuildPronunciationShadowSentenceOptions {
  outPath: string;
  preview?: boolean;
  force?: boolean;
  ffmpegPath?: string;
  outputFormat?: string;
  ttsModel?: ElevenLabsTtsModelId;
  logger?: PipelineLogger;

  // Provider selection
  ttsProvider?: TtsProvider;
}

export interface BuildPronunciationTextOptions {
  outPath: string;
  preview?: boolean;
  force?: boolean;
  ffmpegPath?: string;
  outputFormat?: string;
  ttsModel?: ElevenLabsTtsModelId;
  logger?: PipelineLogger;
  ttsProvider?: TtsProvider;
  fileStem?: string;
  titleSuffix?: string;
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
