import type { ResolvedRenderOptions, ThemeTokens } from './options.js';

export const DEFAULT_THEME: Required<ThemeTokens> = {
  h1: '#e7eef5',
  h2: '#dce7f2',
  h3: '#eef2f6',
  pageBg: '#fafbfc',
  pageCard: '#ffffff',
  pageText: '#1d2935',
  pageMuted: '#596777',
  pageLine: '#d6dde4',
  calloutBg: '#f0f3f6',
  calloutBorder: '#9fb6cd',
  tocBg: '#f0f3f6',
  tocBorder: '#d6dde4',
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
  --tag-bg: #eef2f6;
  --audio-accent: #214f80;
  --inline-code-bg: #e1e9f1;
  --inline-code-border: #b5c5d4;
  --inline-code-text: #1d2935;
  --toc-link: #214f80;
  --link: #214f80;
  --link-hover: #183f69;
  --focus-color: #214f80;
  --table-head-bg: color-mix(in srgb, var(--theme-h2) 14%, var(--page-card) 86%);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --theme-h1: #293b4c;
    --theme-h2: #263748;
    --theme-h3: #2c3945;
    --page-bg: #17212b;
    --page-card: #202c37;
    --page-text: #edf2f7;
    --page-muted: #afbcc9;
    --page-line: #3b4a58;
    --callout-bg: #263441;
    --callout-border: #57728c;
    --toc-bg: #24313d;
    --toc-border: #3b4a58;
    --tag-bg: #2a3946;
    --audio-accent: #78a9d4;
    --inline-code-bg: #1b2731;
    --inline-code-border: #3b4a58;
    --inline-code-text: #e4ebf2;
    --toc-link: #9fc3e8;
    --link: #9fc3e8;
    --link-hover: #c6ddf2;
    --focus-color: #78a9d4;
    --table-head-bg: color-mix(in srgb, var(--theme-h2) 28%, var(--page-card) 72%);
  }
}
[data-theme="dark"] {
  --theme-h1: #293b4c;
  --theme-h2: #263748;
  --theme-h3: #2c3945;
  --page-bg: #17212b;
  --page-card: #202c37;
  --page-text: #edf2f7;
  --page-muted: #afbcc9;
  --page-line: #3b4a58;
  --callout-bg: #263441;
  --callout-border: #57728c;
  --toc-bg: #24313d;
  --toc-border: #3b4a58;
  --tag-bg: #2a3946;
  --audio-accent: #78a9d4;
  --inline-code-bg: #1b2731;
  --inline-code-border: #3b4a58;
  --inline-code-text: #e4ebf2;
  --toc-link: #9fc3e8;
  --link: #9fc3e8;
  --link-hover: #c6ddf2;
  --focus-color: #78a9d4;
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
  background: var(--page-bg);
  transition: background-color 0.3s ease, color 0.3s ease;
}
.page {
  position: relative;
  max-width: 980px;
  margin: 32px auto 60px;
  background: var(--page-card);
  border-radius: 12px;
  padding: 28px 52px 48px 72px;
  border: 1px solid color-mix(in srgb, var(--page-line) 70%, var(--page-card) 30%);
  box-shadow: 0 1px 3px rgb(29 41 53 / 8%);
  transition: background-color 0.3s ease, border-color 0.3s ease;
}
.page::before {
  content: '';
  position: absolute;
  top: var(--editorial-rail-start, 246px);
  bottom: 52px;
  left: 36px;
  width: 1px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--theme-h2) 36%, transparent 64%) 0%,
    color-mix(in srgb, var(--theme-h2) 18%, var(--page-line) 82%) 20%,
    color-mix(in srgb, var(--theme-h2) 18%, var(--page-line) 82%) 82%,
    transparent 100%
  );
  pointer-events: none;
}
.page-header {
  position: relative;
  margin-bottom: 30px;
}
.hero {
  position: relative;
  display: grid;
  grid-template-columns: 104px minmax(0, 1fr);
  align-items: center;
  justify-content: start;
  gap: 24px;
  min-height: 0;
  padding: 24px 30px 22px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--page-line) 72%, var(--page-card) 28%);
  background: color-mix(in srgb, var(--theme-h2) 64%, var(--page-card) 36%);
  overflow: hidden;
}
.hero-emoji {
  position: relative;
  z-index: 1;
  font-size: clamp(62px, 7vw, 88px);
  line-height: 1;
  filter: none;
  flex-shrink: 0;
  justify-self: center;
}
.hero-content {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 12px;
  min-width: 0;
  max-width: 760px;
  align-content: center;
}
.hero-title {
  margin: 0;
  font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
  font-size: clamp(31px, 3.8vw, 44px);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.04;
  text-wrap: balance;
  max-inline-size: 24ch;
}
.page-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  max-width: 38rem;
}
.tag {
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  border-radius: 999px;
  background: var(--tag-bg);
  color: color-mix(in srgb, var(--page-text) 84%, var(--page-muted) 16%);
  border: 1px solid color-mix(in srgb, var(--page-line) 72%, var(--page-card) 28%);
  box-shadow: none;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  transition: background-color 0.3s ease, color 0.3s ease;
}
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4 {
  margin: 0;
  padding: 0;
  letter-spacing: -0.01em;
  line-height: 1.18;
}
.markdown-body h1 {
  font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
  font-size: 35px;
  letter-spacing: -0.02em;
  margin-bottom: 12px;
}
.markdown-body h2 {
  font-size: 24px;
  margin: 40px 0 16px;
}
.markdown-body h3 {
  font-size: 18.5px;
  margin: 26px 0 10px;
}
.markdown-body h4 {
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.35;
  margin: 20px 0 10px;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--page-text) 76%, var(--page-muted) 24%);
}
.markdown-body > h2 {
  position: relative;
  margin-left: -20px;
  padding-left: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--theme-h2) 32%, var(--page-line) 68%);
}
.markdown-body > h2::before {
  content: '';
  position: absolute;
  left: -21px;
  top: 50%;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--theme-h2) 46%, var(--page-card) 54%);
  box-shadow:
    0 0 0 4px var(--page-card),
    0 0 0 5px color-mix(in srgb, var(--theme-h2) 24%, var(--page-line) 76%);
  transform: translateY(-50%);
}
.markdown-body .heading-text {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 8px;
  color: var(--page-text);
  background: var(--theme-h1);
}
.markdown-body h2 .heading-text {
  padding: 0;
  border-radius: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}
