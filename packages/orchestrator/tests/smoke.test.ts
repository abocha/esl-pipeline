import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@esl-pipeline/notion-importer', () => ({
  runImport: vi.fn().mockResolvedValue({ page_id: 'page-123', url: 'https://notion.so/page-123' }),
}));

vi.mock('@esl-pipeline/notion-colorizer', () => ({
  applyHeadingPreset: vi
    .fn()
    .mockResolvedValue({ applied: true, counts: { h2: 1, h3: 1, toggles: 0 } }),
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
  uploadFile: vi
    .fn()
    .mockResolvedValue({ url: 'https://s3.amazonaws.com/audio/file.mp3', key: 'audio/file.mp3' }),
}));

vi.mock('@esl-pipeline/notion-add-audio', () => ({
  addOrReplaceAudioUnderStudyText: vi.fn().mockResolvedValue({ replaced: false, appended: true }),
}));

describe('orchestrator smoke', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('runs full pipeline and produces manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-smoke-'));
    const mdPath = join(dir, 'assignment.md');
    const audioPath = join(dir, 'lesson.mp3');

    const markdown = `\n\n\n\`\`\`markdown\n---\ntitle: "Smoke Test"\nstudent: "Anna"\nlevel: B1\ntopic: travel\ninput_type: generate\nspeaker_labels: ["Anna"]\n---\n\n## 1. This Week's Mission Briefing\nIntro text\n\n## 2. Your Homework Roadmap\nRoadmap\n\n## 3. Input Material: The Source\n### B. Generated Material\n- **Text:**\n:::study-text\nAnna: Hello there!\n:::\n\n## 4. Language Toolkit: Useful Language\nToolkit\n\n## 5. Practice & Pronunciation\n### A. Controlled Practice\n1) one\n2) two\n3) three\n4) four\n5) five\n6) six\n7) seven\n8) eight\n### B. Comprehension Check\n1) q1\n2) q2\n\n## 6. Your Turn: Complete the Mission!\nMission\n\n## 7. Why This Mission Helps You\nWhy\n\n## 8. Answer Key & Sample Mission\n:::toggle-heading Answer Key\nAnswers\n:::\n\n## 9. Teacher's Follow-up Plan\n:::toggle-heading Teacher's Follow-up Plan\nPlan\n:::\n\`\`\``;

    await writeFile(mdPath, markdown.trim());
    await writeFile(audioPath, 'dummy audio');

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-elevenlabs');
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
      voices: 'configs/voices.yml',
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
    expect(statusAfter.manifest?.audio?.url).toBe('https://s3.amazonaws.com/audio/file.mp3');
    if (initialTimestamp && statusAfter.manifest?.timestamp) {
      expect(statusAfter.manifest.timestamp >= initialTimestamp).toBe(true);
    }
  });

  it('preserves TTS metadata when rerun without passing TTS flags', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-tts-metadata-'));
    const mdPath = join(dir, 'assignment.md');
    const audioPath = join(dir, 'lesson.mp3');

    const okFixturePath = join(import.meta.dirname, '../../md-validator/fixtures/ok.md');
    const okDoc = await readFile(okFixturePath, 'utf8');
    await writeFile(mdPath, okDoc);
    await writeFile(audioPath, 'dummy audio');

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-elevenlabs');
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
      voices: 'configs/voices.yml',
      ttsMode: 'dialogue',
      dialogueLanguage: 'es',
      dialogueStability: 0.55,
      dialogueSeed: 999,
      dryRun: false,
    });

    const manifestFirst = JSON.parse(await readFile(firstRun.manifestPath!, 'utf8'));
    expect(manifestFirst.ttsMode).toBe('dialogue');
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
    expect(manifestSecond.ttsMode).toBe('dialogue');
    expect(manifestSecond.dialogueLanguage).toBe('es');
    expect(manifestSecond.dialogueStability).toBe(0.55);
    expect(manifestSecond.dialogueSeed).toBe(999);
  });
});
