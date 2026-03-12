import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import container from 'markdown-it-container';
import toc from 'markdown-it-toc-done-right';

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
}

interface ResolvedFeatures {
  stickyToc: boolean;
  copyCode: boolean;
}

interface ResolvedRenderOptions {
  css?: string;
  theme: ThemeTokens;
  features: ResolvedFeatures;
  allowRawHtml: boolean;
  showGeneratedDate: boolean;
}

const DEFAULT_THEME: Required<ThemeTokens> = {
  h1: '#e6ddcc',
  h2: '#d8e5f2',
  h3: '#e7dbe9',
  pageBg: '#f5f1e8',
  pageCard: '#ffffff',
  pageText: '#1f1f1f',
  pageMuted: '#565656',
  pageLine: '#ddd6c8',
  calloutBg: '#f8f4eb',
  calloutBorder: '#d7b98f',
  tocBg: '#f7f3ea',
  tocBorder: '#e5dac8',
};

const DEFAULT_CSS = `
:root {
  --theme-h1: ${DEFAULT_THEME.h1};
  --theme-h2: ${DEFAULT_THEME.h2};
  --theme-h3: ${DEFAULT_THEME.h3};
  --page-bg: ${DEFAULT_THEME.pageBg};
  --page-card: ${DEFAULT_THEME.pageCard};
  --page-text: ${DEFAULT_THEME.pageText};
  --page-muted: ${DEFAULT_THEME.pageMuted};
  --page-line: ${DEFAULT_THEME.pageLine};
  --callout-bg: ${DEFAULT_THEME.calloutBg};
  --callout-border: ${DEFAULT_THEME.calloutBorder};
  --toc-bg: ${DEFAULT_THEME.tocBg};
  --toc-border: ${DEFAULT_THEME.tocBorder};
  --tag-bg: #f0e8da;
  --audio-accent: #8b6f47;
  --inline-code-bg: #ece8e1;
  --inline-code-text: #2a2a2a;
  --toc-link: #36475d;
  --table-head-bg: color-mix(in srgb, var(--theme-h2) 14%, var(--page-card) 86%);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --theme-h1: #3d3529;
    --theme-h2: #2a3340;
    --theme-h3: #352d38;
    --page-bg: #1a1714;
    --page-card: #252220;
    --page-text: #e8e4dc;
    --page-muted: #a8a098;
    --page-line: #3a342c;
    --callout-bg: #2a2622;
    --callout-border: #5c4a32;
    --toc-bg: #242018;
    --toc-border: #3a3228;
    --tag-bg: #3a3228;
    --audio-accent: #c9a86c;
    --inline-code-bg: #2e2a26;
    --inline-code-text: #d8d4cc;
    --toc-link: #9aa8b8;
    --table-head-bg: color-mix(in srgb, var(--theme-h2) 28%, var(--page-card) 72%);
  }
}
[data-theme="dark"] {
  --theme-h1: #3d3529;
  --theme-h2: #2a3340;
  --theme-h3: #352d38;
  --page-bg: #1a1714;
  --page-card: #252220;
  --page-text: #e8e4dc;
  --page-muted: #a8a098;
  --page-line: #3a342c;
  --callout-bg: #2a2622;
  --callout-border: #5c4a32;
  --toc-bg: #242018;
  --toc-border: #3a3228;
  --tag-bg: #3a3228;
  --audio-accent: #c9a86c;
  --inline-code-bg: #2e2a26;
  --inline-code-text: #d8d4cc;
  --toc-link: #9aa8b8;
  --table-head-bg: color-mix(in srgb, var(--theme-h2) 28%, var(--page-card) 72%);
}
html {
  scroll-behavior: smooth;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  padding: 0;
  font-family: 'Inter', 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
  line-height: 1.65;
  color: var(--page-text);
  background: radial-gradient(circle at top right, color-mix(in srgb, var(--page-bg) 85%, #d8d0c0 15%) 0%, transparent 40%), var(--page-bg);
  transition: background-color 0.3s ease, color 0.3s ease;
}
.page {
  max-width: 940px;
  margin: 28px auto 56px;
  background: var(--page-card);
  border-radius: 18px;
  padding: 28px 34px 44px;
  border: 1px solid color-mix(in srgb, var(--page-line) 70%, var(--page-card) 30%);
  box-shadow: 0 12px 34px rgba(56, 44, 24, 0.08);
  transition: background-color 0.3s ease, border-color 0.3s ease;
}
.page-header {
  margin-bottom: 18px;
}
.hero {
  position: relative;
  display: flex;
  align-items: center;
  gap: 20px;
  min-height: 140px;
  padding: 24px 26px;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--page-line) 72%, var(--page-card) 28%);
  background:
    radial-gradient(circle at 22% 24%, color-mix(in srgb, var(--page-card) 70%, transparent 30%), transparent 55%),
    linear-gradient(135deg, var(--theme-h1) 0%, var(--theme-h2) 45%, var(--theme-h3) 100%);
  overflow: hidden;
}
.hero::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.18) 2px, transparent 2px, transparent 12px);
  opacity: 0.45;
  pointer-events: none;
}
.hero-emoji {
  position: relative;
  z-index: 1;
  font-size: clamp(72px, 10vw, 110px);
  line-height: 1;
  filter: drop-shadow(0 6px 14px rgba(36, 30, 18, 0.18));
  flex-shrink: 0;
}
.hero-content {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.hero-title {
  margin: 0;
  font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
  font-size: clamp(30px, 4.4vw, 44px);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.08;
  text-wrap: balance;
}
.page-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--tag-bg);
  color: var(--page-text);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  transition: background-color 0.3s ease, color 0.3s ease;
}
.markdown-body h1,
.markdown-body h2,
.markdown-body h3 {
  margin: 0;
  padding: 0;
  letter-spacing: -0.01em;
  line-height: 1.25;
}
.markdown-body h1 {
  font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
  font-size: 35px;
  letter-spacing: -0.02em;
  margin-bottom: 12px;
}
.markdown-body h2 {
  font-size: 23px;
  margin: 28px 0 12px;
}
.markdown-body h3 {
  font-size: 19px;
  margin: 21px 0 10px;
}
.markdown-body .heading-text {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 8px;
  color: var(--page-text);
  background: var(--theme-h1);
}
.markdown-body h2 .heading-text {
  background: var(--theme-h2);
}
.markdown-body h3 .heading-text {
  background: var(--theme-h3);
}
.markdown-body p {
  margin: 8px 0 14px;
}
.markdown-body a {
  color: #134278;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
.markdown-body a:hover {
  color: #0e335c;
}
.markdown-body a:focus-visible,
.markdown-body summary:focus-visible,
.copy-code-button:focus-visible {
  outline: 3px solid #2b6cb0;
  outline-offset: 2px;
  border-radius: 6px;
}
.markdown-body ul,
.markdown-body ol {
  margin: 8px 0 16px;
  padding-left: 22px;
}
.markdown-body li {
  margin: 6px 0;
}
.markdown-body li.task-list-item {
  list-style: none;
}
.markdown-body li.task-list-item > p {
  margin: 0;
}
.markdown-body .task-list-item-checkbox {
  width: 1.02em;
  height: 1.02em;
  margin: 0 0.55em 0 0;
  vertical-align: middle;
  accent-color: var(--audio-accent);
  cursor: pointer;
  color-scheme: light;
  background-color: var(--page-card);
  border: 1px solid var(--page-line);
  border-radius: 3px;
  position: relative;
  top: -0.02em;
}
[data-theme="dark"] .markdown-body .task-list-item-checkbox {
  color-scheme: dark;
}
.markdown-body hr {
  border: none;
  border-top: 1px solid var(--page-line);
  margin: 24px 0;
}
.audio-figure {
  margin: 14px 0 20px;
  padding: 12px 14px;
  border: 1px solid var(--page-line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--page-card) 94%, var(--page-bg) 6%);
  transition: border-color 0.2s ease;
}
.audio-figure:hover,
.audio-figure:focus-within {
  border-color: var(--callout-border);
}
.audio-figure audio {
  width: 100%;
  margin: 0;
  accent-color: var(--audio-accent);
}
.audio-figure figcaption {
  margin-top: 8px;
  color: var(--page-muted);
  font-size: 13px;
}
.audio-placeholder {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 14px 0 20px;
  padding: 16px 20px;
  border: 1px dashed var(--page-line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--page-card) 60%, var(--page-bg) 40%);
  color: var(--page-muted);
  font-size: 14px;
}
.audio-placeholder svg {
  width: 20px;
  height: 20px;
  opacity: 0.6;
}
.pronunciation-word-tts {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: 0;
  flex-wrap: wrap;
}
.word-tts-button {
  border: 1px solid var(--page-line);
  background: var(--page-card);
  color: var(--page-text);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
  cursor: pointer;
  transition: border-color 0.2s ease, transform 0.2s ease;
}
.word-tts-button:hover {
  border-color: var(--callout-border);
  transform: translateY(-1px);
}
.word-tts-button:focus-visible {
  outline: 3px solid #2b6cb0;
  outline-offset: 2px;
}
.word-tts-transcription {
  color: color-mix(in srgb, var(--page-text) 90%, var(--theme-h2) 10%);
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.01em;
  font-family: 'Charis SIL', 'Noto Serif', 'Times New Roman', serif;
  text-shadow: 0 0 0.4px color-mix(in srgb, var(--page-card) 70%, transparent 30%);
}
.pronunciation-word-item {
  margin-bottom: 8px;
}
.pronunciation-word-main {
  display: inline-flex;
  align-items: baseline;
  justify-content: flex-start;
  gap: 12px;
  flex-wrap: wrap;
  width: auto;
  max-width: 100%;
}
.pronunciation-word-content {
  display: inline-flex;
  align-items: baseline;
  gap: 0;
  flex-wrap: wrap;
  min-width: 0;
}
.pronunciation-word-label {
  color: var(--page-text);
  font-weight: 600;
}
.pronunciation-word-note {
  margin-left: 2px;
  color: var(--page-muted);
  font-size: 12px;
}
.pronunciation-shadow-sentence {
  margin: 14px 0 16px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--theme-h2) 24%, var(--page-line) 76%);
  border-left: 5px solid var(--audio-accent);
  background: color-mix(in srgb, var(--theme-h2) 14%, var(--page-card) 86%);
  color: var(--page-text);
  font-size: 1.05em;
  line-height: 1.55;
}
.pronunciation-shadow-sentence strong {
  color: color-mix(in srgb, var(--page-text) 88%, var(--theme-h2) 12%);
  letter-spacing: 0.01em;
}
.callout {
  background: var(--callout-bg);
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid var(--page-line);
  border-left: 4px solid var(--callout-border);
  display: flex;
  gap: 12px;
  margin: 16px 0;
}
.callout .icon {
  font-size: 22px;
  line-height: 1.2;
  margin-top: 2px;
}
.callout .content > :first-child {
  margin-top: 0;
}
.callout .content > :last-child {
  margin-bottom: 0;
}
.study-text {
  background: color-mix(in srgb, var(--page-card) 94%, var(--page-bg) 6%);
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid var(--page-line);
  margin: 16px 0;
  transition: background-color 0.3s ease, border-color 0.3s ease;
}
.study-text summary {
  font-size: 13px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--page-muted);
  font-weight: 700;
  cursor: pointer;
}
.study-text .content {
  margin-top: 10px;
}
.study-text .content > :first-child {
  margin-top: 0;
}
.study-text .content > :last-child {
  margin-bottom: 0;
}
.column-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 20px;
}
.column {
  min-width: 240px;
}
.column-list.grammar-matrix-grid {
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  margin: 16px 0 20px;
  padding: clamp(14px, 2vw, 22px);
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--callout-border) 55%, var(--page-line) 45%);
  background:
    linear-gradient(
      140deg,
      color-mix(in srgb, var(--callout-bg) 68%, transparent 32%) 0%,
      color-mix(in srgb, var(--page-card) 92%, transparent 8%) 100%
    );
}
.column-list.grammar-matrix-grid .column {
  min-width: 0;
  padding: 14px 16px 15px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--page-line) 74%, var(--callout-border) 26%);
  background: color-mix(in srgb, var(--page-card) 90%, #ffffff 10%);
  box-shadow: 0 10px 22px color-mix(in srgb, var(--page-line) 42%, transparent 58%);
}
.column-list.grammar-matrix-grid .column > :first-child {
  margin-top: 0;
}
.column-list.grammar-matrix-grid .column > :last-child {
  margin-bottom: 0;
}
.column-list.grammar-matrix-grid .column > .grammar-card-heading {
  margin-top: 0;
  margin-bottom: 12px;
  padding: 2px 0 10px;
  border-bottom: 1px dashed color-mix(in srgb, var(--page-line) 65%, transparent 35%);
  text-wrap: balance;
}
.column-list.grammar-matrix-grid .column > .grammar-card-heading strong {
  display: block;
}
.column-list.grammar-matrix-grid .column > .grammar-card-heading .heading-text {
  background: transparent;
  padding: 0;
  border-radius: 0;
}
.column-list.grammar-matrix-grid .column p,
.column-list.grammar-matrix-grid .column li {
  text-wrap: pretty;
}
.column-list.grammar-matrix-grid .column p[data-grammar-prose="true"] {
  text-align: justify;
  text-justify: inter-word;
  hyphens: auto;
}
.column-list.grammar-matrix-grid .column > p > em:only-child {
  display: block;
  text-align: justify;
  text-justify: inter-word;
  text-align-last: left;
}
.video-embed {
  position: relative;
  padding-top: 56.25%;
  margin: 16px 0;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--page-line);
  background: #0f172a;
}
.video-embed iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
.table-of-contents {
  background: var(--toc-bg);
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--toc-border);
  margin: 10px 0 0;
  color: var(--page-muted);
}
.toc-shell {
  margin: 16px 0;
  border-radius: 12px;
  border: 1px solid var(--toc-border);
  background: color-mix(in srgb, var(--toc-bg) 72%, #ffffff 28%);
  overflow: hidden;
}
.toc-shell summary {
  cursor: pointer;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--page-muted);
  padding: 12px 14px;
  background: color-mix(in srgb, var(--toc-bg) 82%, var(--page-card) 18%);
  transition: background-color 0.3s ease, color 0.3s ease;
}
.toc-shell summary:hover {
  color: var(--page-text);
}
.has-sticky-toc .toc-shell {
  position: sticky;
  top: 14px;
  z-index: 5;
  max-height: min(58vh, 420px);
}
.has-sticky-toc .toc-shell[open] .table-of-contents {
  max-height: min(48vh, 320px);
  overflow: auto;
}
.table-of-contents ul {
  list-style: none;
  padding-left: 0;
  margin: 0;
}
.table-of-contents li {
  margin: 6px 0;
}
.table-of-contents a {
  color: var(--toc-link);
  text-decoration: none;
  transition: color 0.2s ease;
}
.table-of-contents a:hover {
  color: var(--page-text);
  text-decoration: underline;
}
details:not(.study-text) {
  margin: 12px 0;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--page-line);
  background: color-mix(in srgb, var(--page-card) 94%, var(--page-bg) 6%);
  transition: background-color 0.3s ease, border-color 0.3s ease;
}
details:not(.study-text) summary {
  cursor: pointer;
  font-weight: 600;
}
pre {
  position: relative;
  margin: 14px 0;
  border-radius: 12px;
  border: 1px solid var(--page-line);
  background: var(--callout-bg);
  padding: 14px 16px;
  overflow-x: auto;
  transition: background-color 0.3s ease, border-color 0.3s ease;
}
pre code {
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  font-size: 13px;
  line-height: 1.55;
}
.markdown-body p code,
.markdown-body li code,
.markdown-body td code,
.markdown-body th code,
.markdown-body blockquote code,
.markdown-body h1 code,
.markdown-body h2 code,
.markdown-body h3 code {
  background: var(--inline-code-bg);
  color: var(--inline-code-text);
  border-radius: 7px;
  padding: 0.14em 0.46em;
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  font-size: 0.92em;
  line-height: 1.2;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  transition: background-color 0.3s ease, color 0.3s ease;
}
.copy-code-button {
  position: absolute;
  top: 8px;
  right: 8px;
  border: 1px solid var(--page-line);
  background: #fff;
  color: var(--page-text);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 8px;
  cursor: pointer;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0 18px;
  font-size: 14px;
  table-layout: auto;
}
.markdown-body table[data-balanced-columns="true"] {
  table-layout: fixed;
}
th,
td {
  border: 1px solid var(--page-line);
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: normal;
  line-height: 1.5;
  min-width: 0;
}
.markdown-body td[data-col-role="meaning"],
.markdown-body td[data-col-role="example"] {
  text-wrap: pretty;
}
.markdown-body table[data-table-archetype="glossary_2col"] td[data-col-role="meaning"][data-cell-prose="true"],
.markdown-body table[data-table-archetype="long_meaning_3col"] td[data-col-role="meaning"][data-cell-prose="true"] {
  text-align: justify;
  text-justify: inter-word;
}
.markdown-body table[data-table-archetype="instructional_4col"] td[data-col-role="formula"],
.markdown-body table[data-table-archetype="emoji_split_4col"] td[data-col-role="emoji"],
.markdown-body td[data-col-role="expression"] {
  text-align: left;
}
.markdown-body td[data-col-role="formula"] {
  text-wrap: pretty;
}
th {
  background: var(--table-head-bg);
  font-weight: 700;
}
@media (max-width: 840px) {
  .page {
    margin: 10px;
    padding: 20px 18px 30px;
    border-radius: 14px;
  }
  .hero {
    min-height: 148px;
    padding: 16px 14px;
    gap: 12px;
  }
  .hero-emoji {
    font-size: clamp(64px, 20vw, 88px);
  }
  .markdown-body h1 {
    font-size: 30px;
  }
  .markdown-body h2 {
    font-size: 21px;
  }
  .has-sticky-toc .table-of-contents {
    position: static;
  }
  .column-list {
    grid-template-columns: 1fr;
  }
  .column-list.grammar-matrix-grid {
    padding: 12px;
    gap: 12px;
  }
  .column-list.grammar-matrix-grid .column p[data-grammar-prose="true"] {
    text-align: left;
    text-justify: auto;
  }
  .column-list.grammar-matrix-grid .column > p > em:only-child {
    text-align: left;
    text-justify: auto;
    text-align-last: auto;
  }
  .markdown-body table {
    display: block;
    max-width: 100%;
    width: max-content;
    min-width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .markdown-body table td[data-cell-prose="true"] {
    text-align: left;
    text-justify: auto;
  }
}
.theme-toggle {
  position: fixed;
  top: 20px;
  right: 24px;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--page-line);
  border-radius: 50%;
  background: var(--page-card);
  color: var(--page-muted);
  font-size: 18px;
  cursor: pointer;
  transition: border-color 0.2s ease, color 0.2s ease, transform 0.2s ease;
  box-shadow: 0 3px 12px rgba(36, 30, 18, 0.1);
}
.theme-toggle:hover {
  border-color: var(--callout-border);
  color: var(--page-text);
  transform: scale(1.05);
}
.theme-toggle .icon-sun,
.theme-toggle .icon-moon {
  position: absolute;
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.theme-toggle .icon-moon {
  opacity: 0;
  transform: rotate(-90deg) scale(0.8);
}
[data-theme="dark"] .theme-toggle .icon-sun {
  opacity: 0;
  transform: rotate(90deg) scale(0.8);
}
[data-theme="dark"] .theme-toggle .icon-moon {
  opacity: 1;
  transform: rotate(0) scale(1);
}
details {
  overflow: hidden;
}
details > .content {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.3s ease-out, opacity 0.3s ease-out, padding 0.3s ease;
  opacity: 0;
}
details.is-open > .content {
  grid-template-rows: 1fr;
  opacity: 1;
}
.content-inner {
  overflow: hidden;
}
.back-to-top {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 1px solid var(--page-line);
  border-radius: 50%;
  background: var(--page-card);
  color: var(--page-muted);
  font-size: 20px;
  cursor: pointer;
  opacity: 0;
  visibility: hidden;
  transform: translateY(12px);
  transition: opacity 0.25s ease, visibility 0.25s ease, transform 0.25s ease, border-color 0.2s ease, color 0.2s ease;
  box-shadow: 0 4px 16px rgba(36, 30, 18, 0.12);
}
.back-to-top:hover {
  border-color: var(--callout-border);
  color: var(--page-text);
}
.back-to-top.visible {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}
@media print {
  body {
    background: #fff;
  }
  .page {
    box-shadow: none;
    border: none;
    margin: 0;
    max-width: none;
    padding: 0;
  }
  .copy-code-button,
  .back-to-top,
  .theme-toggle {
    display: none !important;
  }
}
`;