.markdown-body h3 .heading-text {
  padding: 0;
  border-radius: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}
.markdown-body h4 .heading-text {
  padding: 0 0 4px;
  border-radius: 0;
  border: none;
  border-bottom: 1px solid color-mix(in srgb, var(--theme-h3) 18%, var(--page-line) 82%);
  background: none;
  box-shadow: none;
}
.markdown-body p {
  margin: 8px 0 12px;
}
.markdown-body a {
  color: var(--link);
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
.markdown-body a:hover {
  color: var(--link-hover);
}
.markdown-body a:focus-visible,
.markdown-body summary:focus-visible,
.copy-code-button:focus-visible {
  outline: 3px solid var(--focus-color);
  outline-offset: 2px;
  border-radius: 6px;
}
.markdown-body ul,
.markdown-body ol {
  margin: 10px 0 18px;
  padding-left: 22px;
}
.markdown-body li {
  margin: 8px 0;
  padding-left: 2px;
}
.markdown-body li::marker {
  color: var(--page-muted);
  font-weight: 700;
}
.markdown-body > h2 + *,
.markdown-body > h3 + * {
  margin-top: 0;
}
.markdown-body > h2 + .callout,
.markdown-body > h2 + .study-text,
.markdown-body > h2 + .toc-shell,
.markdown-body > h2 + details,
.markdown-body > h3 + .callout,
.markdown-body > h3 + .study-text,
.markdown-body > h3 + .toc-shell,
.markdown-body > h3 + details {
  margin-top: 6px;
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
  margin: 30px 0;
}
.callout,
.study-text,
.toc-shell,
.audio-figure,
details:not(.study-text) {
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--page-line) 72%, var(--page-card) 28%);
  background: color-mix(in srgb, var(--page-card) 96%, var(--page-bg) 4%);
  box-shadow: none;
}
.audio-figure {
  margin: 16px 0 20px;
  padding: 14px 16px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.audio-figure:hover,
.audio-figure:focus-within {
  border-color: var(--callout-border);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--callout-border) 45%, transparent 55%);
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
.word-tts-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
  transform: none;
}
.word-tts-button:disabled:hover {
  border-color: var(--page-line);
  transform: none;
}
.word-tts-button:focus-visible {
  outline: 3px solid var(--focus-color);
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
.pronunciation-word-pair {
  display: inline-flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  width: auto;
  max-width: 100%;
}
.pronunciation-word-pair-separator {
  color: var(--page-muted);
  font-weight: 600;
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
.pronunciation-connected-line {
  display: grid;
  gap: 6px;
  width: min(100%, 42rem);
}
.pronunciation-connected-text {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
  color: var(--page-text);
}
.pronunciation-connected-careful {
  font-weight: 600;
}
.pronunciation-connected-arrow {
  color: var(--page-muted);
  font-weight: 700;
}
.pronunciation-connected-target {
  font-weight: 650;
  color: color-mix(in srgb, var(--page-text) 88%, var(--theme-h2) 12%);
  font-family: 'Charis SIL', 'Noto Serif', 'Times New Roman', serif;
}
.pronunciation-line-main {
  display: grid;
  gap: 6px;
  width: min(100%, 42rem);
}
.pronunciation-line-text {
  display: inline;
  color: var(--page-text);
  font-weight: 600;
}
.pronunciation-line-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.pronunciation-contour-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--theme-h2) 22%, var(--page-card) 78%);
  color: color-mix(in srgb, var(--page-text) 84%, var(--theme-h2) 16%);
  border: 1px solid color-mix(in srgb, var(--theme-h2) 34%, var(--page-line) 66%);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.pronunciation-shadow-sentence,
