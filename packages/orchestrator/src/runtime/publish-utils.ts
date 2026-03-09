import type { ColorPreset } from '@esl-pipeline/notion-adapter';
import {
  insertGeneratedAudioLinks as insertGeneratedAudioLinksShared,
  resolveHeadingTheme as resolveHeadingThemeShared,
  resolveMarkdownTitle as resolveMarkdownTitleShared,
} from '@esl-pipeline/shared-infrastructure';

export function insertGeneratedAudioLinks(
  markdown: string,
  urls: {
    studyTextUrl?: string;
    pronunciationShadowSentenceUrl?: string;
  },
): string {
  return insertGeneratedAudioLinksShared(markdown, {
    studyTextUrl: urls.studyTextUrl,
    pronunciationShadowSentenceUrl: urls.pronunciationShadowSentenceUrl,
  });
}

export function resolveMarkdownTitle(
  mdContents: string,
  fallback: string,
  metaTitle?: string | null,
): string {
  return resolveMarkdownTitleShared({
    markdown: mdContents,
    fallback,
    metaTitle,
  });
}

export function resolveHeadingTheme(
  preset?: ColorPreset,
): { h2?: string; h3?: string } | undefined {
  return resolveHeadingThemeShared(preset);
}
