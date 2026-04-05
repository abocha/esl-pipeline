import type { PronunciationAudioPayload } from '@esl-pipeline/shared-infrastructure';

import { DEFAULT_THEME } from './css.js';

export interface ThemeTokens {
  pageBg?: string;
  pageCard?: string;
  pageText?: string;
  pageMuted?: string;
  pageLine?: string;
  calloutBg?: string;
  calloutBorder?: string;
  tocBg?: string;
  tocBorder?: string;
  h1?: string;
  h2?: string;
  h3?: string;
}

export interface FeatureFlags {
  stickyToc?: boolean;
  copyCode?: boolean;
}

export interface RenderOptions {
  title?: string;
  css?: string;
  headingTheme?: {
    h1?: string;
    h2?: string;
    h3?: string;
  };
  theme?: ThemeTokens;
  features?: FeatureFlags;
  allowRawHtml?: boolean;
  showGeneratedDate?: boolean;
  pronunciationAudio?: PronunciationAudioPayload | null;
}

export interface ResolvedFeatures {
  stickyToc: boolean;
  copyCode: boolean;
}

export interface ResolvedRenderOptions {
  css?: string;
  theme: Required<ThemeTokens>;
  features: ResolvedFeatures;
  allowRawHtml: boolean;
  showGeneratedDate: boolean;
  pronunciationAudio?: PronunciationAudioPayload | null;
}

export function resolveRenderOptions(options: RenderOptions): ResolvedRenderOptions {
  const theme = {
    ...DEFAULT_THEME,
    ...options.theme,
  };

  if (options.headingTheme) {
    if (options.headingTheme.h1) theme.h1 = options.headingTheme.h1;
    if (options.headingTheme.h2) theme.h2 = options.headingTheme.h2;
    if (options.headingTheme.h3) theme.h3 = options.headingTheme.h3;
  }

  return {
    css: options.css,
    theme,
    features: {
      stickyToc: options.features?.stickyToc ?? false,
      copyCode: options.features?.copyCode ?? true,
    },
    allowRawHtml: options.allowRawHtml ?? false,
    showGeneratedDate: options.showGeneratedDate ?? true,
    pronunciationAudio: options.pronunciationAudio ?? null,
  };
}
