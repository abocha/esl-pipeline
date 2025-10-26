import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newAssignment } from '../src/index.js';

vi.mock('@esl-pipeline/tts-elevenlabs', async () => {
  const actual = await vi.importActual<typeof import('@esl-pipeline/tts-elevenlabs')>(
    '@esl-pipeline/tts-elevenlabs'
  );
  return {
    ...actual,
    buildStudyTextMp3: vi.fn(),
  };
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const okFixturePath = join(__dirname, '../../md-validator/fixtures/ok.md');

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
    `.trim()
    );
    // Set required env vars for dry-run upload preview
    process.env.S3_BUCKET = 'test-bucket';
    process.env.AWS_REGION = 'us-east-1';

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-elevenlabs');
    const audioPath = join(dir, 'lesson.mp3');
    await writeFile(audioPath, 'dummy');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({ path: audioPath, hash: 'abc123' });
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
      /^https:\/\/test-bucket\.s3\.amazonaws\.com\/audio\/assignments\/.*\.mp3$/
    );
  }, 30000);
});
