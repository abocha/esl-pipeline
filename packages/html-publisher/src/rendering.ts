import { buildBehaviorScript } from './rendering/behavior.js';
import { buildCss } from './rendering/css.js';
import { extractFrontmatter, resolveTitle } from './rendering/frontmatter.js';
import { createRenderer } from './rendering/markdown.js';
import type { RenderOptions } from './rendering/options.js';
import { resolveRenderOptions } from './rendering/options.js';
import { renderPageShell } from './rendering/page-shell.js';
import {
  decorateAudioPlayers,
  decorateNoticeGrammarColumns,
  promoteUsefulChunksTableHeader,
  replaceAudioLinks,
  replaceColumnMarkers,
  wrapTableOfContents,
  wrapTables,
} from './rendering/postprocess.js';
import { preprocessMarkdown } from './rendering/preprocess.js';
import { sanitizeRenderedHtml } from './rendering/safety.js';

export type {
  FeatureFlags,
  RenderOptions,
  ResolvedFeatures,
  ResolvedRenderOptions,
  ThemeTokens,
} from './rendering/options.js';

export async function renderToHtml(
  markdown: string,
  title: string,
  options: RenderOptions = {},
): Promise<string> {
  const resolved = resolveRenderOptions(options);
  const renderer = createRenderer();
  const frontmatter = extractFrontmatter(markdown);
  const resolvedTitle = resolveTitle(markdown, title, frontmatter);
  const preparedMarkdown = preprocessMarkdown(markdown, resolved.allowRawHtml);
  const renderedHtml = renderer.render(preparedMarkdown);
  const withColumns = replaceColumnMarkers(renderedHtml);
  const withEmbeddedAudio = replaceAudioLinks(decorateAudioPlayers(withColumns));
  const withCollapsibleToc = wrapTableOfContents(withEmbeddedAudio);
  const withVocabularyHeaders = promoteUsefulChunksTableHeader(withCollapsibleToc);
  const withGrammarMatrix = decorateNoticeGrammarColumns(withVocabularyHeaders);
  const withScrollableTables = wrapTables(withGrammarMatrix);
  const safeBody = sanitizeRenderedHtml(withScrollableTables, resolved.allowRawHtml);

  return renderPageShell({
    resolvedTitle,
    frontmatter,
    resolved,
    bodyHtml: safeBody,
    css: buildCss(resolved),
    behaviorScript: buildBehaviorScript(resolved.features),
  });
}

export async function createStaticPageHtml(
  markdown: string,
  title: string,
  options: RenderOptions = {},
): Promise<string> {
  return renderToHtml(markdown, title, options);
}
