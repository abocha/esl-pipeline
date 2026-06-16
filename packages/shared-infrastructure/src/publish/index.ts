const STUDY_TEXT_MARKER = ':::study-text Transcript';
const STUDY_TEXT_REGEX = /^:::study-text\b/i;
const TRANSCRIPT_REGEX = /transcript/i;
const PRONUNCIATION_HEADING_REGEX = /^###\s+.*pronunciation.*micro.*focus/i;
const AUDIO_DIRECTIVE_REGEX = /^:::\s*audio(\s+.*)?$/i;
const STUDY_TEXT_AUDIO_LINK_LABEL = 'Audio recording: Study Text';
const PRONUNCIATION_AUDIO_LINK_LABEL = 'Audio recording: Pronunciation Practice';
const LEGACY_PRONUNCIATION_AUDIO_LINK_LABEL = 'Audio recording: Pronunciation Shadow Sentence';
const GENERATED_STUDY_TEXT_AUDIO_LINK_REGEX = new RegExp(
  String.raw`^\[${STUDY_TEXT_AUDIO_LINK_LABEL}\]\([^)]+\)\s*$`,
  'i',
);
const GENERATED_PRONUNCIATION_AUDIO_LINK_REGEX = new RegExp(
  String.raw`^\[${PRONUNCIATION_AUDIO_LINK_LABEL}\]\([^)]+\)\s*$`,
  'i',
);
const GENERATED_LEGACY_PRONUNCIATION_AUDIO_LINK_REGEX = new RegExp(
  String.raw`^\[${LEGACY_PRONUNCIATION_AUDIO_LINK_LABEL}\]\([^)]+\)\s*$`,
  'i',
);

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

