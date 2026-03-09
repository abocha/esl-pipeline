import type { ColorPreset } from '@esl-pipeline/notion-adapter';

const STUDY_TEXT_MARKER = ':::study-text Transcript';
const STUDY_TEXT_AUDIO_LINK_LABEL = 'Audio recording: Study Text';
const PRONUNCIATION_AUDIO_LINK_LABEL = 'Audio recording: Pronunciation Shadow Sentence';
const GENERATED_STUDY_TEXT_AUDIO_LINK_REGEX = new RegExp(
  String.raw`^\[${STUDY_TEXT_AUDIO_LINK_LABEL}\]\([^)]+\)\s*$`,
  'i',
);
const GENERATED_PRONUNCIATION_AUDIO_LINK_REGEX = new RegExp(
  String.raw`^\[${PRONUNCIATION_AUDIO_LINK_LABEL}\]\([^)]+\)\s*$`,
  'i',
);
const STUDY_TEXT_REGEX = /^:::study-text\b/i;
const TRANSCRIPT_REGEX = /transcript/i;
const PRONUNCIATION_HEADING_REGEX = /^###\s+.*pronunciation.*micro.*focus/i;

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
  return /^`[^`]+`$/.test(withoutBullet)
    ? withoutBullet.slice(1, -1).trim()
    : withoutBullet;
}

function parseShadowSentenceLine(line: string): { matches: boolean; hasValue: boolean } {
  const normalizedLine = normalizePronunciationSectionLine(line);
  const match = /^(?:\*\*)?shadow sentence\s*:\s*(?:\*\*)?\s*(.*)$/i.exec(normalizedLine);
  if (!match) return { matches: false, hasValue: false };
  const value = (match[1] ?? '').trim();
  return { matches: true, hasValue: value.length > 0 };
}

export function insertGeneratedAudioLinks(
  markdown: string,
  urls: {
    studyTextUrl?: string;
    pronunciationShadowSentenceUrl?: string;
  },
): string {
  const lines = markdown.split('\n');
  const cleaned: string[] = [];
  let studyMarkerIndex = -1;
  let studyFallbackIndex = -1;
  let pronunciationHeadingIndex = -1;
  let pronunciationAnchorIndex = -1;
  let inPronunciationSection = false;
  let pendingShadowSentenceValue = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === STUDY_TEXT_MARKER) studyMarkerIndex = cleaned.length;
    if (STUDY_TEXT_REGEX.test(trimmed)) {
      if (studyFallbackIndex === -1) studyFallbackIndex = cleaned.length;
      if (TRANSCRIPT_REGEX.test(trimmed)) studyMarkerIndex = cleaned.length;
    }
    if (PRONUNCIATION_HEADING_REGEX.test(trimmed)) {
      pronunciationHeadingIndex = cleaned.length;
      inPronunciationSection = true;
    } else if (inPronunciationSection && /^#{2,3}\s+/.test(trimmed)) {
      inPronunciationSection = false;
      pendingShadowSentenceValue = false;
    }
    if (
      GENERATED_STUDY_TEXT_AUDIO_LINK_REGEX.test(trimmed) ||
      GENERATED_PRONUNCIATION_AUDIO_LINK_REGEX.test(trimmed)
    ) {
      continue;
    }
    if (inPronunciationSection) {
      const shadowSentence = parseShadowSentenceLine(trimmed);
      if (shadowSentence.matches) {
        pronunciationAnchorIndex = cleaned.length;
        pendingShadowSentenceValue = !shadowSentence.hasValue;
      } else if (pendingShadowSentenceValue && trimmed.length > 0) {
        pronunciationAnchorIndex = cleaned.length;
        pendingShadowSentenceValue = false;
      }
    }
    cleaned.push(line);
  }

  const nextLines = [...cleaned];
  const studyTextUrl = urls.studyTextUrl?.trim();
  if (studyTextUrl) {
    const audioLine = `[${STUDY_TEXT_AUDIO_LINK_LABEL}](${studyTextUrl})`;
    if (!nextLines.some((line) => line.trim() === audioLine)) {
      const insertAt =
        studyMarkerIndex >= 0
          ? studyMarkerIndex
          : studyFallbackIndex >= 0
            ? studyFallbackIndex
            : nextLines.length;
      nextLines.splice(insertAt, 0, audioLine, '');
    }
  }

  const pronunciationUrl = urls.pronunciationShadowSentenceUrl?.trim();
  if (pronunciationUrl) {
    const audioLine = `[${PRONUNCIATION_AUDIO_LINK_LABEL}](${pronunciationUrl})`;
    if (!nextLines.some((line) => line.trim() === audioLine)) {
      const headingIndex =
        pronunciationAnchorIndex >= 0
          ? pronunciationAnchorIndex + 1
          : pronunciationHeadingIndex >= 0
            ? pronunciationHeadingIndex + 1
            : nextLines.length;
      nextLines.splice(headingIndex, 0, '', audioLine, '');
    }
  }

  return nextLines.join('\n');
}

export function resolveMarkdownTitle(
  mdContents: string,
  fallback: string,
  metaTitle?: string | null,
): string {
  if (metaTitle && metaTitle.trim()) return metaTitle.trim();
  const headingMatch = mdContents.match(/^#\s+(.+)$/m);
  if (headingMatch?.[1]) return headingMatch[1].trim();
  return fallback;
}

export function resolveHeadingTheme(
  preset?: ColorPreset,
): { h2?: string; h3?: string } | undefined {
  if (!preset) return undefined;
  const h2 = preset.h2 ? (NOTION_COLOR_TO_HEX[preset.h2] ?? undefined) : undefined;
  const h3 = preset.h3 ? (NOTION_COLOR_TO_HEX[preset.h3] ?? undefined) : undefined;
  if (!h2 && !h3) return undefined;
  return { h2, h3 };
}
