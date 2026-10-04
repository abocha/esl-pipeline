/** Study and pronunciation domain shared by typed and historical inputs. */
export interface Frontmatter {
  title: string;
  student: string;
  level: string;
  topic: string | string[];
  input_type: import('./index.js').ContentSource;
  study_text_type?: import('./index.js').StudyTextType;
  speaker_labels?: string[];
  speaker_profiles?: import('./index.js').SpeakerProfile[];
  // allow arbitrary extras without breaking
  [k: string]: unknown;
}

export type StudyText =
  | { type: 'dialogue'; lines: string[] }
  | { type: 'monologue'; lines: string[] };

export interface PronunciationShadowWord {
  text: string;
  transcription: string;
  line: number;
  note?: string;
}

export interface PronunciationShadowIssue {
  code: string;
  message: string;
  line: number;
}

export type PronunciationMode =
  | 'shadow_sentence'
  | 'intonation'
  | 'rhythm_chunking'
  | 'sentence_stress'
  | 'connected_speech'
  | 'minimal_pair';

export interface PronunciationCommonFields {
  target?: string;
  focus?: string;
  action?: string;
  deliverable?: string;
}

export type PronunciationWordDrill = PronunciationShadowWord;

export interface PronunciationMinimalPairItem {
  left: PronunciationWordDrill;
  right: PronunciationWordDrill;
  line: number;
  note?: string;
}

export interface PronunciationConnectedSpeechItem {
  careful: string;
  connected: string;
  line: number;
  note?: string;
}

export interface PronunciationGenericDrillItem {
  text: string;
  transcription?: string;
  line: number;
  note?: string;
}

export interface PronunciationShadowFocus {
  mode: 'shadow_sentence';
  shadowSentence?: string;
  words: PronunciationShadowWord[];
  sectionStartLine: number;
  issues: PronunciationShadowIssue[];
}

export type PronunciationFocus =
  | (PronunciationCommonFields & {
      mode: 'shadow_sentence';
      shadowSentence?: string;
      words: PronunciationWordDrill[];
      sectionStartLine: number;
      issues: PronunciationShadowIssue[];
    })
  | (PronunciationCommonFields & {
      mode: 'minimal_pair';
      pairs: PronunciationMinimalPairItem[];
      sectionStartLine: number;
      issues: PronunciationShadowIssue[];
    })
  | (PronunciationCommonFields & {
      mode: 'connected_speech';
      lines: PronunciationConnectedSpeechItem[];
      naturalSentence?: string;
      sectionStartLine: number;
      issues: PronunciationShadowIssue[];
    })
  | (PronunciationCommonFields & {
      mode: 'intonation' | 'rhythm_chunking' | 'sentence_stress';
      drills: PronunciationGenericDrillItem[];
      naturalSentence?: string;
      sectionStartLine: number;
      issues: PronunciationShadowIssue[];
      contourCue?: string;
    });