.pronunciation-natural-sentence {
  display: block;
  margin: 14px 0 16px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--audio-accent) 32%, var(--page-line) 68%);
  background: color-mix(in srgb, var(--theme-h2) 14%, var(--page-card) 86%);
  color: var(--page-text);
  font-size: 1.05em;
  line-height: 1.55;
}
.markdown-body ol + .pronunciation-shadow-sentence,
.markdown-body ol + .pronunciation-natural-sentence,
.markdown-body ul + .pronunciation-shadow-sentence,
.markdown-body ul + .pronunciation-natural-sentence {
  margin-top: 8px;
}
.pronunciation-shadow-sentence + .audio-figure,
.pronunciation-natural-sentence + .audio-figure {
  margin-top: 8px;
}
.pronunciation-shadow-sentence strong,
.pronunciation-natural-sentence strong {
  color: color-mix(in srgb, var(--page-text) 88%, var(--theme-h2) 12%);
  letter-spacing: 0.01em;
}
.callout {
  position: relative;
  padding: 18px 20px;
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 14px;
  margin: 18px 0;
  align-items: start;
  background: color-mix(in srgb, var(--callout-bg) 58%, var(--page-card) 42%);
}
.callout .icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  font-size: 18px;
  line-height: 1;
  margin-top: 1px;
  background: color-mix(in srgb, var(--theme-h1) 14%, var(--page-card) 86%);
  border: 1px solid color-mix(in srgb, var(--callout-border) 42%, var(--page-line) 58%);
  box-shadow: none;
}
.callout .content {
  display: grid;
  gap: 4px;
}
.callout .content > :first-child {
  margin-top: 0;
}
.callout .content > :last-child {
  margin-bottom: 0;
}
.source-caption {
  color: var(--page-muted);
  font-size: 0.9em;
}
.markdown-body .grammar-traps {
  list-style: none;
  padding-left: 0;
}
.markdown-body .grammar-trap {
  border-left: 3px solid var(--callout-border);
  padding: 8px 14px;
  margin: 12px 0;
  background: var(--callout-bg);
  overflow-wrap: anywhere;
}
.grammar-trap p,
.answer-key-item p {
  margin: 4px 0;
}
.answer-key-item {
  margin: 12px 0;
}
.study-text {
  padding: 0;
  margin: 18px 0;
  transition: background-color 0.3s ease, border-color 0.3s ease;
}
.study-text summary,
.toc-shell summary,
details:not(.study-text) summary {
  display: flex;
  align-items: center;
  min-height: 44px;
  font-size: 14px;
  letter-spacing: 0;
  text-transform: none;
  color: var(--page-muted);
  font-weight: 650;
  cursor: pointer;
}
.study-text summary {
  padding: 13px 16px 12px;
  background: color-mix(in srgb, var(--toc-bg) 20%, var(--page-card) 80%);
}
.study-text[open] summary,
.toc-shell[open] summary {
  border-bottom: 1px solid color-mix(in srgb, var(--page-line) 64%, var(--page-card) 36%);
}
.study-text .content {
  margin-top: 0;
  padding: 14px 16px 16px;
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
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 18px;
  margin: 14px 0 24px;
  padding: 0;
  border-radius: 0;
  border: 0;
  background: transparent;
}
.column-list.grammar-matrix-grid .column {
  min-width: 0;
  padding: 16px 18px 18px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--page-line) 74%, var(--callout-border) 26%);
  background: color-mix(in srgb, var(--page-card) 90%, #ffffff 10%);
  box-shadow: none;
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
.column-list.grammar-matrix-grid .column > .grammar-card-subheading {
  margin: 16px 0 10px;
  text-wrap: pretty;
  text-align: left;
  text-justify: auto;
  hyphens: none;
  line-height: 1.4;
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
  text-align: left;
  text-justify: auto;
  hyphens: auto;
}
.column-list.grammar-matrix-grid .column > p[data-grammar-emphasis-only="true"] > em:only-child {
  display: block;
  text-align: left;
  text-justify: auto;
}
.table-scroll {
  max-width: 100%;
  overflow-x: auto;
  margin: 14px 0 24px;
  -webkit-overflow-scrolling: touch;
}
.table-scroll > table {
  margin: 0;
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
  background: transparent;
  padding: 8px 16px 12px;
  border-radius: 0;
  border: 0;
  margin: 0;
  color: var(--page-muted);
}
.toc-shell {
  margin: 18px 0;
  overflow: hidden;
  background: color-mix(in srgb, var(--toc-bg) 52%, var(--page-card) 48%);
}
.toc-shell summary {
  font-size: 14px;
  padding: 13px 16px 12px;
  background: color-mix(in srgb, var(--toc-bg) 42%, var(--page-card) 58%);
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
.table-of-contents ul ul {
  padding-left: 20px;
}
.table-of-contents li {
  margin: 0;
}
.table-of-contents a {
  display: flex;
  align-items: center;
  min-height: 32px;
  padding: 4px 0;
  color: var(--toc-link);
  font-size: 14px;
  line-height: 1.35;
  text-decoration: none;
  transition: color 0.2s ease;
}
.table-of-contents ul ul a {
  font-size: 13px;
}
.table-of-contents a:hover {
  color: var(--page-text);
  text-decoration: underline;
}
details:not(.study-text) {
  margin: 16px 0;
  padding: 0;
  transition: background-color 0.3s ease, border-color 0.3s ease;
}
details:not(.study-text) summary {
  cursor: pointer;
  font-weight: 650;
  padding: 13px 16px 12px;
}
details:not(.study-text) > :not(summary) {
  padding: 0 16px 16px;
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
.markdown-body h3 code,
.markdown-body h4 code {
  background: var(--inline-code-bg);
  color: var(--inline-code-text);
  border-radius: 7px;
  padding: 0.14em 0.46em;
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  font-size: 0.92em;
  line-height: 1.2;
  box-shadow: inset 0 0 0 1px var(--inline-code-border);
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  transition: background-color 0.3s ease, color 0.3s ease;
}
.copy-code-button {
  position: absolute;
  top: 8px;
  right: 8px;
  border: 1px solid var(--page-line);
  background: var(--page-card);
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
  margin: 14px 0 24px;
  font-size: 13.5px;
  table-layout: auto;
}
.markdown-body table[data-balanced-columns="true"] {
  table-layout: fixed;
}
.markdown-body table[data-tight-columns="true"] {
  width: fit-content;
  max-width: 100%;
}
th,
td {
  border: 1px solid color-mix(in srgb, var(--page-line) 80%, var(--page-card) 20%);
  padding: 9px 11px;
  text-align: left;
  vertical-align: top;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: normal;
  line-height: 1.55;
  min-width: 0;
}
.markdown-body td[data-col-role="meaning"],
.markdown-body td[data-col-role="example"] {
  text-wrap: pretty;
}
.markdown-body table[data-table-archetype="glossary_2col"] td[data-col-role="meaning"][data-cell-prose="true"],
.markdown-body table[data-table-archetype="long_meaning_3col"] td[data-col-role="meaning"][data-cell-prose="true"] {
  text-align: left;
  text-justify: auto;
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
  background: color-mix(in srgb, var(--table-head-bg) 84%, var(--page-card) 16%);
  font-weight: 700;
}
tbody tr:nth-child(even) td {
  background: color-mix(in srgb, var(--page-card) 90%, var(--theme-h1) 10%);
}
@media (max-width: 959px) {
  .page {
    padding: 28px 28px 44px;
  }
  .page::before {
    display: none;
  }
  .markdown-body > h2 {
    margin-left: 0;
    padding-left: 0;
  }
  .markdown-body > h2::before {
    display: none;
  }
}
@media (max-width: 840px) {
  .table-of-contents a {
    min-height: 44px;
    padding: 8px 0;
  }
  .table-of-contents ul ul {
    padding-left: 14px;
  }
  .page {
    margin: 10px;
    padding: 20px 18px 30px;
    border-radius: 10px;
  }
  .hero {
    grid-template-columns: 1fr;
    min-height: auto;
    padding: 18px 16px;
    gap: 12px;
  }
  .hero-emoji {
    justify-self: start;
    font-size: clamp(54px, 18vw, 76px);
  }
  .hero-title {
    max-inline-size: none;
    font-size: clamp(29px, 8vw, 38px);
  }
  .hero-content {
    max-width: none;
  }
  .tag {
    border-radius: 8px;
    line-height: 1.35;
  }
  .callout {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .callout::before {
    display: none;
  }
  .markdown-body h4 {
    font-size: 12px;
    margin-top: 18px;
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
    padding: 0;
    gap: 12px;
  }
  .column-list.grammar-matrix-grid .column p[data-grammar-prose="true"] {
    text-align: left;
    text-justify: auto;
  }
  .column-list.grammar-matrix-grid .column > p[data-grammar-emphasis-only="true"] > em:only-child {
    text-align: left;
    text-justify: auto;
    text-align-last: auto;
  }
  .table-scroll {
    margin-left: -2px;
    margin-right: -2px;
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
  width: 44px;
  height: 44px;
  border: 1px solid var(--page-line);
  border-radius: 50%;
  background: var(--page-card);
  color: var(--page-muted);
  font-size: 18px;
  cursor: pointer;
  transition: border-color 0.2s ease, color 0.2s ease, transform 0.2s ease;
  box-shadow: 0 1px 3px rgb(29 41 53 / 12%);
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
  transition: grid-template-rows 0.3s ease-out, opacity 0.3s ease-out;
  opacity: 0;
  overflow: hidden;
}
details.is-open > .content {
  grid-template-rows: 1fr;
  opacity: 1;
}
.content-inner {
  min-height: 0;
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
  box-shadow: 0 1px 3px rgb(29 41 53 / 14%);
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
@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
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

export function buildCss(options: ResolvedRenderOptions): string {
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
