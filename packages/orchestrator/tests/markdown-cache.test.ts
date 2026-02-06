import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const validateMarkdownFile = vi.fn().mockResolvedValue({
  ok: true,
  errors: [],
  warnings: [],
});

vi.mock('@esl-pipeline/md-validator', () => ({
  validateMarkdownFile,
}));

vi.mock('@esl-pipeline/notion-adapter', () => ({
  runImport: vi.fn().mockResolvedValue({ page_id: 'page-123', url: 'https://notion.so/page-123' }),
  applyHeadingPreset: vi
    .fn()
    .mockResolvedValue({ applied: true, counts: { h2: 0, h3: 0, toggles: 0 } }),
  addOrReplaceAudioUnderStudyText: vi.fn().mockResolvedValue({ replaced: false, appended: true }),
}));

vi.mock('@esl-pipeline/tts-elevenlabs', async () => {
  const actual = await vi.importActual<typeof import('@esl-pipeline/tts-elevenlabs')>(
    '@esl-pipeline/tts-elevenlabs',
  );
  return {
    ...actual,
    buildStudyTextMp3: vi.fn(),
  };
});

vi.mock('@esl-pipeline/storage-uploader', () => ({
  deriveS3UploadAddress: vi.fn().mockReturnValue({
    key: 'audio/file.mp3',
    url: 'https://s3.amazonaws.com/audio/file.mp3',
  }),
  uploadFile: vi
    .fn()
    .mockResolvedValue({ url: 'https://s3.amazonaws.com/audio/file.mp3', key: 'audio/file.mp3' }),
}));


describe('markdown caching', () => {
  it(
    'passes cached markdown content to validator when provided',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'md-cache-'));
      const mdPath = join(dir, 'lesson.md');
      const mdContent = '# Test\n';
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

      expect(validateMarkdownFile).toHaveBeenCalledTimes(1);
      const call = validateMarkdownFile.mock.calls[0];
      expect(call?.[0]).toBe(mdPath);
      expect(call?.[1]?.content).toBe(mdContent);
    },
    15000,
  );
});
