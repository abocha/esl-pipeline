import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@esl-pipeline/notion-adapter', () => ({
  runImport: vi.fn().mockResolvedValue({ page_id: 'page-123', url: 'https://notion.so/page-123' }),
  loadPreset: vi.fn().mockResolvedValue({ h2: 'blue', h3: 'green', toggleMap: { h2: 'yellow' } }),
  applyHeadingPreset: vi
    .fn()
    .mockResolvedValue({ applied: true, counts: { h2: 1, h3: 1, toggles: 0 } }),
  hashColorPreset: vi.fn().mockReturnValue('preset-hash-default'),
  addOrReplaceAudio: vi.fn().mockResolvedValue({ replaced: false, appended: true }),
  addOrReplaceAudioUnderStudyText: vi.fn().mockResolvedValue({ replaced: false, appended: true }),
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

describe('orchestrator smoke', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('runs full pipeline and produces manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-smoke-'));
    const mdPath = join(dir, 'assignment.md');
    const audioPath = join(dir, 'lesson.mp3');

    const markdown = `---\ntitle: "Smoke Test"\nstudent: "Anna"\nlevel: B1\ntopic: travel\ninput_type: generate\nspeaker_labels: ["Anna"]\n---\n\n## 1. This Week's Mission Briefing\nIntro text\n\n## 2. Your Homework Roadmap\nRoadmap\n\n## 3. Input Material: The Source\n### B. Generated Material\n- **Text:**\n:::study-text\nAnna: Hello there!\n:::\n\n## 4. Language Toolkit: Useful Language\nToolkit\n\n## 5. Practice & Pronunciation\n### A. Controlled Practice\n1) one\n2) two\n3) three\n4) four\n5) five\n6) six\n7) seven\n8) eight\n### B. Comprehension Check\n1) q1\n2) q2\n\n### C. Pronunciation Micro-Focus\nPractice target pronunciation from the study text.\n\n## 6. Your Turn: Complete the Mission!\nMission\n\n## 7. Why This Mission Helps You\nWhy\n\n## 8. Answer Key & Sample Mission\n:::toggle-heading Answer Key\nAnswers\n:::\n\n## 9. Teacher's Follow-up Plan\n:::toggle-heading Teacher's Follow-up Plan\nPlan\n:::`;

    await writeFile(mdPath, markdown.trim());
    await writeFile(audioPath, 'dummy audio');

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-core');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'abc123',
      voices: [{ speaker: 'Anna', voiceId: 'voice_id_default', source: 'default' }],
    });

    const { newAssignment, getAssignmentStatus, rerunAssignment } = await import('../src/index.js');
    const result = await newAssignment({
      md: mdPath,
      preset: 'default',
      withTts: true,
      upload: 's3',
      voices: 'packages/orchestrator/configs/voices.yml',
      dbId: 'db-123',
      dryRun: false,
    });

    expect(result.steps).toEqual([
      'validate',
      'import',
      'colorize',
      'colorize:default:1/1/0',
      'tts',
      'upload',
      'add-audio',
      'manifest',
    ]);
    expect(result.pageId).toBe('page-123');
    expect(result.audio?.url).toBe('https://s3.amazonaws.com/audio/file.mp3');
    expect(result.manifestPath).toBeTruthy();
    const manifestContents = await readFile(result.manifestPath!, 'utf8');
    expect(manifestContents).toContain('"pageId": "page-123"');

    const statusBefore = await getAssignmentStatus(mdPath);
    expect(statusBefore.manifest?.pageId).toBe('page-123');
    expect(statusBefore.mdHashMatches).toBe(true);
    const initialTimestamp = statusBefore.manifest?.timestamp;

    const rerun = await rerunAssignment({
      md: mdPath,
      steps: ['upload', 'add-audio'],
      upload: 's3',
      dryRun: false,
      publicRead: false,
    });

    expect(rerun.steps).toEqual(['upload', 'add-audio']);
    const statusAfter = await getAssignmentStatus(mdPath);
    expect(statusAfter.manifest?.audioArtifacts?.studyText?.url).toBe(
      'https://s3.amazonaws.com/audio/file.mp3',
    );
    expect(initialTimestamp).toBeDefined();
    expect(statusAfter.manifest?.timestamp).toBeDefined();
    expect(statusAfter.manifest!.timestamp >= initialTimestamp!).toBe(true);
  }, 15000);

  it('skips notion colorize when preset hash, page, and markdown hash are unchanged', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-colorize-skip-'));
    const mdPath = join(dir, 'assignment.md');
    const okFixturePath = join(import.meta.dirname, '../../md-validator/fixtures/ok.md');
    const okDoc = await readFile(okFixturePath, 'utf8');
    await writeFile(mdPath, okDoc);

    const { newAssignment } = await import('../src/index.js');
    const { applyHeadingPreset, hashColorPreset } = await import('@esl-pipeline/notion-adapter');

    vi.mocked(applyHeadingPreset).mockClear();
    vi.mocked(hashColorPreset).mockClear();

    const first = await newAssignment({
      md: mdPath,
      preset: 'default',
      withTts: false,
      dryRun: false,
    });
    expect(first.steps).toContain('colorize');

    const second = await newAssignment({
      md: mdPath,
      preset: 'default',
      withTts: false,
      dryRun: false,
    });

    expect(second.steps).not.toContain('colorize');
    expect(vi.mocked(applyHeadingPreset)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(hashColorPreset)).toHaveBeenCalledTimes(2);
    const secondManifest = JSON.parse(await readFile(second.manifestPath!, 'utf8'));
    expect(secondManifest.notionColorization).toEqual(
      expect.objectContaining({
        preset: 'default',
        presetHash: 'preset-hash-default',
        pageId: 'page-123',
      }),
    );
  }, 15000);

  it('preserves TTS metadata when rerun without passing TTS flags', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-tts-metadata-'));
    const mdPath = join(dir, 'assignment.md');
    const audioPath = join(dir, 'lesson.mp3');

    const okFixturePath = join(import.meta.dirname, '../../md-validator/fixtures/ok.md');
    const okDoc = await readFile(okFixturePath, 'utf8');
    await writeFile(mdPath, okDoc);
    await writeFile(audioPath, 'dummy audio');

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-core');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'abc123',
      voices: [{ speaker: 'Anna', voiceId: 'voice_id_default', source: 'default' }],
    });

    const { newAssignment, rerunAssignment } = await import('../src/index.js');
    const firstRun = await newAssignment({
      md: mdPath,
      preset: 'default',
      withTts: true,
      upload: 's3',
      voices: 'packages/orchestrator/configs/voices.yml',
      ttsStrategy: 'dialogue',
      dialogueLanguage: 'es',
      dialogueStability: 0.55,
      dialogueSeed: 999,
      dryRun: false,
    });

    const manifestFirst = JSON.parse(await readFile(firstRun.manifestPath!, 'utf8'));
    expect(manifestFirst.ttsStrategy).toBe('dialogue');
    expect(manifestFirst.dialogueLanguage).toBe('es');
    expect(manifestFirst.dialogueStability).toBe(0.55);
    expect(manifestFirst.dialogueSeed).toBe(999);

    vi.mocked(buildStudyTextMp3).mockClear();

    const rerun = await rerunAssignment({
      md: mdPath,
      steps: ['upload', 'add-audio'],
      upload: 's3',
      dryRun: false,
    });

    const manifestSecond = JSON.parse(await readFile(rerun.manifestPath, 'utf8'));
    expect(manifestSecond.ttsStrategy).toBe('dialogue');
    expect(manifestSecond.dialogueLanguage).toBe('es');
    expect(manifestSecond.dialogueStability).toBe(0.55);
    expect(manifestSecond.dialogueSeed).toBe(999);
  }, 15000);

  it('rerun upload/add-audio does not require parseable markdown when tts is not requested', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-rerun-no-tts-parse-'));
    const mdPath = join(dir, 'assignment.md');
    const audioPath = join(dir, 'lesson.mp3');

    const okFixturePath = join(import.meta.dirname, '../../md-validator/fixtures/ok.md');
    const okDoc = await readFile(okFixturePath, 'utf8');
    await writeFile(mdPath, okDoc);
    await writeFile(audioPath, 'dummy audio');

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-core');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'abc123',
      voices: [{ speaker: 'Anna', voiceId: 'voice_id_default', source: 'default' }],
    });

    const { newAssignment, rerunAssignment } = await import('../src/index.js');
    await newAssignment({
      md: mdPath,
      preset: 'default',
      withTts: true,
      upload: 's3',
      voices: 'packages/orchestrator/configs/voices.yml',
      dryRun: false,
    });

    // Intentionally malformed for PMD parse. Non-TTS rerun should still proceed.
    await writeFile(mdPath, '# broken markdown without frontmatter\n');

    const rerun = await rerunAssignment({
      md: mdPath,
      steps: ['upload', 'add-audio'],
      upload: 's3',
      dryRun: false,
    });

    expect(rerun.steps).toEqual(['upload', 'add-audio']);
  }, 15000);

  it('preserves explicit upload prefix when studyText hash is missing and strips legacy audio alias on rerun', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-legacy-prefix-'));
    const mdPath = join(dir, 'assignment.md');
    const audioPath = join(dir, 'lesson.mp3');

    const okFixturePath = join(import.meta.dirname, '../../md-validator/fixtures/ok.md');
    const okDoc = await readFile(okFixturePath, 'utf8');
    await writeFile(mdPath, okDoc);
    await writeFile(audioPath, 'dummy audio');

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-core');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'abc123',
      voices: [{ speaker: 'Anna', voiceId: 'voice_id_default', source: 'default' }],
    });

    const { newAssignment, rerunAssignment } = await import('../src/index.js');
    const firstRun = await newAssignment({
      md: mdPath,
      preset: 'default',
      withTts: true,
      upload: 's3',
      voices: 'packages/orchestrator/configs/voices.yml',
      dryRun: false,
    });

    const manifest = JSON.parse(await readFile(firstRun.manifestPath!, 'utf8'));
    manifest.audio = {
      path: '/tmp/stale-legacy.mp3',
      url: 'https://legacy.example.com/stale.mp3',
      hash: 'legacy-hash',
    };
    manifest.audioArtifacts.studyText.hash = undefined;
    await writeFile(firstRun.manifestPath!, JSON.stringify(manifest, null, 2));

    const { uploadFile } = await import('@esl-pipeline/storage-uploader');
    vi.mocked(uploadFile).mockClear();

    await rerunAssignment({
      md: mdPath,
      steps: ['upload'],
      upload: 's3',
      dryRun: false,
      prefix: 'legacy-prefix',
    });

    expect(uploadFile).toHaveBeenCalledTimes(1);
    const uploadOpts = vi.mocked(uploadFile).mock.calls[0]?.[1];
    expect(uploadOpts?.prefix).toBe('legacy-prefix');
    expect(uploadOpts?.key).toBeUndefined();

    const manifestAfter = JSON.parse(await readFile(firstRun.manifestPath!, 'utf8'));
    expect(manifestAfter.audio).toBeUndefined();
    expect(manifestAfter.audioArtifacts?.studyText?.url).toBe(
      'https://s3.amazonaws.com/audio/file.mp3',
    );
  }, 15000);
});
