import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as uploader from '@esl-pipeline/storage-uploader';

import { publishHtmlToS3, renderAndPublishMarkdownToS3 } from '../src/publish.js';

const uploadState = {
  seenKeys: new Set<string>(),
};

describe('publish', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    uploadState.seenKeys.clear();
    vi.spyOn(uploader, 'uploadFile').mockImplementation(
      async (_localPath: string, opts: { key?: string }) => {
        const key = opts.key ?? 'missing-key';
        const reused = uploadState.seenKeys.has(key);
        uploadState.seenKeys.add(key);
        return {
          url: `https://bucket.s3.amazonaws.com/${key}`,
          key,
          etag: '"etag"',
          reused,
          sha256: key,
        };
      },
    );
  });

  it('publishes deterministic html artifact keys by default', async () => {
    const html = '<html><body><h1>Hello</h1></body></html>';
    const first = await publishHtmlToS3(html);
    const second = await publishHtmlToS3(html);

    expect(first.key).toBe(second.key);
    expect(first.renderHash).toBe(second.renderHash);
    expect(first.key).toMatch(/^materials\/html\/artifacts\/[a-f0-9]{64}\.html$/);
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
  });

  it('supports stable explicit filename keys when requested', async () => {
    const html = '<html><body><p>Named</p></body></html>';
    const result = await publishHtmlToS3(html, {
      keyPrefix: 'materials/custom',
      filename: 'lesson',
    });
    expect(result.key).toBe('materials/custom/lesson.html');
  });

  it('propagates render hash metadata from render-and-publish flow', async () => {
    const result = await renderAndPublishMarkdownToS3({
      title: 'Lesson',
      markdown: '# Hello',
    });
    expect(result.html).toContain('<h1');
    expect(result.renderHash).toHaveLength(64);
    expect(result.key).toContain(result.renderHash);
  });

  it('forwards explicit key and renderHash in render-and-publish flow', async () => {
    const result = await renderAndPublishMarkdownToS3({
      title: 'Lesson',
      markdown: '# Hello',
      key: 'materials/html/manual/custom-key.html',
      renderHash: 'f'.repeat(64),
    });
    expect(result.key).toBe('materials/html/manual/custom-key.html');
    expect(result.renderHash).toBe('f'.repeat(64));
  });
});
