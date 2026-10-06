import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as uploader from '@esl-pipeline/storage-uploader';

import { renderAssignmentToHtml } from '../src/index.js';
import { publishHtmlToS3, renderAndPublishAssignmentToS3 } from '../src/publish.js';

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

  it.each(['teacher', 'null', 'legacy'] as const)(
    'uploads learner-safe HTML bytes for %s rationale',
    async (shape) => {
      const fresh = JSON.parse(
        readFileSync(
          new URL('../../contracts/tests/assignment-rationale-fixture.json', import.meta.url),
          'utf8',
        ),
      );
      const legacy = JSON.parse(
        readFileSync(
          new URL('../../contracts/tests/assignment-fixture.json', import.meta.url),
          'utf8',
        ),
      );
      const assignment =
        shape === 'legacy'
          ? { ...legacy, rationale: 'ESL24_AMBIGUOUS_LEGACY_ONLY' }
          : { ...fresh, teacherRationale: shape === 'null' ? null : fresh.teacherRationale };
      assignment.teacherFollowUp = {
        warmUp: 'ESL32_WARMUP_PRIVATE',
        correctionFocus: 'ESL32_CORRECTION_PRIVATE',
      };
      let uploadedHtml = '';
      vi.mocked(uploader.uploadFile).mockImplementationOnce(async (localPath, options) => {
        uploadedHtml = readFileSync(localPath, 'utf8');
        return { url: 'https://bucket.test/result', key: options.key!, sha256: options.sha256! };
      });
      const result = await renderAndPublishAssignmentToS3({ assignment });
      expect(uploadedHtml).toBe(result.html);
      expect(uploadedHtml).not.toContain('ESL32_WARMUP_PRIVATE');
      expect(uploadedHtml).not.toContain('ESL32_CORRECTION_PRIVATE');
      expect(uploadedHtml).not.toContain('ESL24_TEACHER_ONLY');
      expect(uploadedHtml).not.toContain('ESL24_AMBIGUOUS_LEGACY_ONLY');
      expect(uploadedHtml.includes('assignment-section-6')).toBe(shape !== 'legacy');
      expect(uploadedHtml.includes(fresh.learnerRationale)).toBe(shape !== 'legacy');
    },
  );

  it('supports stable explicit filename keys when requested', async () => {
    const html = '<html><body><p>Named</p></body></html>';
    const result = await publishHtmlToS3(html, {
      keyPrefix: 'materials/custom',
      filename: 'lesson',
    });
    expect(result.key).toBe('materials/custom/lesson.html');
  });

  it('uploads exact React HTML UTF-8 bytes with the existing html-v1 hash and default object key', async () => {
    const assignment = JSON.parse(
      readFileSync(
        new URL('../../contracts/tests/assignment-fixture.json', import.meta.url),
        'utf8',
      ),
    );
    let bytes!: Buffer;
    vi.mocked(uploader.uploadFile).mockImplementationOnce(async (localPath, options) => {
      bytes = readFileSync(localPath);
      return { url: 'https://bucket.test/result', key: options.key!, sha256: options.sha256! };
    });
    const result = await renderAndPublishAssignmentToS3({ assignment });
    expect(result.html).toBe(await renderAssignmentToHtml(assignment));
    expect(bytes).toEqual(Buffer.from(result.html, 'utf8'));
    const hash = createHash('sha256').update('html-v1:').update(bytes).digest('hex');
    expect(result.renderHash).toBe(hash);
    expect(result.key).toBe(`materials/html/artifacts/${hash}.html`);
    expect(uploader.uploadFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ sha256: hash, key: result.key }),
    );
  });

  it('forwards explicit key and renderHash in render-and-publish flow', async () => {
    const result = await renderAndPublishAssignmentToS3({
      assignment: JSON.parse(
        readFileSync(
          new URL('../../contracts/tests/assignment-fixture.json', import.meta.url),
          'utf8',
        ),
      ),
      key: 'materials/html/manual/custom-key.html',
      renderHash: 'f'.repeat(64),
    });
    expect(result.key).toBe('materials/html/manual/custom-key.html');
    expect(result.renderHash).toBe('f'.repeat(64));
  });
});
