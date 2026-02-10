import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';

import { uploadToS3 } from '@esl-pipeline/storage-uploader';

import { type RenderOptions, renderToHtml } from './rendering.js';

export interface PublishHtmlOptions {
  keyPrefix?: string;
  publicRead?: boolean;
  filename?: string;
}

export interface RenderAndPublishOptions extends RenderOptions, PublishHtmlOptions {
  markdown: string;
  title: string;
}

export interface HtmlPublishResult {
  url: string;
  key: string;
  html: string;
}

export async function publishHtmlToS3(
  html: string,
  options: PublishHtmlOptions = {},
): Promise<Omit<HtmlPublishResult, 'html'>> {
  const fileName = resolveFilename(options.filename);
  const localPath = join(tmpdir(), fileName);
  await writeFile(localPath, html, 'utf8');

  const upload = await uploadToS3(localPath, {
    keyPrefix: options.keyPrefix ?? 'materials/html-exports',
    publicRead: options.publicRead ?? true,
  });

  return {
    url: upload.url,
    key: upload.key,
  };
}

export async function renderAndPublishMarkdownToS3(
  options: RenderAndPublishOptions,
): Promise<HtmlPublishResult> {
  const html = await renderToHtml(options.markdown, options.title, {
    css: options.css,
    allowRawHtml: options.allowRawHtml,
    showGeneratedDate: options.showGeneratedDate,
    features: options.features,
    theme: options.theme,
    headingTheme: options.headingTheme,
  });

  const upload = await publishHtmlToS3(html, {
    keyPrefix: options.keyPrefix,
    publicRead: options.publicRead,
    filename: options.filename,
  });

  return {
    ...upload,
    html,
  };
}

function resolveFilename(filename?: string): string {
  const trimmed = filename?.trim();
  if (!trimmed) {
    return `assignment-${randomUUID()}.html`;
  }

  const base = basename(trimmed);
  const extension = extname(base).toLowerCase();
  if (extension === '.html' || extension === '.htm') {
    return base;
  }

  return `${base}.html`;
}