type MarkdownItInstance = InstanceType<typeof MarkdownIt>;
type ContainerPlugin = (md: MarkdownItInstance, name: string, options: unknown) => void;
const TASK_LIST_ITEM_MARKER_REGEX = /^\[( |x|X)\]\s+/;

export async function renderToHtml(
  markdown: string,
  title: string,
  options: RenderOptions = {},
): Promise<string> {
  const resolved = resolveRenderOptions(options);
  const md = createRenderer();
  const frontmatter = extractFrontmatter(markdown);
  const resolvedTitle = resolveTitle(markdown, title, frontmatter);
  const prepared = preprocessMarkdown(markdown, resolved.allowRawHtml);
  const bodyHtml = replaceColumnMarkers(md.render(prepared));
  const withEmbeddedAudio = replaceAudioLinks(decorateAudioPlayers(bodyHtml));
  const withCollapsibleToc = wrapTableOfContents(withEmbeddedAudio);
  const withVocabularyHeaders = promoteUsefulChunksTableHeader(withCollapsibleToc);
  const withGrammarMatrix = decorateNoticeGrammarColumns(withVocabularyHeaders);
  const safeBody = sanitizeRenderedHtml(withGrammarMatrix, resolved.allowRawHtml);
  const css = buildCss(resolved);
  const header = renderHeader(resolvedTitle, frontmatter, resolved);
  const behaviorScript = buildBehaviorScript(resolved.features);
  const pageClasses = ['page', 'markdown-body'];
  if (resolved.features.stickyToc) {
    pageClasses.push('has-sticky-toc');
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Charis+SIL:ital,wght@0,400;0,700;1,400;1,700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <title>${escapeHtml(resolvedTitle)}</title>
  <style>${css}</style>
</head>
<body class="markdown-body">
  <main id="content" class="${pageClasses.join(' ')}">
    ${header}
    ${safeBody}
  </main>
  <button type="button" class="theme-toggle" aria-label="Toggle dark mode"><span class="icon-sun">☀️</span><span class="icon-moon">🌙</span></button>
  <button type="button" class="back-to-top" aria-label="Back to top">↑</button>
  ${behaviorScript}
</body>
</html>`;
}

export async function createStaticPageHtml(
  markdown: string,
  title: string,
  options: RenderOptions = {},
): Promise<string> {
  return renderToHtml(markdown, title, options);
}

function createRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: true,
  });

  md.use(anchor);
  md.use(toc, { listType: 'ul', containerClass: 'table-of-contents' });

  const containerPlugin = container as unknown as ContainerPlugin;

  md.use(containerPlugin, 'toggle', {
    validate: (params: string) => params.trim().startsWith('toggle '),
    render: (tokens: { info?: string; nesting?: number }[], idx: number) => {
      const info = tokens[idx]?.info?.trim() ?? '';
      const match = /^toggle\s+(.*)$/.exec(info);
      const label = match?.[1] ?? 'Details';
      if (tokens[idx]?.nesting === 1) {
        return `<details><summary>${escapeHtml(label)}</summary><div class="content"><div class="content-inner">`;
      }
      return '</div></div></details>';
    },
  });

  md.use(containerPlugin, 'callout', {
    validate: (params: string) => params.trim().startsWith('callout '),
    render: (tokens: { info?: string; nesting?: number }[], idx: number) => {
      const info = tokens[idx]?.info?.trim() ?? '';
      const match = /^callout\s+(.*)$/.exec(info);
      const icon = match?.[1] ?? 'Info';
      if (tokens[idx]?.nesting === 1) {
        return `<aside class="callout"><div class="icon">${escapeHtml(icon)}</div><div class="content">`;
      }
      return '</div></aside>';
    },
  });

  md.use(containerPlugin, 'study-text', {
    validate: (params: string) => params.trim().startsWith('study-text'),
    render: (tokens: { info?: string; nesting?: number }[], idx: number) => {
      const info = tokens[idx]?.info?.trim() ?? '';
      const match = /^study-text\s*(.*)$/.exec(info);
      const label = match?.[1]?.trim();
      const summaryTitle = label ? `Study Text: ${label}` : 'Study Text';
      if (tokens[idx]?.nesting === 1) {
        return `<details class="study-text"><summary>${escapeHtml(summaryTitle)}</summary><div class="content"><div class="content-inner">`;
      }
      return '</div></div></details>';
    },
  });

  md.renderer.rules.heading_open = (tokens, idx, renderOptions, _env, self) => {
    const rendered = self.renderToken(tokens, idx, renderOptions);
    return `${rendered}<span class="heading-text">`;
  };

  md.renderer.rules.heading_close = (tokens, idx, renderOptions, _env, self) => {
    const rendered = self.renderToken(tokens, idx, renderOptions);
    return `</span>${rendered}`;
  };

  const defaultCodeInlineRule = md.renderer.rules.code_inline;
  const richInlineMarkdown = new MarkdownIt({
    html: false,
    linkify: false,
    breaks: false,
  });
  md.renderer.rules.code_inline = (tokens, idx, renderOptions, env, self) => {
    const token = tokens[idx];
    if (!token) return '';
    if ((token.markup || '').length !== 1) {
      if (defaultCodeInlineRule) {
        return defaultCodeInlineRule(tokens, idx, renderOptions, env, self);
      }
      return `<code>${md.utils.escapeHtml(token.content ?? '')}</code>`;
    }
    const richContent = richInlineMarkdown.renderInline(token.content ?? '');
    return `<code>${richContent}</code>`;
  };

  applyTaskListRule(md);

  return md;
}

function applyTaskListRule(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'task_list_checkboxes', (state) => {
    const listStack: number[] = [];
    const listItemStack: { tokenIndex: number; firstInlineSeen: boolean }[] = [];

    for (let index = 0; index < state.tokens.length; index += 1) {
      const token = state.tokens[index];
      if (!token) continue;

      if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
        listStack.push(index);
        continue;
      }
      if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
        listStack.pop();
        continue;
      }
      if (token.type === 'list_item_open') {
        listItemStack.push({ tokenIndex: index, firstInlineSeen: false });
        continue;
      }
      if (token.type === 'list_item_close') {
        listItemStack.pop();
        continue;
      }
      if (token.type !== 'inline') {
        continue;
      }
      if (listStack.length === 0 || listItemStack.length === 0) {
        continue;
      }

      const currentListItemContext = listItemStack.at(-1);
      if (!currentListItemContext || currentListItemContext.firstInlineSeen) {
        continue;
      }
      currentListItemContext.firstInlineSeen = true;

      const currentListIndex = listStack.at(-1);
      const currentListItemIndex = currentListItemContext.tokenIndex;
      if (currentListIndex === undefined || currentListItemIndex === undefined) {
        continue;
      }

      const listToken = state.tokens[currentListIndex];
      const listItemToken = state.tokens[currentListItemIndex];
      const previousToken = state.tokens[index - 1];
      if (!listToken || !listItemToken || typeof listItemToken.level !== 'number') {
        continue;
      }

      const isLeadParagraphInline =
        previousToken?.type === 'paragraph_open' && previousToken.level === listItemToken.level + 1;
      if (!isLeadParagraphInline) {
        continue;
      }

      const marker = TASK_LIST_ITEM_MARKER_REGEX.exec(token.content ?? '');
      if (!marker) {
        continue;
      }

      appendTokenClass(listToken, 'task-list');
      appendTokenClass(listItemToken, 'task-list-item');

      const checked = (marker[1] ?? '').toLowerCase() === 'x';
      token.content = token.content.replace(TASK_LIST_ITEM_MARKER_REGEX, '');

      const children = token.children ? [...token.children] : [];
      const firstChild = children[0];
      if (firstChild?.type === 'text') {
        firstChild.content = firstChild.content.replace(TASK_LIST_ITEM_MARKER_REGEX, '');
        if (firstChild.content.length === 0) {
          children.shift();
        }
      } else if (token.content.length > 0) {
        const textToken = new state.Token('text', '', 0);
        textToken.content = token.content;
        children.unshift(textToken);
      }

      const checkboxToken = new state.Token('html_inline', '', 0);
      checkboxToken.content = `<input type="checkbox" class="task-list-item-checkbox"${checked ? ' checked' : ''}> `;
      token.children = [checkboxToken, ...children];
    }
  });
}

function appendTokenClass(
  token: {
    attrGet: (name: string) => string | null;
    attrSet: (name: string, value: string) => void;
  },
  className: string,
): void {
  const current = token.attrGet('class');
  if (!current) {
    token.attrSet('class', className);
    return;
  }

  const classes = new Set(current.split(/\s+/).filter(Boolean));
  classes.add(className);
  token.attrSet('class', [...classes].join(' '));
}

function preprocessMarkdown(markdown: string, allowRawHtml: boolean): string {
  const normalizedPronunciation = normalizePronunciationSectionMarkdown(markdown);
  const withoutFrontmatter = stripFrontmatter(normalizedPronunciation);
  const lines = withoutFrontmatter.split('\n');
  const out: string[] = [];
  const stack: string[] = [];
  let fencedBy: '```' | '~~~' | null = null;

  for (const line of lines) {
    const directiveNormalizedLine = normalizeDirectiveLine(line);
    const directiveTrimmed = directiveNormalizedLine.trim();

    if (isFenceLine(directiveTrimmed)) {
      const fence = directiveTrimmed.startsWith('```') ? '```' : '~~~';
      if (fencedBy && fence === fencedBy) {
        fencedBy = null;
      } else if (!fencedBy) {
        fencedBy = fence;
      }
      out.push(directiveNormalizedLine);
      continue;
    }

    if (fencedBy) {
      out.push(directiveNormalizedLine);
      continue;
    }

    const normalizedLine = normalizeBulletedNumberedListLine(directiveNormalizedLine);
    const trimmed = normalizedLine.trim();

    if (/^:::\s*toc$/.test(trimmed)) {
      out.push('[[toc]]');
      continue;
    }

    if (/^:::\s*audio(\s+|$)/.test(trimmed)) {
      const rawUrl = trimmed.replace(/^:::\s*audio(\s+|$)/, '').trim();
      const safeUrl = sanitizeMediaUrl(rawUrl);
      if (safeUrl) {
        out.push(
          `<audio controls preload="metadata" src="${escapeHtmlAttribute(safeUrl)}"></audio>`,
        );
      } else {
        out.push(renderAudioPlaceholder());
      }
      continue;
    }

    if (/^:::\s*video\s+/.test(trimmed)) {
      const rawUrl = trimmed.replace(/^:::\s*video\s+/, '').trim();
      out.push(buildVideoEmbed(rawUrl));
      continue;
    }

    const openMatch = /^:::\s*([A-Za-z0-9_-]+)\b/.exec(trimmed);
    if (openMatch) {
      const name = openMatch[1] ?? '';
      if (!name) {
        out.push(escapeRawHtmlLine(normalizedLine, allowRawHtml));
        continue;
      }

      stack.push(name);
      if (name === 'column-list') {
        out.push('<!--COLUMN_LIST_START-->');
        continue;
      }
      if (name === 'column') {
        out.push('<!--COLUMN_START-->');
        continue;
      }
      out.push(normalizedLine);
      continue;
    }

    if (trimmed === ':::') {
      const last = stack.pop();
      if (last === 'column') {
        out.push('<!--COLUMN_END-->');
        continue;
      }
      if (last === 'column-list') {
        out.push('<!--COLUMN_LIST_END-->');
        continue;
      }
      out.push(normalizedLine);
      continue;
    }

    out.push(escapeRawHtmlLine(normalizedLine, allowRawHtml));
  }

  while (stack.length > 0) {
    const last = stack.pop();
    if (last === 'column') {
      out.push('<!--COLUMN_END-->');
    } else if (last === 'column-list') {
      out.push('<!--COLUMN_LIST_END-->');
    }
  }

  return out.join('\n');
}

function normalizePronunciationSectionMarkdown(markdown: string): string {
  const lines = markdown.split('\n');
  const normalized: string[] = [];
  let inPronunciationSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^###\s+.*pronunciation.*micro.*focus/i.test(trimmed)) {
      inPronunciationSection = true;
      normalized.push(line);
      continue;
    }
    if (inPronunciationSection && /^#{2,3}\s+/.test(trimmed)) {
      inPronunciationSection = false;
      normalized.push(line);
      continue;
    }
    if (!inPronunciationSection) {
      normalized.push(line);
      continue;
    }

    let next = trimmed;

    const codeWrappedField = /^(?:[-*]\s+)?`(\*\*(?:mode|shadow sentence):\*\*.+)`$/i.exec(next);
    if (codeWrappedField?.[1]) {
      normalized.push(codeWrappedField[1]);
      continue;
    }

    const plainBulletField = /^(?:[-*]\s+)(\*\*(?:mode|shadow sentence):\*\*.+)$/i.exec(next);
    if (plainBulletField?.[1]) {
      normalized.push(plainBulletField[1]);
      continue;
    }

    const bulletedNumbered = /^(?:[-*]\s+)(\d+\.\s+.+)$/.exec(next);
    if (bulletedNumbered?.[1]) {
      next = bulletedNumbered[1];
    }

    normalized.push(line.replace(trimmed, next));
  }

  return normalized.join('\n');
}

