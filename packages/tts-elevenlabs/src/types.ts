/**
 * TTS strategy selection
 */
import type { PipelineLogger } from '@esl-pipeline/contracts';
import type { VoiceSelectionDiagnostics } from '@esl-pipeline/contracts';
import type { ParsedMarkdownContext } from '@esl-pipeline/pmd';

export type TtsStrategy = 'auto' | 'tts' | 'dialogue';

/**
 * Dialogue input for ElevenLabs Text-to-Dialogue API
 */
export type DialogueInput = DialogueInputCanonical | DialogueInputLegacy;

export interface DialogueInputCanonical {
  text: string;
  voiceId: string;
  /** @deprecated Use `voiceId`. */
  voice_id?: string;
}

export interface DialogueInputLegacy {
  text: string;
  voiceId?: string;
  /** @deprecated Kept for backwards compatibility. */
  voice_id: string;
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
}

/**
 * Result from dialogue synthesis
 */
export interface DialogueSynthesisResult {
  audioPath: string;
  duration?: number;
  hash: string;
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
  logger?: PipelineLogger;

  // Strategy selection (auto chooses based on content heuristics)
  ttsStrategy?: TtsStrategy;
  dialogueLanguage?: string;
  dialogueStability?: number;
  dialogueSeed?: number;
}

export interface BuildStudyTextInput {
  context: ParsedMarkdownContext;
  mdPath?: string;
}

export interface BuildStudyTextResult {
  path: string;
  duration?: number;
  hash: string;
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
}
