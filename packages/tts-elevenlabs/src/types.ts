/**
 * TTS mode selection
 */
export type TtsMode = 'auto' | 'dialogue' | 'monologue';

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