function escapeRawHtmlLine(line: string, allowRawHtml: boolean): string {
  if (allowRawHtml) {
    return line;
  }
  if (!line.includes('<') && !line.includes('>')) {
    return line;
  }

  // Preserve explicit markdown line-break intent while escaping all other raw HTML.
  const breakPlaceholder = '__ESL_HTML_BR_PLACEHOLDER__';
  const withPreservedBreaks = line.replaceAll(/<br\s*\/?>/gi, breakPlaceholder);
  return withPreservedBreaks
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll(breakPlaceholder, '<br>');
}

function isFenceLine(trimmed: string): boolean {
  return trimmed.startsWith('```') || trimmed.startsWith('~~~');
}

function stripFrontmatter(markdown: string): string {
  const frontmatterMatch = markdown.match(/^---\n[\s\S]*?\n---\n/);
  if (frontmatterMatch) {
    return markdown.slice(frontmatterMatch[0].length);
  }
  return markdown;
}

function normalizeDirectiveLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith(':::') && !trimmed.startsWith('::: ')) {
    const match = /^:::(\S+)(.*)$/.exec(trimmed);
    if (match) {
      return line.replace(trimmed, `::: ${match[1]}${match[2] ?? ''}`);
    }
  }
  return line;
}

function normalizeBulletedNumberedListLine(line: string): string {
  const match = /^(\s*)[*-]\s+(\d+)\.\s+(.+)$/.exec(line);
  if (!match) return line;
  const indent = match[1] ?? '';
  const number = match[2] ?? '';
  const rest = match[3] ?? '';
  if (indent.length > 3) {
    return line;
  }
  return `${indent}${number}. ${rest}`;
}

