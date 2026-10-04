export type PronunciationAudioMode =
  | 'shadow_sentence'
  | 'intonation'
  | 'rhythm_chunking'
  | 'sentence_stress'
  | 'connected_speech'
  | 'minimal_pair';

export type PronunciationAudioEngine = 'provider';

export type PronunciationAudioClipKind =
  | 'primary'
  | 'shadow_sentence'
  | 'sentence_item'
  | 'word_item'
  | 'pair_left'
  | 'pair_right'
  | 'connected_target';

export interface PronunciationAudioClip {
  id: string;
  kind: PronunciationAudioClipKind;
  engine: PronunciationAudioEngine;
  text: string;
  url?: string;
  itemIndex?: number;
  note?: string;
  label?: string;
}

export interface PronunciationAudioPayload {
  mode: PronunciationAudioMode;
  primaryClip?: PronunciationAudioClip | null;
  itemClips?: PronunciationAudioClip[];
}

const NOTION_COLOR_TO_HEX: Record<string, string> = {
  default: '#1b1b1d',
  gray: '#6b6f76',
  brown: '#8d6e63',
  orange: '#f2994a',
  yellow: '#f2c94c',
  green: '#27ae60',
  blue: '#2d9cdb',
  purple: '#9b51e0',
  pink: '#d16ba5',
  red: '#eb5757',
  default_background: '#1b1b1d',
  gray_background: '#6b6f76',
  brown_background: '#8d6e63',
  orange_background: '#f2994a',
  yellow_background: '#f2c94c',
  green_background: '#27ae60',
  blue_background: '#2d9cdb',
  purple_background: '#9b51e0',
  pink_background: '#d16ba5',
  red_background: '#eb5757',
};

export interface HeadingPreset {
  h2?: string | null;
  h3?: string | null;
}

export function resolveHeadingTheme(
  preset: HeadingPreset | null | undefined,
): { h2?: string; h3?: string } | undefined {
  if (!preset) return undefined;
  const h2 = preset.h2 ? (NOTION_COLOR_TO_HEX[preset.h2] ?? undefined) : undefined;
  const h3 = preset.h3 ? (NOTION_COLOR_TO_HEX[preset.h3] ?? undefined) : undefined;
  if (!h2 && !h3) return undefined;
  return { h2, h3 };
}
