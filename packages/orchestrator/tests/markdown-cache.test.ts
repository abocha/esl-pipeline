import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const validateMarkdown = vi.fn().mockResolvedValue({
  ok: true,
  errors: [],
  warnings: [],
});

vi.mock('@esl-pipeline/md-validator', () => ({
  validateMarkdown,
}));

vi.mock('@esl-pipeline/tts-core', async () => {
  const actual =
    await vi.importActual<typeof import('@esl-pipeline/tts-core')>('@esl-pipeline/tts-core');
  return {
    ...actual,
    buildStudyTextMp3: vi.fn(),
  };
});

vi.mock('@esl-pipeline/storage-uploader', async () => {
  const actual = await vi.importActual<typeof import('@esl-pipeline/storage-uploader')>(
    '@esl-pipeline/storage-uploader',
  );
  return {
    ...actual,
    deriveS3UploadAddress: vi.fn().mockReturnValue({
      key: 'audio/file.mp3',
      url: 'https://s3.amazonaws.com/audio/file.mp3',
    }),
    uploadFile: vi.fn().mockResolvedValue({
      url: 'https://s3.amazonaws.com/audio/file.mp3',
      key: 'audio/file.mp3',
      reused: false,
      etag: '"etag"',
      sizeBytes: 11,
      sha256: 'abc123',
    }),
  };
});

describe('markdown caching', () => {
  it('passes cached markdown content to validator when provided', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'md-cache-'));
    const mdPath = join(dir, 'lesson.md');
    const mdContent = [
      '---',
      'title: Test',
      'student: Test Student',
      'level: A1',
      'topic: test',
      'input_type: generate',
      '---',
      '',
      '# Test',
      '',
    ].join('\n');
    await writeFile(mdPath, mdContent);

    const { newAssignment } = await import('../src/index.js');
    await newAssignment({
      md: mdPath,
      preset: 'default',
      skipImport: true,
      skipTts: true,
      skipUpload: true,
      upload: 's3',
      dryRun: true,
    });

    expect(validateMarkdown).toHaveBeenCalledTimes(1);
    const call = validateMarkdown.mock.calls[0];
    expect(call?.[0]?.path).toBe(mdPath);
    expect(call?.[0]?.strict).toBe(false);
    expect(call?.[0]?.context?.rawMarkdown).toBe(mdContent);
  }, 30000);
});
