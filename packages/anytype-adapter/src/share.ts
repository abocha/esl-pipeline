import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { uploadToS3 } from '@esl-pipeline/storage-uploader';

import { createAnytypeClient } from './client.js';
import { renderToHtml } from './rendering.js';

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
  const html = await renderToHtml(resolvedBody, resolvedTitle, {
    css: options.css,
    allowRawHtml: options.allowRawHtml,
    showGeneratedDate: options.showGeneratedDate,
    features: options.features,
    theme: options.theme,
    headingTheme: options.headingTheme,
  });

  const filename = options.filename ?? `${pageId}.html`;
  const localPath = join(tmpdir(), filename);
  await writeFile(localPath, html, 'utf8');

  const upload = await uploadToS3(localPath, {
    keyPrefix: options.keyPrefix ?? 'materials/anytype-exports',
    publicRead: options.publicRead ?? true,
  });

  return {
    url: upload.url,
    key: upload.key,
    pageId,
  };
}
