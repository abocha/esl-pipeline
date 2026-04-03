import { createHash } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';

import { uploadFile } from '@esl-pipeline/storage-uploader';

import { type RenderOptions, renderToHtml } from './rendering.js';

export interface PublishHtmlOptions {
  keyPrefix?: string;
  publicRead?: boolean;
  filename?: string;
  key?: string;
  renderHash?: string;
}

export interface RenderAndPublishOptions extends RenderOptions, PublishHtmlOptions {
  markdown: string;
  title: string;
}

export interface HtmlPublishResult {
  url: string;
  key: string;
  etag?: string;
  reused?: boolean;
  renderHash: string;
  html: string;
}

const HTML_ARTIFACT_IDENTITY_VERSION = 1;

export async function publishHtmlToS3(
  html: string,
  options: PublishHtmlOptions = {},
): Promise<Omit<HtmlPublishResult, 'html'>> {
  const renderHash =
    options.renderHash ?? hashHtmlArtifact(`html-v${HTML_ARTIFACT_IDENTITY_VERSION}:${html}`);
  const localPath = join(tmpdir(), `esl-html-${renderHash}.html`);
  const key = resolveHtmlObjectKey(renderHash, options);

  await writeFile(localPath, html, 'utf8');
  try {
    const upload = await uploadFile(localPath, {
      backend: 's3',
      key,
      sha256: renderHash,
      skipIfExists: true,
      public: options.publicRead ?? true,
    });

    return {
      url: upload.url,
      key: upload.key,
      etag: upload.etag,
      reused: upload.reused,
      renderHash,
    };
  } finally {
    await unlink(localPath).catch(() => {});
  }
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
    pronunciationAudio: options.pronunciationAudio,
  });

  const upload = await publishHtmlToS3(html, {
    keyPrefix: options.keyPrefix,
    publicRead: options.publicRead,
    filename: options.filename,
    key: options.key,
    renderHash: options.renderHash,
  });

  return {
    ...upload,
    html,
  };
}

function resolveFilename(filename?: string): string {
  const trimmed = filename?.trim();
  if (!trimmed) {
    return '';
  }

  const base = basename(trimmed);
  const extension = extname(base).toLowerCase();
  if (extension === '.html' || extension === '.htm') {
    return base;
  }

  return `${base}.html`;
}

function resolveHtmlObjectKey(renderHash: string, options: PublishHtmlOptions): string {
  if (options.key?.trim()) {
    return options.key.trim();
  }

  const fileName = resolveFilename(options.filename);
  if (fileName) {
    const keyPrefix = options.keyPrefix?.trim();
    return keyPrefix ? `${keyPrefix}/${fileName}` : fileName;
  }

  return buildHtmlArtifactKey(renderHash, options.keyPrefix);
}

function hashHtmlArtifact(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function buildHtmlArtifactKey(hash: string, keyPrefix?: string): string {
  const normalizedPrefix = keyPrefix?.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '') ?? '';
  const baseKey = `materials/html/artifacts/${hash}.html`;
  return normalizedPrefix ? `${normalizedPrefix}/${baseKey}` : baseKey;
}
