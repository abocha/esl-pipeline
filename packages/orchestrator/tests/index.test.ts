import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { newAssignment, rerunAssignment } from '../src/index.js';

vi.mock('@esl-pipeline/tts-elevenlabs', async () => {
  const actual = await vi.importActual<typeof import('@esl-pipeline/tts-elevenlabs')>(
    '@esl-pipeline/tts-elevenlabs',
  );
  return {
    ...actual,
    buildStudyTextMp3: vi.fn(),
  };
});

const okFixturePath = join(import.meta.dirname, '../../md-validator/fixtures/ok.md');

describe('orchestrator stub', () => {
  it('produces manifest and step summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-'));
    const mdPath = join(dir, 'lesson.md');
    const voiceMapPath = join(dir, 'voices.yml');
    const okDoc = await readFile(okFixturePath, 'utf8');
    await writeFile(mdPath, okDoc);
    await writeFile(
      voiceMapPath,
      `
default: voice_id_default
    `.trim(),
    );
    // Set required env vars for dry-run upload preview
    process.env.S3_BUCKET = 'test-bucket';
    process.env.AWS_REGION = 'us-east-1';

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-elevenlabs');
    const audioPath = join(dir, 'lesson.mp3');
    await writeFile(audioPath, 'dummy');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'abc123',
      voices: [{ speaker: 'Narrator', voiceId: 'voice_id_default', source: 'default' }],
    });
    const result = await newAssignment({
      md: mdPath,
      preset: 'default',
      withTts: true,
      upload: 's3',
      dryRun: true,
      voices: voiceMapPath,
    });

    expect(result.steps).toContain('import');
    expect(result.manifestPath).toBeDefined();
    expect(result.pageId).toBeUndefined();
    expect(result.audio?.url).toMatch(
      /^https:\/\/test-bucket\.s3\.amazonaws\.com\/audio\/assignments\/.*\.mp3$/,
    );
  }, 30_000);

  it('reuses manifest assets when skip flags are provided', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-skip-'));
    const mdPath = join(dir, 'lesson.md');
    const voiceMapPath = join(dir, 'voices.yml');
    const okDoc = await readFile(okFixturePath, 'utf8');
    await writeFile(mdPath, okDoc);
    await writeFile(
      voiceMapPath,
      `
default: voice_id_default
    `.trim(),
    );
    process.env.S3_BUCKET = 'test-bucket';
    process.env.AWS_REGION = 'us-east-1';

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-elevenlabs');
    const audioPath = join(dir, 'lesson.mp3');
    await writeFile(audioPath, 'dummy');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'abc123',
      voices: [{ speaker: 'Narrator', voiceId: 'voice_id_default', source: 'default' }],
    });

    const baseFlags = {
      md: mdPath,
      withTts: true,
      upload: 's3' as const,
      dryRun: true,
      voices: voiceMapPath,
      ttsStrategy: 'dialogue' as const,
      dialogueLanguage: 'es',
      dialogueStability: 0.65,
      dialogueSeed: 321,
    };

    const first = await newAssignment(baseFlags);
    expect(first.manifestPath).toBeDefined();
    expect(first.steps).toContain('manifest');
    const manifestJson = JSON.parse(await readFile(first.manifestPath!, 'utf8'));
    expect(manifestJson.audio.url).toBeDefined();

    vi.mocked(buildStudyTextMp3).mockClear();

    const second = await newAssignment({
      ...baseFlags,
      skipImport: true,
      skipTts: true,
      skipUpload: true,
    });

    expect(second.steps).toEqual([
      'validate',
      'skip:import',
      'skip:tts',
      'skip:upload',
      'manifest',
    ]);
    expect(buildStudyTextMp3).not.toHaveBeenCalled();
    expect(second.audio?.url).toBe(first.audio?.url);

    const manifestJsonUpdated = JSON.parse(await readFile(second.manifestPath!, 'utf8'));
    expect(manifestJsonUpdated.ttsStrategy).toBe('dialogue');
    expect(manifestJsonUpdated.dialogueLanguage).toBe('es');
    expect(manifestJsonUpdated.dialogueStability).toBe(0.65);
    expect(manifestJsonUpdated.dialogueSeed).toBe(321);
  });

  it('throws a cancellation error and skips manifest write when signal is aborted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-cancel-'));
    const mdPath = join(dir, 'lesson.md');
    const okDoc = await readFile(okFixturePath, 'utf8');
    await writeFile(mdPath, okDoc);

    const controller = new AbortController();
    controller.abort('test cancellation');

    await expect(
      newAssignment(
        {
          md: mdPath,
          withTts: false,
          dryRun: true,
        },
        {},
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({
      name: 'PipelineCancelledError',
      message: 'cancelled: test cancellation',
    });

    await expect(readFile(join(dir, 'lesson.manifest.json'), 'utf8')).rejects.toBeDefined();
  });

  it('supports cancellation on rerun before stage execution', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-rerun-cancel-'));
    const mdPath = join(dir, 'lesson.md');
    const voiceMapPath = join(dir, 'voices.yml');
    const okDoc = await readFile(okFixturePath, 'utf8');
    await writeFile(mdPath, okDoc);
    await writeFile(
      voiceMapPath,
      `
default: voice_id_default
    `.trim(),
    );
    process.env.S3_BUCKET = 'test-bucket';
    process.env.AWS_REGION = 'us-east-1';

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-elevenlabs');
    const audioPath = join(dir, 'lesson.mp3');
    await writeFile(audioPath, 'dummy');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'abc123',
      voices: [{ speaker: 'Narrator', voiceId: 'voice_id_default', source: 'default' }],
    });

    await newAssignment({
      md: mdPath,
      withTts: true,
      upload: 's3',
      dryRun: true,
      voices: voiceMapPath,
    });

    const controller = new AbortController();
    controller.abort('rerun stopped');

    await expect(
      rerunAssignment(
        {
          md: mdPath,
          steps: ['tts', 'upload', 'add-audio'],
          upload: 's3',
          dryRun: true,
          voices: voiceMapPath,
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({
      name: 'PipelineCancelledError',
      message: 'cancelled: rerun stopped',
    });
  });
});
