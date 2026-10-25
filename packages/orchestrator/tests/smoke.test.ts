import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { assignmentFixture } from './assignment-fixture.js';

vi.mock('@esl-pipeline/tts-core', async () => {
  const actual =
    await vi.importActual<typeof import('@esl-pipeline/tts-core')>('@esl-pipeline/tts-core');
  return {
    ...actual,
    buildStudyTextMp3: vi.fn(),
    prepareStudyTextSynthesis: vi.fn(async (input, options) => {
      const prepared = actual.createPreparedStudyTextSynthesis(input, options);
      return {
        ...prepared,
        voicePlan: {
          schemaVersion: 1,
          mode: 'deterministic',
          provider: prepared.selection.provider,
          model: prepared.selection.model,
          sourceHash: prepared.sourceHash,
          assignments: [],
        },
      };
    }),
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

    const markdown = `---\ntitle: "Smoke Test"\nstudent: "Anna"\nlevel: B1\ntopic: travel\ninput_type: generate\nspeaker_labels: ["Anna"]\n---\n\n## 1. This Week's Mission Briefing\nIntro text\n\n## 2. Input Material: The Source\n### Generated Material\n- **Text:**\n:::study-text\nAnna: Hello there!\n:::\n\n### Comprehension Check\n1) q1\n2) q2\n\n## 3. Language Toolkit: Useful Language\nToolkit\n\n## 4. Practice & Pronunciation\n### A. Controlled Practice\n1) one\n2) two\n3) three\n4) four\n5) five\n6) six\n7) seven\n8) eight\n### B. Pronunciation Micro-Focus\nPractice target pronunciation from the study text.\n\n## 5. Your Turn: Complete the Mission!\nMission\n\n## 6. Why This Mission Helps You\nWhy\n\n## 7. Answer Key & Sample Mission\n:::toggle-heading Answer Key\nAnswers\n:::\n\n## 8. Teacher's Follow-up Plan\n:::toggle-heading Teacher's Follow-up Plan\nPlan\n:::`;

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
      assignment: assignmentFixture(),
      md: mdPath,
      preset: 'default',
      withTts: true,
      upload: 's3',
      voices: 'packages/orchestrator/configs/voices.yml',
      dryRun: false,
    });

    expect(result.steps).toEqual([
      'validate',
      'import',
      'voice-plan',
      'speech-plan',
      'tts',
      'upload',
      'add-audio',
      'manifest',
    ]);
    expect(result.audio?.url).toBe('https://s3.amazonaws.com/audio/file.mp3');
    expect(result.manifestPath).toBeTruthy();
    const manifestContents = await readFile(result.manifestPath!, 'utf8');
    expect(manifestContents).toContain('"publishTarget": "html"');
    expect(manifestContents).toContain('"voicePlans"');
    expect(manifestContents).toContain('"speechPlans"');

    const statusBefore = await getAssignmentStatus(mdPath);
    expect(statusBefore.manifest?.publishTarget).toBe('html');
    expect(statusBefore.mdHashMatches).toBe(false);
    const initialTimestamp = statusBefore.manifest?.timestamp;

    const rerun = await rerunAssignment({
      assignment: assignmentFixture(),
      md: mdPath,
      republishOnly: true,
      upload: 's3',
      dryRun: false,
      publicRead: false,
    });

    expect(rerun.steps).toEqual(['add-audio']);
    const statusAfter = await getAssignmentStatus(mdPath);
    expect(statusAfter.manifest?.audioArtifacts?.studyText?.url).toBe(
      'https://s3.amazonaws.com/audio/file.mp3',
    );
    expect(initialTimestamp).toBeDefined();
    expect(statusAfter.manifest?.timestamp).toBeDefined();
    expect(statusAfter.manifest!.timestamp >= initialTimestamp!).toBe(true);
  }, 90000);

  it('keeps HTML publishing on the static theme path even when rerunning the same preset', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-colorize-skip-'));
    const mdPath = join(dir, 'assignment.md');
    const okFixturePath = join(
      import.meta.dirname,
      '../../contracts/tests/assignment-fixture.json',
    );
    const okDoc = await readFile(okFixturePath, 'utf8');
    await writeFile(mdPath, okDoc);

    const { newAssignment } = await import('../src/index.js');

    const first = await newAssignment({
      assignment: assignmentFixture(),
      md: mdPath,
      preset: 'default',
      withTts: false,
      dryRun: false,
    });
    expect(first.steps).not.toContain('colorize');

    const second = await newAssignment({
      assignment: assignmentFixture(),
      md: mdPath,
      preset: 'default',
      withTts: false,
      dryRun: false,
    });

    expect(second.steps).not.toContain('colorize');
    const secondManifest = JSON.parse(await readFile(second.manifestPath!, 'utf8'));
    expect(secondManifest.publishTarget).toBe('html');
    expect(secondManifest).not.toHaveProperty('notionColorization');
  }, 90000);

  it('preserves TTS metadata when rerun without passing TTS flags', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-tts-metadata-'));
    const mdPath = join(dir, 'assignment.md');
    const audioPath = join(dir, 'lesson.mp3');

    const okFixturePath = join(
      import.meta.dirname,
      '../../contracts/tests/assignment-fixture.json',
    );
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
      assignment: assignmentFixture(),
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
      assignment: assignmentFixture(),
      md: mdPath,
      republishOnly: true,
      upload: 's3',
      dryRun: false,
    });

    const manifestSecond = JSON.parse(await readFile(rerun.manifestPath, 'utf8'));
    expect(manifestSecond.ttsStrategy).toBe('dialogue');
    expect(manifestSecond.dialogueLanguage).toBe('es');
    expect(manifestSecond.dialogueStability).toBe(0.55);
    expect(manifestSecond.dialogueSeed).toBe(999);
  }, 90000);

  it('rerun upload/add-audio does not require parseable markdown when tts is not requested', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-rerun-no-tts-parse-'));
    const mdPath = join(dir, 'assignment.md');
    const audioPath = join(dir, 'lesson.mp3');

    const okFixturePath = join(
      import.meta.dirname,
      '../../contracts/tests/assignment-fixture.json',
    );
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
      assignment: assignmentFixture(),
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
      assignment: assignmentFixture(),
      md: mdPath,
      republishOnly: true,
      upload: 's3',
      dryRun: false,
    });

    expect(rerun.steps).toEqual(['add-audio']);
  }, 90000);

  it('strips legacy audio alias on republish rerun', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-legacy-prefix-'));
    const mdPath = join(dir, 'assignment.md');
    const audioPath = join(dir, 'lesson.mp3');

    const okFixturePath = join(
      import.meta.dirname,
      '../../contracts/tests/assignment-fixture.json',
    );
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
      assignment: assignmentFixture(),
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

    await rerunAssignment({
      assignment: assignmentFixture(),
      md: mdPath,
      republishOnly: true,
      upload: 's3',
      dryRun: false,
      prefix: 'legacy-prefix',
    });

    const manifestAfter = JSON.parse(await readFile(firstRun.manifestPath!, 'utf8'));
    expect(manifestAfter.audio).toBeUndefined();
    expect(manifestAfter.audioArtifacts?.studyText?.url).toBe(
      'https://s3.amazonaws.com/audio/file.mp3',
    );
  }, 90000);

  it('normalizes a legacy manifest publish target to html during republish reruns', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-legacy-publish-target-'));
    const mdPath = join(dir, 'assignment.md');
    const audioPath = join(dir, 'lesson.mp3');

    const okFixturePath = join(
      import.meta.dirname,
      '../../contracts/tests/assignment-fixture.json',
    );
    const okDoc = await readFile(okFixturePath, 'utf8');
    await writeFile(mdPath, okDoc);
    await writeFile(audioPath, 'dummy audio');

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-core');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'abc123',
      voices: [{ speaker: 'Anna', voiceId: 'voice_id_default', source: 'default' }],
    });

    const { newAssignment, rerunAssignment, getAssignmentStatus } = await import('../src/index.js');
    const initial = await newAssignment({
      assignment: assignmentFixture(),
      md: mdPath,
      preset: 'default',
      withTts: true,
      upload: 's3',
      voices: 'packages/orchestrator/configs/voices.yml',
      dryRun: false,
    });

    const manifest = JSON.parse(await readFile(initial.manifestPath!, 'utf8'));
    manifest.publishTarget = 'anytype';
    await writeFile(initial.manifestPath!, JSON.stringify(manifest, null, 2));

    const statusBefore = await getAssignmentStatus(mdPath);
    expect(statusBefore.manifest?.publishTarget).toBe('html');

    const rerun = await rerunAssignment({
      assignment: assignmentFixture(),
      md: mdPath,
      republishOnly: true,
      upload: 's3',
      dryRun: false,
    });

    expect(rerun.publishTarget).toBe('html');
    const manifestAfter = JSON.parse(await readFile(initial.manifestPath!, 'utf8'));
    expect(manifestAfter.publishTarget).toBe('html');
  }, 90000);
});
