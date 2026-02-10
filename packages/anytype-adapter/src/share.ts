import { renderAndPublishMarkdownToS3 } from '@esl-pipeline/html-publisher';

import { createAnytypeClient } from './client.js';

export interface SharePageOptions {
  keyPrefix?: string;
  publicRead?: boolean;
  filename?: string;
  css?: string;
  title?: string;
  markdown?: string;
  allowRawHtml?: boolean;
  showGeneratedDate?: boolean;
  features?: {
    stickyToc?: boolean;
    copyCode?: boolean;
  };
  theme?: {
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
  };
  headingTheme?: {
    h1?: string;
    h2?: string;
    h3?: string;
  };
}

export async function sharePageToS3(
  spaceId: string,
  pageId: string,
  options: SharePageOptions = {},
) {
  const client = createAnytypeClient();
  let title = options.title;
  let body = options.markdown;

  if (!title || !body) {
    const page = await client.getObject(spaceId, pageId);
    if (!title) title = page.name ?? 'Anytype Page';
    if (!body) body = page.body ?? '';
  }

  const resolvedTitle = title ?? 'Anytype Page';
  const resolvedBody = body ?? '';
  const upload = await renderAndPublishMarkdownToS3({
    title: resolvedTitle,
    markdown: resolvedBody,
    filename: options.filename ?? `${pageId}.html`,
    keyPrefix: options.keyPrefix ?? 'materials/anytype-exports',
    publicRead: options.publicRead ?? true,
    css: options.css,
    allowRawHtml: options.allowRawHtml,
    showGeneratedDate: options.showGeneratedDate,
    features: options.features,
    theme: options.theme,
    headingTheme: options.headingTheme,
  });

  return {
    url: upload.url,
    key: upload.key,
    pageId,
  };
}
