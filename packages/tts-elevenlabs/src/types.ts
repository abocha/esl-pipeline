/**
 * TTS strategy selection
 */
export type TtsStrategy = 'auto' | 'tts' | 'dialogue';

/**
 * Dialogue input for ElevenLabs Text-to-Dialogue API
 */
export interface DialogueInput {
  text: string;
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

  // Strategy selection (auto chooses based on content heuristics)
  ttsStrategy?: TtsStrategy;
  dialogueLanguage?: string;
  dialogueStability?: number;
  dialogueSeed?: number;
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
  }[];
  voiceAssignments?: Record<string, string>;
}