function normalizePronunciationSectionLine(line: string): string {
  const trimmed = line.trim();
  const withoutBullet = trimmed.replace(/^\s*(?:[-*]\s+)?/, '').trim();
  return /^`[^`]+`$/.test(withoutBullet) ? withoutBullet.slice(1, -1).trim() : withoutBullet;
}

function parseShadowSentenceLine(line: string): { matches: boolean; hasValue: boolean } {
  const normalizedLine = normalizePronunciationSectionLine(line);
  const match = /^(?:\*\*)?shadow sentence\s*:\s*(?:\*\*)?\s*(.*)$/i.exec(normalizedLine);
  if (!match) return { matches: false, hasValue: false };
  const value = (match[1] ?? '').trim();
  return { matches: true, hasValue: value.length > 0 };
}

function parseNaturalSentencePracticeLine(line: string): { matches: boolean; hasValue: boolean } {
  const normalizedLine = normalizePronunciationSectionLine(line);
  const match = /^(?:\*\*)?natural sentence practice\s*:\s*(?:\*\*)?\s*(.*)$/i.exec(normalizedLine);
  if (!match) return { matches: false, hasValue: false };
  const value = (match[1] ?? '').trim();
  return { matches: true, hasValue: value.length > 0 };
}

function extractFrontmatterTitle(markdown: string): string | null {
  const frontmatterMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatterMatch) {
    return null;
  }

  const normalizedFrontmatterBody = (frontmatterMatch[1] ?? '').replaceAll('\r\n', '\n');
  const titleMatch = normalizedFrontmatterBody.match(/^\s*title:\s*(.+)\s*$/im);
  const titleValue = titleMatch?.[1]?.trim();
  if (!titleValue) {
    return null;
  }

  return titleValue.replaceAll(/^['"]|['"]$/g, '');
}

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

export interface ResolveMarkdownTitleOptions {
  markdown: string;
  fallback: string;
  explicitTitle?: string | null;
  metaTitle?: string | null;
  preferFrontmatterTitle?: boolean;
}

export function resolveMarkdownTitle(options: ResolveMarkdownTitleOptions): string {
  const explicitTitle = options.explicitTitle?.trim();
  if (explicitTitle) {
    return explicitTitle;
  }

  const metaTitle = options.metaTitle?.trim();
  if (metaTitle) {
    return metaTitle;
  }

  if (options.preferFrontmatterTitle) {
    const frontmatterTitle = extractFrontmatterTitle(options.markdown);
    if (frontmatterTitle) {
      return frontmatterTitle;
    }
  }

  const headingMatch = options.markdown.match(/^#\s+(.+)$/m);
  if (headingMatch?.[1]?.trim()) {
    return headingMatch[1].trim();
  }

  return options.fallback;
}

export interface InsertGeneratedAudioLinksOptions {
  studyTextUrl?: string | null;
  pronunciationAudioUrl?: string | null;
  pronunciationAudio?: PronunciationAudioPayload | null;
  includePronunciation?: boolean;
  insertStudyPlaceholderWhenMissing?: boolean;
  insertPronunciationPlaceholderWhenMissing?: boolean;
  studyPlaceholder?: string;
  pronunciationPlaceholder?: string;
  removeGeneratedPlaceholderMarkers?: {
    study?: string;
    pronunciation?: string;
  };
}

export function insertGeneratedAudioLinks(
  markdown: string,
  options: InsertGeneratedAudioLinksOptions,
): string {
  const lines = markdown.split('\n');
  const cleaned: string[] = [];
  let studyMarkerIndex = -1;
  let studyFallbackIndex = -1;
  let pronunciationAnchorIndex = -1;
  let inPronunciationSection = false;
  let pendingShadowSentenceValue = false;
  let pendingNaturalSentenceValue = false;
  let skipGeneratedPlaceholderDirective = false;

  const studyPlaceholderMarker = options.removeGeneratedPlaceholderMarkers?.study;
  const pronunciationPlaceholderMarker = options.removeGeneratedPlaceholderMarkers?.pronunciation;

  for (const line of lines) {
    const trimmed = line.trim();
    if (skipGeneratedPlaceholderDirective) {
      if (!trimmed || AUDIO_DIRECTIVE_REGEX.test(trimmed)) {
        skipGeneratedPlaceholderDirective = false;
        continue;
      }
      skipGeneratedPlaceholderDirective = false;
    }

    if (
      (studyPlaceholderMarker && trimmed === studyPlaceholderMarker) ||
      (pronunciationPlaceholderMarker && trimmed === pronunciationPlaceholderMarker)
    ) {
      skipGeneratedPlaceholderDirective = true;
      continue;
    }

    if (trimmed === STUDY_TEXT_MARKER) studyMarkerIndex = cleaned.length;
    if (STUDY_TEXT_REGEX.test(trimmed)) {
      if (studyFallbackIndex === -1) studyFallbackIndex = cleaned.length;
      if (TRANSCRIPT_REGEX.test(trimmed)) studyMarkerIndex = cleaned.length;
    }
    if (PRONUNCIATION_HEADING_REGEX.test(trimmed)) {
      inPronunciationSection = true;
    } else if (inPronunciationSection && /^#{2,3}\s+/.test(trimmed)) {
      inPronunciationSection = false;
      pendingShadowSentenceValue = false;
      pendingNaturalSentenceValue = false;
    }

    if (
      GENERATED_STUDY_TEXT_AUDIO_LINK_REGEX.test(trimmed) ||
      GENERATED_PRONUNCIATION_AUDIO_LINK_REGEX.test(trimmed) ||
      GENERATED_LEGACY_PRONUNCIATION_AUDIO_LINK_REGEX.test(trimmed)
    ) {
      continue;
    }
    if (inPronunciationSection) {
      const shadowSentence = parseShadowSentenceLine(trimmed);
      const naturalSentencePractice = parseNaturalSentencePracticeLine(trimmed);
      if (shadowSentence.matches || naturalSentencePractice.matches) {
        pronunciationAnchorIndex = cleaned.length;
        pendingShadowSentenceValue = shadowSentence.matches && !shadowSentence.hasValue;
        pendingNaturalSentenceValue =
          naturalSentencePractice.matches && !naturalSentencePractice.hasValue;
      } else if (
        (pendingShadowSentenceValue || pendingNaturalSentenceValue) &&
        trimmed.length > 0
      ) {
        if (/^:::/i.test(trimmed)) {
          pendingShadowSentenceValue = false;
          pendingNaturalSentenceValue = false;
        } else {
          pronunciationAnchorIndex = cleaned.length;
          pendingShadowSentenceValue = false;
          pendingNaturalSentenceValue = false;
        }
      }
    }
    cleaned.push(line);
  }

  const next = [...cleaned];
  let pronunciationAnchorOffset = 0;
  const studyTextUrl = options.studyTextUrl?.trim();
  if (studyTextUrl) {
    const audioLine = `[${STUDY_TEXT_AUDIO_LINK_LABEL}](${studyTextUrl})`;
    if (!next.some((line) => line.trim() === audioLine)) {
      const insertAt =
        studyMarkerIndex >= 0
          ? studyMarkerIndex
          : studyFallbackIndex >= 0
            ? studyFallbackIndex
            : next.length;
      next.splice(insertAt, 0, audioLine, '');
      if (pronunciationAnchorIndex >= 0 && insertAt <= pronunciationAnchorIndex) {
        pronunciationAnchorOffset += 2;
      }
    }
  } else if (options.insertStudyPlaceholderWhenMissing) {
    const insertAt =
      studyMarkerIndex >= 0
        ? studyMarkerIndex
        : studyFallbackIndex >= 0
          ? studyFallbackIndex
          : next.length;
    next.splice(insertAt, 0, options.studyPlaceholder ?? ':::audio', '');
    if (pronunciationAnchorIndex >= 0 && insertAt <= pronunciationAnchorIndex) {
      pronunciationAnchorOffset += 2;
    }
  }

  const includePronunciation =
    options.includePronunciation ??
    (Boolean(options.pronunciationAudio?.primaryClip?.url?.trim()) ||
      Boolean(options.pronunciationAudioUrl?.trim()) ||
      Boolean(options.insertPronunciationPlaceholderWhenMissing));
  if (includePronunciation && pronunciationAnchorIndex >= 0) {
    const pronunciationAudioUrl =
      options.pronunciationAudio?.primaryClip?.url?.trim() ?? options.pronunciationAudioUrl?.trim();
    if (pronunciationAudioUrl) {
      const audioLine = `[${PRONUNCIATION_AUDIO_LINK_LABEL}](${pronunciationAudioUrl})`;
      if (!next.some((line) => line.trim() === audioLine)) {
        const headingIndex = pronunciationAnchorIndex + pronunciationAnchorOffset + 1;
        next.splice(headingIndex, 0, '', audioLine, '');
      }
    } else if (options.insertPronunciationPlaceholderWhenMissing) {
      const headingIndex = pronunciationAnchorIndex + pronunciationAnchorOffset + 1;
      next.splice(headingIndex, 0, '', options.pronunciationPlaceholder ?? ':::audio', '');
    }
  }

  return next.join('\n');
}