function resolveTitle(markdown: string, explicitTitle?: string, frontmatter?: Frontmatter): string {
  if (explicitTitle && explicitTitle.trim().length > 0) {
    return explicitTitle.trim();
  }
  const frontmatterTitle = frontmatter?.title ?? extractFrontmatterTitle(markdown);
  return frontmatterTitle ?? 'Untitled';
}

function extractFrontmatterTitle(markdown: string): string | null {
  const match = markdown.match(/^---\n[\s\S]*?\n---\n/);
  if (!match) return null;
  const titleMatch = match[0].match(/^\s*title:\s*(.+)\s*$/m);
  if (!titleMatch) return null;
  const raw = titleMatch[1] ? titleMatch[1].trim() : '';
  if (!raw) return null;
  return raw.replaceAll(/^['"]|['"]$/g, '');
}

interface Frontmatter {
  title?: string;
  icon?: string;
  student?: string;
  topic?: string;
}

function extractFrontmatter(markdown: string): Frontmatter {
  const match = markdown.match(/^---\n[\s\S]*?\n---\n/);
  if (!match) return {};
  const block = match[0];
  const lines = block.split('\n').slice(1, -1);
  const result: Frontmatter = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(trimmed);
    if (!kv) continue;
    const key = kv[1] ?? '';
    const rawValue = kv[2] ?? '';
    const value = normalizeFrontmatterValue(rawValue);
    if (key === 'title') result.title = value;
    if (key === 'icon') result.icon = value;
    if (key === 'student') result.student = value;
    if (key === 'topic') result.topic = value;
  }

  return result;
}

function normalizeFrontmatterValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replaceAll(/^['"]|['"]$/g, ''))
      .filter(Boolean)
      .join(', ');
  }
  return trimmed.replaceAll(/^['"]|['"]$/g, '');
}

function renderHeader(
  title: string,
  frontmatter: Frontmatter,
  options: ResolvedRenderOptions,
): string {
  const iconValue = frontmatter.icon?.trim() || '📘';
  const icon = `<div class="hero-emoji" aria-hidden="true">${escapeHtml(iconValue)}</div>`;

  const tags: string[] = [];
  if (options.showGeneratedDate) {
    tags.push(formatCurrentDate());
  }
  if (frontmatter.student) tags.push(frontmatter.student);
  if (frontmatter.topic) tags.push(frontmatter.topic);

  const tagHtml =
    tags.length > 0
      ? `<div class="page-tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>`
      : '';

  return `<header class="page-header"><div class="hero">${icon}<div class="hero-content"><h1 class="hero-title">${escapeHtml(title)}</h1>${tagHtml}</div></div></header>`;
}

function formatCurrentDate(): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());
}

function buildVideoEmbed(url: string): string {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return `<p><a href="#">Video link is invalid</a></p>`;
  }

  const youtubeId = extractYouTubeId(parsed);
  if (youtubeId) {
    const src = `https://www.youtube.com/embed/${youtubeId}`;
    return `<div class="video-embed"><iframe src="${src}" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
  }

  const vimeoId = extractVimeoId(parsed);
  if (vimeoId) {
    const src = `https://player.vimeo.com/video/${vimeoId}${parsed.search || ''}`;
    return `<div class="video-embed"><iframe src="${src}" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
  }

  const safeHref = sanitizeLinkHref(parsed.href);
  return `<p><a href="${escapeHtmlAttribute(safeHref)}" target="_blank" rel="noopener noreferrer">Open video</a></p>`;
}

function parseHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isHostOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function extractYouTubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (isHostOrSubdomain(host, 'youtube.com')) {
    const idFromQuery = url.searchParams.get('v');
    if (idFromQuery && /^[\w-]{6,}$/.test(idFromQuery)) {
      return idFromQuery;
    }
    if (url.pathname.startsWith('/embed/')) {
      const id = url.pathname.replace('/embed/', '').split('/')[0] ?? '';
      return /^[\w-]{6,}$/.test(id) ? id : null;
    }
    if (url.pathname.startsWith('/shorts/')) {
      const id = url.pathname.replace('/shorts/', '').split('/')[0] ?? '';
      return /^[\w-]{6,}$/.test(id) ? id : null;
    }
  }

  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\//, '').split('/')[0] ?? '';
    return /^[\w-]{6,}$/.test(id) ? id : null;
  }

  return null;
}

function extractVimeoId(url: URL): string | null {
  if (!isHostOrSubdomain(url.hostname.toLowerCase(), 'vimeo.com')) {
    return null;
  }
  const normalizedPath = url.pathname.replaceAll(/^\/+/g, '').replaceAll(/\/+$/g, '');
  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  const direct = segments[0] ?? '';
  if (/^\d+$/.test(direct)) {
    return direct;
  }

  if (segments[0] === 'video' && /^\d+$/.test(segments[1] ?? '')) {
    return segments[1] ?? null;
  }

  if (segments[0] === 'channels' && /^\d+$/.test(segments[2] ?? '')) {
    return segments[2] ?? null;
  }

  if (segments[0] === 'groups' && segments[2] === 'videos' && /^\d+$/.test(segments[3] ?? '')) {
    return segments[3] ?? null;
  }

  if (segments[0] === 'album' && segments[2] === 'video' && /^\d+$/.test(segments[3] ?? '')) {
    return segments[3] ?? null;
  }

  return null;
}

function decorateAudioPlayers(html: string): string {
  return html.replaceAll(
    /<audio\s+controls(?:\s+preload="metadata")?\s+src=("|')([^"']+)\1\s*><\/audio>/gi,
    (_full, _quote, rawUrl) => renderAudioFigure(rawUrl),
  );
}

function replaceAudioLinks(html: string): string {
  return html.replaceAll(
    /<a\b([^>]*)href=("|')([^"']+\.(?:mp3|wav|m4a|aac|ogg|opus)(?:\?[^"']*)?(?:#[^"']*)?)\2([^>]*)>([\s\S]*?)<\/a>/gi,
    (fullMatch, before, _quote, url, after, labelHtml) => {
      const attrs = `${before ?? ''}${after ?? ''}`;
      if (attrs.toLowerCase().includes('data-audio-fallback')) {
        return fullMatch;
      }
      const label = stripHtml(labelHtml).trim() || 'Open audio in a new tab';
      return renderAudioFigure(url, label);
    },
  );
}

function renderAudioPlaceholder(): string {
  return `<div class="audio-placeholder">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
<span>Audio track generating...</span>
</div>`;
}

function renderAudioFigure(url: string, fallbackLabel = 'Open audio in a new tab'): string {
  const safeUrl = sanitizeMediaUrl(url);
  if (!safeUrl) {
    return renderAudioPlaceholder();
  }

  const escapedUrl = escapeHtmlAttribute(safeUrl);
  return `<figure class="audio-figure"><audio controls preload="metadata" src="${escapedUrl}"></audio><figcaption><a data-audio-fallback="true" href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(fallbackLabel)}</a></figcaption></figure>`;
}

function sanitizeRenderedHtml(html: string, allowRawHtml: boolean): string {
  let sanitized = html;

  sanitized = sanitized.replaceAll(/<script\b[\s\S]*?<\/script>/gi, '');
  sanitized = sanitized.replaceAll(/<style\b[\s\S]*?<\/style>/gi, '');
  sanitized = sanitized.replaceAll(/\son[a-z]+=("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  sanitized = sanitized.replaceAll(/<iframe\b[\s\S]*?<\/iframe>/gi, (iframeBlock) => {
    const srcMatch = iframeBlock.match(/\ssrc=("|')([^"']+)\1/i);
    const src = srcMatch?.[2] ?? '';
    return isAllowedEmbedUrl(src) ? iframeBlock : '';
  });

  sanitized = sanitized.replaceAll(
    /\s(href|src)=("|')([^"']*)(\2)/gi,
    (full, attr, quote, value) => {
      const attribute = String(attr).toLowerCase();
      const safeValue =
        attribute === 'href' ? sanitizeLinkHref(value) : (sanitizeMediaUrl(value) ?? '#');
      return ` ${attribute}=${quote}${escapeHtmlAttribute(safeValue)}${quote}`;
    },
  );

  if (!allowRawHtml) {
    sanitized = sanitized.replaceAll(/<object\b[\s\S]*?<\/object>/gi, '');
    sanitized = sanitized.replaceAll(/<embed\b[^>]*>/gi, '');
  }

  return sanitized;
}

function sanitizeMediaUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  if (hasBlockedUrlChars(trimmed)) {
    return null;
  }

  if (isSafeRelativePath(trimmed)) {
    return trimmed;
  }

  const parsed = parseHttpUrl(trimmed);
  return parsed?.href ?? null;
}

function sanitizeLinkHref(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '#';
  }

  if (hasBlockedUrlChars(trimmed)) {
    return '#';
  }

  if (trimmed.startsWith('#') || isSafeRelativePath(trimmed)) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('mailto:') || lower.startsWith('tel:')) {
    return trimmed;
  }

  const parsed = parseHttpUrl(trimmed);
  return parsed?.href ?? '#';
}

function hasBlockedUrlChars(value: string): boolean {
  if (/\s/u.test(value)) {
    return true;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index) ?? -1;
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function hasExplicitScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

function isSafeRelativePath(value: string): boolean {
  if (!value) {
    return false;
  }
  if (value.startsWith('//') || value.startsWith('#')) {
    return false;
  }
  if (
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('?')
  ) {
    return true;
  }
  if (hasExplicitScheme(value)) {
    return false;
  }
  return true;
}

function isAllowedEmbedUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed || parsed.protocol !== 'https:') {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  return (
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtu.be' ||
    host === 'player.vimeo.com' ||
    host.endsWith('.player.vimeo.com')
  );
}

function replaceColumnMarkers(html: string): string {
  return html
    .replaceAll('<!--COLUMN_LIST_START-->', '<div class="column-list">')
    .replaceAll('<!--COLUMN_LIST_END-->', '</div>')
    .replaceAll('<!--COLUMN_START-->', '<div class="column">')
    .replaceAll('<!--COLUMN_END-->', '</div>');
}

function wrapTableOfContents(html: string): string {
  return html.replaceAll(
    /<(nav|div)\s+class="table-of-contents"[\s\S]*?<\/\1>/gi,
    (tocHtml) =>
      `<details class="toc-shell"><summary>Contents</summary><div class="content"><div class="content-inner">${tocHtml}</div></div></details>`,
  );
}

function promoteUsefulChunksTableHeader(html: string): string {
  return html.replaceAll(
    /(<h([1-6])\b[^>]*>[\s\S]*?<\/h\2>)([\s\S]*?)(?=<h[1-6]\b[^>]*>|$)/gi,
    (fullSection, headingHtml, _headingLevel, sectionHtml) => {
      const normalizedHeading = normalizeHeadingText(headingHtml);
      if (!normalizedHeading.includes('useful chunks & vocabulary')) {
        return fullSection;
      }
      return `${headingHtml}${promoteFirstTableRowToHeaderCells(sectionHtml)}`;
    },
  );
}

function decorateNoticeGrammarColumns(html: string): string {
  return html.replaceAll(
    /(<h([1-6])\b[^>]*>[\s\S]*?<\/h\2>)([\s\S]*?)(?=<h[1-6]\b[^>]*>|$)/gi,
    (fullSection, headingHtml, _headingLevel, sectionHtml) => {
      const normalizedHeading = normalizeHeadingText(headingHtml);
      if (!normalizedHeading.includes('notice the grammar')) {
        return fullSection;
      }

      const withScopedGrid = sectionHtml.replace(
        /<div class="column-list">/,
        '<div class="column-list grammar-matrix-grid">',
      );
      const decoratedSection = normalizeGrammarMatrixColumnMarkup(withScopedGrid);
      return `${headingHtml}${decoratedSection}`;
    },
  );
}

function normalizeGrammarMatrixColumnMarkup(sectionHtml: string): string {
  return sectionHtml.replaceAll(
    /<div class="column">([\s\S]*?)<\/div>/gi,
    (_columnHtml, columnInner) => {
      let normalizedInner = String(columnInner || '')
        .replaceAll(/<hr\s*\/?>/gi, '')
        .trim();
      normalizedInner = splitStackedGrammarParagraphs(normalizedInner);
      normalizedInner = mergeFragmentedRuleParagraphs(normalizedInner);
      normalizedInner = normalizedInner.replaceAll(
        /<p\b([^>]*)>([\s\S]*?)<\/p>/gi,
        (_paragraphHtml, rawAttrs: string, rawContent: string) => {
          const attrs = rawAttrs || '';
          const normalizedContent = normalizeInlineHtmlSpacing(String(rawContent || ''));
          const plainText = normalizedContent
            .replaceAll(/<[^>]+>/g, ' ')
            .replaceAll(/\s+/g, ' ')
            .trim();
          const wordCount = plainText.length > 0 ? plainText.split(' ').filter(Boolean).length : 0;
          const isRuleParagraph = /^rule:/i.test(plainText);
          const useProseAlignment = !isRuleParagraph && wordCount >= 12;
          const proseAttribute = useProseAlignment ? ' data-grammar-prose="true"' : '';
          return `<p${attrs}${proseAttribute}>${normalizedContent}</p>`;
        },
      );
      normalizedInner = markFirstGrammarHeading(normalizedInner);
      return `<div class="column">${normalizedInner}</div>`;
    },
  );
}

function normalizeInlineHtmlSpacing(content: string): string {
  return String(content || '')
    .replaceAll(/<br\s*\/?>/gi, ' ')
    .replaceAll(/\s{2,}/g, ' ')
    .trim();
}

function splitStackedGrammarParagraphs(columnInner: string): string {
  return columnInner.replaceAll(
    /<p\b([^>]*)>([\s\S]*?)<\/p>/gi,
    (fullMatch, rawAttrs: string, rawContent: string) => {
      const content = String(rawContent || '');
      if (!/<br\s*\/?>/i.test(content)) {
        return fullMatch;
      }

      const attrs = rawAttrs || '';
      const segments = content
        .split(/<br\s*\/?>/gi)
        .map((segment) => normalizeInlineHtmlSpacing(segment))
        .filter((segment) => segment.length > 0);

      if (segments.length < 2) {
        return fullMatch;
      }

      return segments.map((segment) => `<p${attrs}>${segment}</p>`).join('');
    },
  );
}

function mergeFragmentedRuleParagraphs(columnInner: string): string {
  return columnInner.replaceAll(
    /<p\b([^>]*)>\s*<strong>\s*Rule:\s*<\/strong>\s*<\/p>\s*((?:<p\b[^>]*>[\s\S]*?<\/p>\s*){1,6})/gi,
    (_fullMatch, ruleAttrs: string, followingParagraphs: string) => {
      const paragraphRegex = /<p\b[^>]*>([\s\S]*?)<\/p>\s*/gi;
      const ruleSegments: string[] = [];
      let boundary = 0;
      let paragraphMatch = paragraphRegex.exec(followingParagraphs);

      while (paragraphMatch) {
        const normalizedSegment = normalizeInlineHtmlSpacing(String(paragraphMatch[1] || ''));
        const plainText = stripHtml(normalizedSegment).replaceAll(/\s+/g, ' ').trim();
        boundary = paragraphRegex.lastIndex;
        if (!plainText) {
          paragraphMatch = paragraphRegex.exec(followingParagraphs);
          continue;
        }

        ruleSegments.push(normalizedSegment);
        if (/[.!?](?:["')\]]+)?$/.test(plainText) || ruleSegments.length >= 4) {
          break;
        }
        paragraphMatch = paragraphRegex.exec(followingParagraphs);
      }

      if (ruleSegments.length === 0) {
        return `<p${ruleAttrs}><strong>Rule:</strong></p>${followingParagraphs}`;
      }

      const mergedRuleHtml = normalizeInlineHtmlSpacing(
        `<strong>Rule:</strong> ${ruleSegments.join(' ')}`,
      ).replaceAll(/\s+([,.;!?])/g, '$1');
      const remainder = followingParagraphs.slice(boundary);
      return `<p${ruleAttrs}>${mergedRuleHtml}</p>${remainder}`;
    },
  );
}

function markFirstGrammarHeading(columnInner: string): string {
  const headingMatch = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/i.exec(columnInner);
  const paragraphMatch = /<p\b([^>]*)>([\s\S]*?)<\/p>/i.exec(columnInner);

  const headingIndex = headingMatch
    ? (headingMatch.index ?? Number.POSITIVE_INFINITY)
    : Number.POSITIVE_INFINITY;
  const paragraphIndex = paragraphMatch
    ? (paragraphMatch.index ?? Number.POSITIVE_INFINITY)
    : Number.POSITIVE_INFINITY;

  if (!Number.isFinite(headingIndex) && !Number.isFinite(paragraphIndex)) {
    return columnInner;
  }

  if (headingIndex <= paragraphIndex && headingMatch?.[0]) {
    const fullMatch = headingMatch[0];
    const level = headingMatch[1];
    const attrs = headingMatch[2] || '';
    const content = headingMatch[3] || '';
    const replacement = `<h${level}${appendClassToHtmlAttributes(attrs, 'grammar-card-heading')}>${content}</h${level}>`;
    return `${columnInner.slice(0, headingIndex)}${replacement}${columnInner.slice(headingIndex + fullMatch.length)}`;
  }

  if (!paragraphMatch?.[0]) {
    return columnInner;
  }

  const fullMatch = paragraphMatch[0];
  const attrs = paragraphMatch[1] || '';
  const content = paragraphMatch[2] || '';
  const replacement = `<p${appendClassToHtmlAttributes(attrs, 'grammar-card-heading')}>${content}</p>`;
  return `${columnInner.slice(0, paragraphIndex)}${replacement}${columnInner.slice(paragraphIndex + fullMatch.length)}`;
}

function appendClassToHtmlAttributes(attributes: string, className: string): string {
  if (!attributes || attributes.trim().length === 0) {
    return ` class="${className}"`;
  }
  const classAttrRegex = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/i;
  const classAttrMatch = classAttrRegex.exec(attributes);
  if (!classAttrMatch) {
    return `${attributes} class="${className}"`;
  }
  const existingClassValue = classAttrMatch[2] ?? classAttrMatch[3] ?? '';
  const classes = new Set(existingClassValue.split(/\s+/).filter(Boolean));
  classes.add(className);
  const updatedClassAttr = `class="${[...classes].join(' ')}"`;
  return attributes.replace(classAttrRegex, updatedClassAttr);
}

function promoteFirstTableRowToHeaderCells(sectionHtml: string): string {
  return sectionHtml.replace(/<table\b[^>]*>[\s\S]*?<\/table>/i, (tableHtml) => {
    if (/<th\b/i.test(tableHtml)) {
      return tableHtml;
    }

    return tableHtml.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/i, (rowHtml) => {
      if (!/<td\b/i.test(rowHtml)) {
        return rowHtml;
      }
      return rowHtml
        .replaceAll(/<td(\s[^>]*)?>/gi, (_fullCell, attrs = '') => {
          if (/\bscope\s*=/.test(attrs)) {
            return `<th${attrs}>`;
          }
          return `<th${attrs} scope="col">`;
        })
        .replaceAll(/<\/td>/gi, '</th>');
    });
  });
}

function normalizeHeadingText(headingHtml: string): string {
  return stripHtml(headingHtml)
    .replaceAll(/&(?:amp|#38|#x26);/gi, '&')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildCss(options: ResolvedRenderOptions): string {
  const theme = options.theme;
  const themeCss = `
:root {
  --theme-h1: ${theme.h1};
  --theme-h2: ${theme.h2};
  --theme-h3: ${theme.h3};
  --page-bg: ${theme.pageBg};
  --page-card: ${theme.pageCard};
  --page-text: ${theme.pageText};
  --page-muted: ${theme.pageMuted};
  --page-line: ${theme.pageLine};
  --callout-bg: ${theme.calloutBg};
  --callout-border: ${theme.calloutBorder};
  --toc-bg: ${theme.tocBg};
  --toc-border: ${theme.tocBorder};
}`;

  return `${DEFAULT_CSS}\n${themeCss}\n${options.css ?? ''}`.trim();
}

function buildBehaviorScript(features: ResolvedFeatures): string {
  const copyCode = features.copyCode ? 'true' : 'false';

  // eslint-disable-next-line unicorn/prefer-string-raw
  return `<script>
(() => {
  const copyCode = ${copyCode};

  if (copyCode) {
    const codeBlocks = document.querySelectorAll('pre > code');
    codeBlocks.forEach((codeElement) => {
      const pre = codeElement.parentElement;
      if (!(pre instanceof HTMLElement)) {
        return;
      }
      if (pre.querySelector('.copy-code-button')) {
        return;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy-code-button';
      button.textContent = 'Copy';
      button.addEventListener('click', async () => {
        const content = codeElement.textContent ?? '';
        if (!content) {
          return;
        }

        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(content);
          } else {
            const area = document.createElement('textarea');
            area.value = content;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.focus();
            area.select();
            document.execCommand('copy');
            document.body.removeChild(area);
          }
          const previousLabel = button.textContent;
          button.textContent = 'Copied';
          window.setTimeout(() => {
            button.textContent = previousLabel ?? 'Copy';
          }, 1400);
        } catch {
          button.textContent = 'Failed';
          window.setTimeout(() => {
            button.textContent = 'Copy';
          }, 1400);
        }
      });

      pre.appendChild(button);
    });
  }

  const backToTop = document.querySelector('.back-to-top');
  if (backToTop instanceof HTMLElement) {
    const showThreshold = 300;
    let ticking = false;

    const updateVisibility = () => {
      if (window.scrollY > showThreshold) {
        backToTop.classList.add('visible');
      } else {
        backToTop.classList.remove('visible');
      }
      ticking = false;
    };

    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(updateVisibility);
        ticking = true;
      }
    }, { passive: true });

    backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Force animation replay on details toggle
  document.querySelectorAll('details').forEach((details) => {
    if (details.open) {
      details.classList.add('is-open');
    }
    details.addEventListener('toggle', () => {
      if (details.open) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            details.classList.add('is-open');
          });
        });
      } else {
        details.classList.remove('is-open');
      }
    });
  });

  try {
    const lockTrailingWords = (value, wordsToLock = 2) => {
      let next = String(value || '')
        .replace(/[ \\t\\r\\n\\f]+/g, ' ')
        .trim();
      if (!next) {
        return '';
      }
      for (let index = 1; index < wordsToLock; index += 1) {
        const match = /(\\S+)\\s+(\\S+)(\\s*)$/.exec(next);
        if (!match?.[1] || !match[2]) {
          break;
        }
        const prefix = next.slice(0, match.index).trimEnd();
        const suffix = match[3] || '';
        next = [prefix, match[1] + '\\u00A0' + match[2] + suffix].filter(Boolean).join(' ');
      }
      return next;
    };

    const lockLeadingParentheticalPair = (value) =>
      String(value || '').replace(/^(\\(\\s*\\S+)\\s+(\\S+)/, '$1\\u00A0$2');

    const applyGrammarWidowLock = (node, lockLeadingPair) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.children.length > 0) return;
      const original = String(node.textContent || '');
      if (!original.trim()) return;
      let next = original.replace(/[ \\t\\r\\n\\f]+/g, ' ').trim();
      if (lockLeadingPair) {
        next = lockLeadingParentheticalPair(next);
      }
      next = lockTrailingWords(next, 2);
      if (next && next !== original) {
        node.textContent = next;
      }
    };

    const grammarQuestionEmphasis = document.querySelectorAll(
      '.column-list.grammar-matrix-grid .column > p > em:only-child',
    );
    grammarQuestionEmphasis.forEach((element) => applyGrammarWidowLock(element, true));

    const grammarInlineNotes = document.querySelectorAll(
      '.column-list.grammar-matrix-grid .column li > em',
    );
    grammarInlineNotes.forEach((element) => applyGrammarWidowLock(element, true));
  } catch {}

  const readStoredTheme = (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const persistTheme = (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {}
  };

  try {
    const themeToggle = document.querySelector('.theme-toggle');
    if (themeToggle instanceof HTMLElement) {
      const html = document.documentElement;
      const storageKey = 'theme-preference';
      const mediaQuery =
        typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-color-scheme: dark)')
          : null;

      const getPreference = () => {
        const stored = readStoredTheme(storageKey);
        if (stored === 'dark' || stored === 'light') {
          return stored;
        }
        return mediaQuery && mediaQuery.matches ? 'dark' : 'light';
      };

      const setTheme = (theme) => {
        html.setAttribute('data-theme', theme);
        persistTheme(storageKey, theme);
      };

      setTheme(getPreference());

      themeToggle.addEventListener('click', () => {
        const current = html.getAttribute('data-theme') || getPreference();
        setTheme(current === 'dark' ? 'light' : 'dark');
      });

      if (mediaQuery) {
        const handlePreferenceChange = (event) => {
          if (readStoredTheme(storageKey) === null) {
            setTheme(event.matches ? 'dark' : 'light');
          }
        };
        if (typeof mediaQuery.addEventListener === 'function') {
          mediaQuery.addEventListener('change', handlePreferenceChange);
        } else if (typeof mediaQuery.addListener === 'function') {
          mediaQuery.addListener(handlePreferenceChange);
        }
      }
    }
  } catch {}

  try {
    const TABLE_SAMPLE_ROW_LIMIT = 24;
    let tableBalanceTimer = 0;
    let tableBalanceFrame = 0;

    const isDesktopViewport = () => {
      if (typeof window.matchMedia === 'function') {
        return window.matchMedia('(min-width: 841px)').matches;
      }
      return window.innerWidth >= 841;
    };

    const getDirectColgroup = (table) =>
      Array.from(table.children).find((child) => child.tagName === 'COLGROUP') ?? null;

    const removeGeneratedColgroup = (table) => {
      const existingColgroup = getDirectColgroup(table);
      if (
        existingColgroup instanceof HTMLElement &&
        existingColgroup.getAttribute('data-generated-colgroup') === 'true'
      ) {
        existingColgroup.remove();
      }
      table.removeAttribute('data-balanced-columns');
    };

    const normalizeCellText = (cell) => (cell.textContent || '').replace(/\\s+/g, ' ').trim();
    const normalizeLabel = (value) =>
      String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\\s]/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim();

    const quantile = (values, q) => {
      if (!values.length) {
        return 0;
      }
      const sorted = [...values].sort((left, right) => left - right);
      const rawIndex = (sorted.length - 1) * q;
      const lower = Math.floor(rawIndex);
      const upper = Math.ceil(rawIndex);
      if (lower === upper) {
        return sorted[lower] ?? 0;
      }
      const lowerValue = sorted[lower] ?? 0;
      const upperValue = sorted[upper] ?? 0;
      return lowerValue + (upperValue - lowerValue) * (rawIndex - lower);
    };

    const isSparseLikeCell = (text) => {
      if (!text) {
        return true;
      }
      const compact = text.replace(/\\s+/g, '');
      if (!compact) {
        return true;
      }
      if (compact.length <= 2) {
        return true;
      }
      const hasAlphaNumeric = /[a-z0-9]/i.test(compact);
      if (!hasAlphaNumeric && compact.length <= 6) {
        return true;
      }
      const tokens = text.split(/\\s+/).filter(Boolean);
      return tokens.length <= 1 && compact.length <= 4;
    };

    const getHeaderRole = (headerText) => {
      const normalized = normalizeLabel(headerText);
      if (
        normalized.includes('structural formula') ||
        normalized.includes('formula') ||
        normalized.includes('pattern') ||
        normalized.includes('structure')
      ) {
        return 'formula';
      }
      if (normalized.includes('emoji') || normalized.includes('icon') || normalized.includes('status')) {
        return 'emoji';
      }
      if (
        normalized.includes('meaning') ||
        normalized.includes('gloss') ||
        normalized.includes('definition') ||
        normalized.includes('real english meaning') ||
        normalized.includes('context')
      ) {
        return 'meaning';
      }
      if (normalized.includes('example') || normalized.includes('sample') || normalized.includes('from text')) {
        return 'example';
      }
      if (
        normalized.includes('expression') ||
        normalized.includes('term') ||
        normalized.includes('phrase') ||
        normalized.includes('word') ||
        normalized.includes('chunk') ||
        normalized.includes('vocabulary')
      ) {
        return 'expression';
      }
      return 'unknown';
    };

    const roleBounds = (role) => {
      if (role === 'meaning') return { min: 30, max: 62, base: 42 };
      if (role === 'example') return { min: 18, max: 40, base: 28 };
      if (role === 'formula') return { min: 14, max: 26, base: 18 };
      if (role === 'emoji') return { min: 6, max: 12, base: 8 };
      if (role === 'expression') return { min: 18, max: 38, base: 24 };
      return { min: 12, max: 42, base: 22 };
    };

    const detectFallbackRole = (column) => {
      const sparseRatio = column.nonEmpty > 0 ? column.emojiLikeCount / column.nonEmpty : 0;
      if (sparseRatio >= 0.75 && column.p75 <= 8) {
        return 'emoji';
      }
      if (column.breakCount >= 2 || column.p75 >= 68) {
        return 'meaning';
      }
      if (column.symbolicRatio >= 0.35 && column.averageWords <= 5 && column.p75 <= 28) {
        return 'formula';
      }
      if (column.averageWords >= 6 || column.p75 >= 40) {
        return 'example';
      }
      if (column.p75 <= 24) {
        return 'expression';
      }
      return 'unknown';
    };

    const classifyArchetype = (columns) => {
      const roles = columns.map((column) => column.role);
      const meaningColumn = columns.find((column) => column.role === 'meaning');
      if (columns.length === 2 && roles.includes('expression') && roles.includes('meaning')) {
        return 'glossary_2col';
      }
      if (columns.length === 3 && roles.includes('expression') && roles.includes('meaning') && roles.includes('example')) {
        if ((meaningColumn?.breakCount ?? 0) > 0 || (meaningColumn?.p75 ?? 0) >= 70) {
          return 'long_meaning_3col';
        }
        return 'vocab_3col';
      }
      if (
        columns.length === 4 &&
        roles.includes('expression') &&
        roles.includes('meaning') &&
        roles.includes('formula') &&
        roles.includes('example')
      ) {
        return 'instructional_4col';
      }
      if (columns.length === 4 && roles.includes('emoji')) {
        return 'emoji_split_4col';
      }
      return 'mixed_fallback';
    };

    const computeBoundedPercentages = (weights, minBounds, maxBounds) => {
      const totalColumns = weights.length;
      if (totalColumns === 0) {
        return [];
      }

      const mins = [...minBounds];
      const maxes = [...maxBounds];
      const sum = (values) => values.reduce((acc, value) => acc + value, 0);
      const minTotal = sum(mins);
      if (minTotal > 100) {
        const shrink = 100 / minTotal;
        for (let index = 0; index < mins.length; index += 1) {
          mins[index] *= shrink;
        }
      }

      const maxTotal = sum(maxes);
      if (maxTotal < 100) {
        const growth = 100 / maxTotal;
        for (let index = 0; index < maxes.length; index += 1) {
          maxes[index] *= growth;
        }
      }

      const result = new Array(totalColumns).fill(0);
      const active = new Set(Array.from({ length: totalColumns }, (_, index) => index));
      let remainingPercent = 100;
      let remainingWeight = weights.reduce((acc, value) => acc + value, 0);
      let guard = 0;

      while (active.size > 0 && guard < totalColumns * 2) {
        guard += 1;
        let changed = false;
        for (const index of [...active]) {
          const share =
            remainingWeight > 0
              ? (remainingPercent * weights[index]) / remainingWeight
              : remainingPercent / active.size;
          if (share < mins[index]) {
            result[index] = mins[index];
            remainingPercent -= result[index];
            remainingWeight -= weights[index];
            active.delete(index);
            changed = true;
            continue;
          }
          if (share > maxes[index]) {
            result[index] = maxes[index];
            remainingPercent -= result[index];
            remainingWeight -= weights[index];
            active.delete(index);
            changed = true;
          }
        }
        if (!changed) {
          break;
        }
      }

      if (active.size > 0) {
        const activeIndices = [...active];
        const activeWeight = activeIndices.reduce((acc, index) => acc + weights[index], 0);
        for (const index of activeIndices) {
          result[index] =
            activeWeight > 0
              ? (remainingPercent * weights[index]) / activeWeight
              : remainingPercent / activeIndices.length;
        }
      }

      const rounded = result.map((value) => Number(value.toFixed(2)));
      const roundedTotal = rounded.reduce((acc, value) => acc + value, 0);
      const delta = Number((100 - roundedTotal).toFixed(2));
      if (delta !== 0 && rounded.length > 0) {
        let targetIndex = 0;
        for (let index = 1; index < rounded.length; index += 1) {
          if (rounded[index] > rounded[targetIndex]) {
            targetIndex = index;
          }
        }
        rounded[targetIndex] = Number((rounded[targetIndex] + delta).toFixed(2));
      }
      return rounded;
    };

    const analyzeTableColumns = (table) => {
      const rows = Array.from(table.querySelectorAll('tr')).slice(0, TABLE_SAMPLE_ROW_LIMIT);
      if (rows.length === 0) {
        return null;
      }

      const columnCount = rows.reduce((maxColumns, row) => {
        const cells = row.querySelectorAll('th, td');
        return Math.max(maxColumns, cells.length);
      }, 0);
      if (columnCount <= 1) {
        return null;
      }

      const columns = Array.from({ length: columnCount }, () => ({
        header: '',
        nonEmpty: 0,
        emojiLikeCount: 0,
        lengths: [],
        breakCount: 0,
        maxChars: 0,
        longestToken: 0,
        totalWords: 0,
        symbolicSamples: 0,
        role: 'unknown',
        p75: 0,
        averageWords: 0,
        symbolicRatio: 0,
      }));

      rows.forEach((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        cells.forEach((cell, cellIndex) => {
          const column = columns[cellIndex];
          if (!column) {
            return;
          }
          const text = normalizeCellText(cell);
          const chars = text.length;
          const words = text ? text.split(/\\s+/).filter(Boolean).length : 0;
          const breakCount = cell.querySelectorAll('br').length;
          const compact = text.replace(/\\s+/g, '');
          const symbolMatches = compact.match(/[=+\\/→:()\\[\\]-]/g) ?? [];
          if (rowIndex === 0 && (cell.tagName === 'TH' || !column.header)) {
            column.header = text;
          }
          if (chars > 0) {
            column.nonEmpty += 1;
            column.lengths.push(chars);
            column.totalWords += words;
          }
          column.breakCount += breakCount;
          column.maxChars = Math.max(column.maxChars, chars);
          column.longestToken = Math.max(
            column.longestToken,
            ...text.split(/\\s+/).filter(Boolean).map((token) => token.length),
            0,
          );
          if (isSparseLikeCell(text)) {
            column.emojiLikeCount += 1;
          }
          if (compact && symbolMatches.length / Math.max(compact.length, 1) >= 0.12) {
            column.symbolicSamples += 1;
          }
        });
      });

      columns.forEach((column) => {
        column.p75 = quantile(column.lengths, 0.75);
        column.averageWords = column.nonEmpty > 0 ? column.totalWords / column.nonEmpty : 0;
        column.symbolicRatio = column.nonEmpty > 0 ? column.symbolicSamples / column.nonEmpty : 0;
        column.role = getHeaderRole(column.header);
      });
      columns.forEach((column) => {
        if (column.role === 'unknown') {
          column.role = detectFallbackRole(column);
        }
      });

      return {
        columnCount,
        columns,
        archetype: classifyArchetype(columns),
      };
    };

    const getArchetypeTargets = (analysis) => {
      const { columns, archetype } = analysis;
      if (archetype === 'glossary_2col') {
        return columns.map((column) => {
          if (column.role === 'expression') return 28 + Math.min(4, Math.max(0, (column.p75 - 18) * 0.16));
          if (column.role === 'meaning') return 72 + Math.min(6, Math.max(0, (column.p75 - 56) * 0.08));
          return roleBounds(column.role).base;
        });
      }
      if (archetype === 'vocab_3col') {
        return columns.map((column) => {
          if (column.role === 'expression') return 26 + Math.min(4, Math.max(0, (column.p75 - 20) * 0.1));
          if (column.role === 'meaning') return 44 + Math.min(8, Math.max(0, (column.p75 - 42) * 0.14)) + column.breakCount * 1.4;
          if (column.role === 'example') return 30 + Math.min(5, Math.max(0, (column.p75 - 34) * 0.09));
          return roleBounds(column.role).base;
        });
      }
      if (archetype === 'long_meaning_3col') {
        return columns.map((column) => {
          if (column.role === 'expression') return 24 + Math.min(4, Math.max(0, (column.p75 - 18) * 0.08));
          if (column.role === 'meaning') return 49 + Math.min(10, Math.max(0, (column.p75 - 48) * 0.16)) + column.breakCount * 2.2;
          if (column.role === 'example') return 27 + Math.min(4, Math.max(0, (column.p75 - 30) * 0.08));
          return roleBounds(column.role).base;
        });
      }
      if (archetype === 'instructional_4col') {
        return columns.map((column) => {
          if (column.role === 'expression') return 20 + Math.min(4, Math.max(0, (column.p75 - 18) * 0.08));
          if (column.role === 'meaning') return 35 + Math.min(8, Math.max(0, (column.p75 - 42) * 0.12)) + column.breakCount * 1.4;
          if (column.role === 'formula') return 17 + Math.min(4, Math.max(0, (column.p75 - 18) * 0.12));
          if (column.role === 'example') return 28 + Math.min(7, Math.max(0, (column.p75 - 32) * 0.12));
          return roleBounds(column.role).base;
        });
      }
      if (archetype === 'emoji_split_4col') {
        return columns.map((column) => {
          if (column.role === 'expression') return 22 + Math.min(3, Math.max(0, (column.p75 - 18) * 0.08));
          if (column.role === 'meaning') return 40 + Math.min(9, Math.max(0, (column.p75 - 40) * 0.14));
          if (column.role === 'example') return 30 + Math.min(6, Math.max(0, (column.p75 - 30) * 0.1));
          if (column.role === 'emoji') return 8;
          return roleBounds(column.role).base;
        });
      }

      return columns.map((column) => {
        let contribution = Math.min(column.p75, 140) + Math.min(column.averageWords * 6, 24);
        if (column.breakCount > 0) {
          contribution += 10;
        }
        if (column.role === 'meaning') {
          contribution += 12;
        }
        if (column.role === 'formula') {
          contribution -= 6;
        }
        return Math.max(contribution, 1);
      });
    };

    const computeColumnWidths = (table) => {
      const analysis = analyzeTableColumns(table);
      if (!analysis) {
        return null;
      }

      const mins = analysis.columns.map((column) => roleBounds(column.role).min);
      const maxes = analysis.columns.map((column) => roleBounds(column.role).max);
      const targets = getArchetypeTargets(analysis);

      analysis.columns.forEach((column, index) => {
        const sparseRatio = column.nonEmpty > 0 ? column.emojiLikeCount / column.nonEmpty : 0;
        if (analysis.archetype === 'emoji_split_4col' && column.role === 'emoji') {
          maxes[index] = Math.min(maxes[index], 10);
        }
        if (analysis.archetype === 'instructional_4col' && column.role === 'formula') {
          maxes[index] = Math.min(maxes[index], 22);
        }
        if (analysis.archetype === 'glossary_2col' && column.role === 'meaning') {
          mins[index] = Math.max(mins[index], 58);
        }
        if (sparseRatio >= 0.75 && column.maxChars <= 8) {
          maxes[index] = Math.min(maxes[index], Math.max(mins[index] + 2, 12));
        }
      });

      return {
        archetype: analysis.archetype,
        columns: analysis.columns,
        widths: computeBoundedPercentages(targets, mins, maxes),
      };
    };

    const annotateTable = (table, columns, archetype) => {
      table.setAttribute('data-table-archetype', archetype);
      const rows = Array.from(table.querySelectorAll('tr'));
      rows.forEach((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        cells.forEach((cell, cellIndex) => {
          const column = columns[cellIndex];
          if (!column) {
            return;
          }
          cell.setAttribute('data-col-role', column.role);
          const text = normalizeCellText(cell);
          const words = text ? text.split(/\\s+/).filter(Boolean).length : 0;
          const proseLike =
            (column.role === 'meaning' || column.role === 'example') &&
            !isSparseLikeCell(text) &&
            (text.length >= 42 || words >= 6 || cell.querySelector('br') !== null);
          cell.setAttribute('data-cell-prose', proseLike ? 'true' : 'false');
          if (rowIndex === 0 && cell.tagName === 'TH') {
            cell.setAttribute('scope', 'col');
          }
        });
      });
    };

    const balanceTableColumns = () => {
      const tables = document.querySelectorAll('.markdown-body table');
      tables.forEach((table) => {
        if (!(table instanceof HTMLTableElement)) {
          return;
        }

        const existingColgroup = getDirectColgroup(table);
        const result = computeColumnWidths(table);
        if (!result) {
          removeGeneratedColgroup(table);
          table.removeAttribute('data-table-archetype');
          return;
        }
        annotateTable(table, result.columns, result.archetype);

        if (
          existingColgroup instanceof HTMLElement &&
          existingColgroup.getAttribute('data-generated-colgroup') !== 'true'
        ) {
          table.removeAttribute('data-balanced-columns');
          return;
        }

        if (!isDesktopViewport()) {
          removeGeneratedColgroup(table);
          return;
        }

        removeGeneratedColgroup(table);

        const generatedColgroup = document.createElement('colgroup');
        generatedColgroup.setAttribute('data-generated-colgroup', 'true');
        result.widths.forEach((width) => {
          const col = document.createElement('col');
          col.style.width = width + '%';
          generatedColgroup.appendChild(col);
        });

        table.insertBefore(generatedColgroup, table.firstChild);
        table.setAttribute('data-balanced-columns', 'true');
      });
    };

    const scheduleTableBalancing = () => {
      if (tableBalanceTimer) {
        window.clearTimeout(tableBalanceTimer);
      }
      if (tableBalanceFrame) {
        window.cancelAnimationFrame(tableBalanceFrame);
      }
      tableBalanceTimer = window.setTimeout(() => {
        tableBalanceFrame = window.requestAnimationFrame(() => {
          balanceTableColumns();
          tableBalanceFrame = 0;
        });
      }, 140);
    };

    balanceTableColumns();
    window.addEventListener('resize', scheduleTableBalancing, { passive: true });
  } catch {}

  try {
    const supportsSpeechSynthesis =
      'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
    if (!supportsSpeechSynthesis) {
      return;
    }
    const normalizeText = (value) =>
      String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\\s]/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim();

    const headingCandidates = Array.from(document.querySelectorAll('.markdown-body h3'));
    const pronunciationHeading = headingCandidates.find((heading) => {
      const normalized = normalizeText(heading.textContent || '');
      return (
        normalized.includes('pronunciation') &&
        normalized.includes('micro') &&
        normalized.includes('focus')
      );
    });

    if (pronunciationHeading instanceof HTMLElement) {
      const sectionElements = [];
      let cursor = pronunciationHeading.nextElementSibling;
      while (cursor) {
        if (cursor.matches('h2, h3')) {
          break;
        }
        sectionElements.push(cursor);
        cursor = cursor.nextElementSibling;
      }

      const sectionText = sectionElements
        .map((element) => element.textContent || '')
        .join('\\n');
      const modeMatch = /\\bmode\\s*:\\s*([a-z_]+)\\b/i.exec(sectionText);
      let pronunciationMode = '';
      if (modeMatch && modeMatch[1]) {
        pronunciationMode = String(modeMatch[1]).trim().toLowerCase();
      }
      const wordDrillModes = new Set([
        'shadow_sentence',
        'intonation',
        'rhythm_chunking',
        'sentence_stress',
        'connected_speech',
        'minimal_pair',
      ]);
      const wordDrillEnabled = wordDrillModes.has(pronunciationMode);
      const connectedSpeechEnabled = pronunciationMode === 'connected_speech';

      if (wordDrillEnabled || connectedSpeechEnabled) {
        const hasShadowSentenceLabel = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const rawText = String(element.textContent || '')
            .replace(/\\s+/g, ' ')
            .trim();
          return /(^|\\b)shadow sentence\\s*:/i.test(rawText);
        };

        const findFirstMatchingDescendant = (root, selector) => {
          if (!(root instanceof HTMLElement)) return null;
          const candidates = Array.from(root.querySelectorAll(selector));
          return candidates.find((candidate) => hasShadowSentenceLabel(candidate)) || null;
        };

        const findShadowSentenceElement = () => {
          const directBlockMatch = sectionElements.find((element) => {
            if (!(element instanceof HTMLElement)) return false;
            if (element.classList.contains('callout')) return false;
            if (!element.matches('li, p, blockquote')) return false;
            return hasShadowSentenceLabel(element);
          });
          if (directBlockMatch instanceof HTMLElement) {
            return directBlockMatch;
          }

          const descendantSelectors = ['li', 'p', '.content > *', 'blockquote > *', 'div > *'];
          for (const element of sectionElements) {
            if (!(element instanceof HTMLElement)) continue;
            for (const selector of descendantSelectors) {
              const match = findFirstMatchingDescendant(element, selector);
              if (match instanceof HTMLElement) {
                return match;
              }
            }
          }

          return null;
        };

        if (wordDrillEnabled) {
          const shadowSentenceElement = findShadowSentenceElement();
          if (shadowSentenceElement instanceof HTMLElement) {
            shadowSentenceElement.classList.add('pronunciation-shadow-sentence');
          }
        }

        const resolvePreferredVoice = () => {
          const voices = window.speechSynthesis.getVoices();
          if (!voices || voices.length === 0) {
            return null;
          }
          const enUs =
            voices.find((voice) => /^en[-_]us$/i.test(voice.lang || '')) ||
            voices.find((voice) => /^en[-_]us\\b/i.test(voice.lang || ''));
          if (enUs) return enUs;
          const enAny = voices.find((voice) => /^en[-_]/i.test(voice.lang || ''));
          return enAny || voices[0] || null;
        };

        const speakWord = (word) => {
          const text = String(word || '').trim();
          if (!text) return;
          const utterance = new window.SpeechSynthesisUtterance(text);
          const voice = resolvePreferredVoice();
          if (voice) {
            utterance.voice = voice;
            utterance.lang = voice.lang || utterance.lang;
          } else {
            utterance.lang = 'en-US';
          }
          utterance.rate = 0.95;
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utterance);
        };

        const trimTrailingDelimiterInContainer = (container) => {
          if (!(container instanceof HTMLElement)) return;
          let current = container.lastChild;
          while (current) {
            if (current.nodeType === Node.TEXT_NODE) {
              const textValue = current.textContent || '';
              const withoutTrailingDelimiter = textValue.replace(/\\s*[—-]+\\s*$/, '');
              if (withoutTrailingDelimiter !== textValue) {
                current.textContent = withoutTrailingDelimiter;
              }
              if (!(current.textContent || '').trim()) {
                const previous = current.previousSibling;
                container.removeChild(current);
                current = previous;
                continue;
              }
              break;
            }

            if (current instanceof HTMLElement) {
              trimTrailingDelimiterInContainer(current);
              if (!(current.textContent || '').trim()) {
                const previous = current.previousSibling;
                container.removeChild(current);
                current = previous;
                continue;
              }
              break;
            }

            break;
          }
        };

        const buildWordContentNodes = (item, word, transcription) => {
          if (!(item instanceof HTMLElement)) return null;
          const clonedNodes = Array.from(item.childNodes).map((node) => node.cloneNode(true));
          let foundBoundary = false;

          for (let index = clonedNodes.length - 1; index >= 0; index -= 1) {
            const node = clonedNodes[index];
            if (foundBoundary) continue;

            if (node.nodeType === Node.TEXT_NODE) {
              const textValue = node.textContent || '';
              const transcriptionIndex = textValue.indexOf(transcription);
              if (transcriptionIndex >= 0) {
                node.textContent = textValue.slice(0, transcriptionIndex).replace(/\\s+$/, '');
                foundBoundary = true;
                if (!(node.textContent || '').trim()) {
                  clonedNodes.splice(index, 1);
                }
                continue;
              }

              clonedNodes.splice(index, 1);
              continue;
            }

            if ((node.textContent || '').includes(transcription)) {
              return null;
            }

            clonedNodes.splice(index, 1);
          }

          const content = document.createElement('span');
          content.className = 'pronunciation-word-content';

          if (!foundBoundary || clonedNodes.length === 0) {
            const fallbackLabel = document.createElement('span');
            fallbackLabel.className = 'pronunciation-word-label';
            fallbackLabel.textContent = word;
            content.appendChild(fallbackLabel);
            return content;
          }

          clonedNodes.forEach((node) => {
            content.appendChild(node);
          });
          trimTrailingDelimiterInContainer(content);
          if (!(content.textContent || '').trim()) {
            const fallbackLabel = document.createElement('span');
            fallbackLabel.className = 'pronunciation-word-label';
            fallbackLabel.textContent = word;
            content.appendChild(fallbackLabel);
          }
          return content;
        };

        const parseWordDrillLine = (rawLine) => {
          const normalized = String(rawLine || '').trim();
          if (!normalized) return null;

          const transcriptionTailMatch = /(\\/[^/\\n]+\\/)(?:\\s+(.+))?$/.exec(normalized);
          if (!transcriptionTailMatch?.[1]) return null;

          const transcription = transcriptionTailMatch[1].trim();
          const note = (transcriptionTailMatch[2] || '').trim();
          const rawWord = normalized
            .slice(0, transcriptionTailMatch.index)
            .replace(/^\\d+\\.\\s*/, '')
            .replace(/[—-]\\s*$/, '')
            .split(String.fromCharCode(96))
            .join('')
            .trim();
          if (!rawWord) return null;

          return {
            word: rawWord,
            transcription,
            note,
          };
        };

        const listItems = [];
        const seen = new Set();
        sectionElements.forEach((element) => {
          element.querySelectorAll('li').forEach((item) => {
            if (!(item instanceof HTMLElement)) return;
            if (item.querySelector('li')) return;
            if (seen.has(item)) return;
            seen.add(item);
            listItems.push(item);
          });
        });

        listItems.forEach((item) => {
          if (!(item instanceof HTMLElement)) return;
          if (item.querySelector('.word-tts-button')) return;
          const raw = (item.textContent || '').replace(/\\s+/g, ' ').trim();

          if (wordDrillEnabled) {
            const parsed = parseWordDrillLine(raw);
            if (parsed) {
              const word = parsed.word;
              const transcription = parsed.transcription;
              const note = parsed.note;
              if (!word) return;

              const controls = document.createElement('span');
              controls.className = 'pronunciation-word-tts';

              const button = document.createElement('button');
              button.type = 'button';
              button.className = 'word-tts-button';
              button.textContent = 'Play';
              button.setAttribute(
                'aria-label',
                'Play pronunciation for ' + word + ' ' + transcription,
              );
              button.addEventListener('click', () => speakWord(word));

              const transcriptionBadge = document.createElement('span');
              transcriptionBadge.className = 'word-tts-transcription';
              transcriptionBadge.textContent = transcription;
              transcriptionBadge.setAttribute('aria-hidden', 'true');

              const noteText = document.createElement('span');
              noteText.className = 'pronunciation-word-note';
              noteText.textContent = note;

              const wordMain = document.createElement('span');
              wordMain.className = 'pronunciation-word-main';
              const wordContent = buildWordContentNodes(item, word, transcription);
              controls.appendChild(button);
              controls.appendChild(transcriptionBadge);
              if (note) {
                controls.appendChild(noteText);
              }

              if (wordContent instanceof HTMLElement) {
                wordMain.appendChild(wordContent);
              }
              wordMain.appendChild(controls);

              item.classList.add('pronunciation-word-item');
              while (item.firstChild) {
                item.removeChild(item.firstChild);
              }
              item.appendChild(wordMain);
              return;
            }
          }

          if (connectedSpeechEnabled) {
            const source = raw.replace(/^\\d+\\.\\s*/, '').trim();
            if (!source) return;
            const arrowParts = source.split(/\\s*(?:→|->)\\s*/);
            let speakTarget = (arrowParts[0] || source).trim();
            const quoteChars = ['"', "'", String.fromCharCode(96), '“', '”'];
            while (
              speakTarget.length > 0 &&
              quoteChars.includes(speakTarget.charAt(0))
            ) {
              speakTarget = speakTarget.slice(1);
            }
            while (
              speakTarget.length > 0 &&
              quoteChars.includes(speakTarget.charAt(speakTarget.length - 1))
            ) {
              speakTarget = speakTarget.slice(0, -1);
            }
            speakTarget = speakTarget.trim();
            if (!speakTarget) return;

            const controls = document.createElement('span');
            controls.className = 'pronunciation-word-tts';

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'word-tts-button';
            button.textContent = 'Play';
            button.setAttribute('aria-label', 'Play connected speech line');
            button.addEventListener('click', () => speakWord(speakTarget));

            controls.appendChild(button);
            item.appendChild(controls);
          }
        });
      }
    }
  } catch {}
})();
</script>`;
}

function resolveRenderOptions(options: RenderOptions): ResolvedRenderOptions {
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
  };
}

function stripHtml(value: string): string {
  return value.replaceAll(/<[^>]+>/g, '');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value);
}
