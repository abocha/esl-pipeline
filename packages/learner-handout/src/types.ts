import type { AssignmentV1 } from '@esl-pipeline/contracts';

/** Presentation projection only; callers retain media planning and identity ownership. */
export interface PronunciationClipInput {
  id: string;
  itemIndex?: number;
  kind:
    | 'primary'
    | 'shadow_sentence'
    | 'sentence_item'
    | 'word_item'
    | 'pair_left'
    | 'pair_right'
    | 'connected_target';
  text: string;
  label?: string;
  url?: string | null;
}

export interface HandoutMediaInputs {
  studyTextAudioUrl?: string | null;
  pronunciationAudio?: {
    primaryClip?: PronunciationClipInput | null;
    itemClips?: readonly PronunciationClipInput[];
  } | null;
}

export interface LearnerHandoutProps {
  assignment: AssignmentV1;
  media?: HandoutMediaInputs;
  presentation?: {
    preview?: boolean;
    /** Explicit resolved hex colors from the caller's preset. */
    headingTheme?: { h2?: string; h3?: string };
  };
  publication?: {
    /** Already formatted by the caller. Never parsed or inferred from the clock. */
    displayDate?: string;
  };
}
