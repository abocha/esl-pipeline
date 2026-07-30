import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { PreparedStudyTextSynthesis, SpeechPerformancePlanV2 } from '@esl-pipeline/tts-core';

import { newAssignment, rerunAssignment } from '../src/index.js';

vi.mock('@esl-pipeline/tts-core', async () => {
  const actual =
    await vi.importActual<typeof import('@esl-pipeline/tts-core')>('@esl-pipeline/tts-core');
  return {
    ...actual,
    buildStudyTextMp3: vi.fn(),
    buildPronunciationShadowSentenceMp3: vi.fn(),
    buildPronunciationTextMp3: vi.fn(),
    prepareStudyTextSynthesis: vi.fn((input, options) =>
      actual.prepareStudyTextSynthesis(input, options),
    ),
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

    const { buildStudyTextMp3, prepareStudyTextSynthesis } = await import('@esl-pipeline/tts-core');
    const audioPath = join(dir, 'lesson.mp3');
    await writeFile(audioPath, 'dummy');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'abc123',
      voices: [{ speaker: 'Narrator', voiceId: 'voice_id_default', source: 'default' }],
    });
    const controller = new AbortController();
    const deadlineAtMs = Date.now() + 60_000;
    const result = await newAssignment(
      {
        md: mdPath,
        preset: 'default',
        withTts: true,
        ttsStrategy: 'auto',
        upload: 's3',
        dryRun: true,
        voices: voiceMapPath,
      },
      {},
      { signal: controller.signal, deadlineAtMs },
    );

    expect(result.steps).toContain('import');
    expect(result.manifestPath).toBeDefined();
    expect(result.audio?.url).toMatch(
      /^https:\/\/test-bucket\.s3\.amazonaws\.com\/audio\/final\/[a-f0-9]+\/Conditionals%20Type%202%20-%20Study%20Text\.mp3$/,
    );
    expect(buildStudyTextMp3).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ signal: controller.signal, deadlineAtMs }),
    );
    expect(prepareStudyTextSynthesis).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ ttsStrategy: 'auto' }),
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

    const { buildStudyTextMp3, prepareStudyTextSynthesis } = await import('@esl-pipeline/tts-core');
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
    expect(manifestJson.audioArtifacts.studyText.url).toBeDefined();

    vi.mocked(buildStudyTextMp3).mockClear();
    vi.mocked(prepareStudyTextSynthesis).mockClear();

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
      'add-audio',
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

  it('persists contextual planner mode, hash, returned model, and policy provenance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-contextual-plan-'));
    const mdPath = join(dir, 'lesson.md');
    const voiceMapPath = join(dir, 'voices.yml');
    const okDoc = await readFile(okFixturePath, 'utf8');
    await writeFile(mdPath, okDoc);
    await writeFile(voiceMapPath, 'default: voice_id_default');
    process.env.S3_BUCKET = 'test-bucket';
    process.env.AWS_REGION = 'us-east-1';

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-core');
    const audioPath = join(dir, 'lesson.mp3');
    await writeFile(audioPath, 'dummy');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'abc123',
      voices: [
        { speaker: 'Alex', voiceId: 'voice_id_default', source: 'default' },
        { speaker: 'Mara', voiceId: 'voice_id_second', source: 'auto' },
      ],
    });
    const speechPlanner = {
      async plan(prepared: PreparedStudyTextSynthesis): Promise<SpeechPerformancePlanV2> {
        return {
          schemaVersion: 2,
          mode: 'prompted',
          provider: prepared.selection.provider,
          model: prepared.selection.model,
          sourceHash: prepared.sourceHash,
          performanceContextHash: prepared.performanceContextHash!,
          resolvedPerformanceMode: prepared.performanceMode!,
          performanceContext: {
            overallDirection: {
              components: [
                {
                  dimension: 'relationship',
                  direction: 'sound like friendly conversation partners',
                },
              ],
              basis: ['frontmatter:topic'],
            },
            speakerEnvelopes: prepared.performanceSpeakers!.map((speaker) => ({
              speaker,
              baselineDirection: {
                components: [{ dimension: 'style', direction: 'stay natural and responsive' }],
                basis: ['frontmatter:topic'],
              },
            })),
          },
          planner: {
            provider: 'google_ai_studio',
            model: 'gemini-3.1-flash-lite',
            returnedModel: 'gemini-3.1-flash-lite-2026-07-15',
            generatedAt: '2026-07-30T00:00:00.000Z',
            promptPolicyVersion: 'speech-performance-v3-contextual-continuity',
            promptHash: 'a'.repeat(64),
          },
          segments: prepared.segments.map((segment) => ({ ...segment })),
        };
      },
    };

    const result = await newAssignment(
      {
        md: mdPath,
        withTts: true,
        upload: 's3',
        dryRun: true,
        voices: voiceMapPath,
        ttsProvider: 'inworld',
        ttsModel: 'inworld-tts-2',
        ttsStrategy: 'dialogue',
      },
      {},
      { speechPlanner },
    );
    const manifest = JSON.parse(await readFile(result.manifestPath!, 'utf8'));

    expect(manifest.speechPlans.studyText).toMatchObject({
      schemaVersion: 2,
      resolvedPerformanceMode: 'dialogue',
      performanceContextHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      planner: {
        provider: 'google_ai_studio',
        model: 'gemini-3.1-flash-lite',
        returnedModel: 'gemini-3.1-flash-lite-2026-07-15',
        generatedAt: '2026-07-30T00:00:00.000Z',
        promptPolicyVersion: 'speech-performance-v3-contextual-continuity',
        promptHash: 'a'.repeat(64),
      },
    });
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

    const { buildStudyTextMp3, prepareStudyTextSynthesis } = await import('@esl-pipeline/tts-core');
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

    vi.mocked(buildStudyTextMp3).mockClear();
    const activeController = new AbortController();
    const deadlineAtMs = Date.now() + 60_000;
    await rerunAssignment(
      {
        md: mdPath,
        regenerateStudyTextAudio: true,
        studyTextTtsStrategy: 'dialogue',
        upload: 's3',
        dryRun: true,
        voices: voiceMapPath,
      },
      { signal: activeController.signal, deadlineAtMs },
    );
    expect(buildStudyTextMp3).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ signal: activeController.signal, deadlineAtMs }),
    );
    expect(prepareStudyTextSynthesis).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ ttsStrategy: 'dialogue' }),
    );

    const controller = new AbortController();
    controller.abort('rerun stopped');

    await expect(
      rerunAssignment(
        {
          md: mdPath,
          regenerateStudyTextAudio: true,
          regeneratePronunciationMainAudio: true,
          regeneratePronunciationChunkAudio: true,
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

  it('supports rerun using manifestMd when markdown is materialized to a temp path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-rerun-manifest-md-'));
    const mdPath = join(dir, 'lesson.md');
    const tempMdPath = join(dir, 'temp-assignment.md');
    const voiceMapPath = join(dir, 'voices.yml');
    const okDoc = await readFile(okFixturePath, 'utf8');
    await writeFile(mdPath, okDoc);
    await writeFile(tempMdPath, okDoc);
    await writeFile(
      voiceMapPath,
      `
default: voice_id_default
    `.trim(),
    );
    process.env.S3_BUCKET = 'test-bucket';
    process.env.AWS_REGION = 'us-east-1';

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-core');
    const audioPath = join(dir, 'lesson.mp3');
    await writeFile(audioPath, 'dummy');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'abc123',
      voices: [{ speaker: 'Narrator', voiceId: 'voice_id_default', source: 'default' }],
    });

    const initial = await newAssignment({
      md: mdPath,
      withTts: true,
      upload: 's3',
      publishTarget: 'html',
      dryRun: true,
      voices: voiceMapPath,
    });

    const rerun = await rerunAssignment({
      md: tempMdPath,
      manifestMd: mdPath,
      republishOnly: true,
      upload: 's3',
      dryRun: true,
      voices: voiceMapPath,
    });

    expect(rerun.steps).toEqual(['add-audio']);
    expect(rerun.manifestPath).toBe(initial.manifestPath);

    const manifestAfterRerun = JSON.parse(await readFile(initial.manifestPath!, 'utf8'));
    expect(manifestAfterRerun.publishTarget).toBe('html');
    expect(manifestAfterRerun.audioArtifacts?.studyText?.url).toMatch(
      /^https:\/\/test-bucket\.s3\.amazonaws\.com\//,
    );
    expect(manifestAfterRerun.timestamp).toBeTypeOf('string');
  });

  it('keeps pronunciation-only reruns outside speech planning', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-pronunciation-only-'));
    const mdPath = join(dir, 'lesson.md');
    const voiceMapPath = join(dir, 'voices.yml');
    const okDoc = await readFile(okFixturePath, 'utf8');
    const pronunciation = `:::callout 🗣️
**Mode:** shadow_sentence
**Shadow sentence:** I was thinking about working this morning.
1. **thinking** — /ˈθɪŋkɪŋ/
2. **working** — /ˈwɜːrkɪŋ/
:::`;
    await writeFile(
      mdPath,
      okDoc.replace(
        /(### C\. 🎙️ Pronunciation Micro-Focus \(≈1 min\)\r?\n\r?\n)text/u,
        `$1${pronunciation}`,
      ),
    );
    await writeFile(voiceMapPath, 'default: voice_id_default');
    process.env.S3_BUCKET = 'test-bucket';
    process.env.AWS_REGION = 'us-east-1';

    const {
      buildPronunciationShadowSentenceMp3,
      buildPronunciationTextMp3,
      buildStudyTextMp3,
      prepareStudyTextSynthesis,
    } = await import('@esl-pipeline/tts-core');
    const audioPath = join(dir, 'lesson.mp3');
    await writeFile(audioPath, 'dummy');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'abc123',
      voices: [{ speaker: 'Narrator', voiceId: 'voice_id_default', source: 'default' }],
    });
    vi.mocked(buildPronunciationShadowSentenceMp3).mockResolvedValue({
      path: join(dir, 'shadow.mp3'),
      hash: 'shadow-hash',
      voiceId: 'voice_id_default',
    });
    vi.mocked(buildPronunciationTextMp3).mockResolvedValue({
      path: join(dir, 'item.mp3'),
      hash: 'item-hash',
      voiceId: 'voice_id_default',
    });

    await newAssignment({
      md: mdPath,
      withTts: true,
      upload: 's3',
      dryRun: true,
      voices: voiceMapPath,
    });

    await writeFile(
      mdPath,
      okDoc.replace(
        /(### C\. 🎙️ Pronunciation Micro-Focus \(≈1 min\)\r?\n\r?\n)text/u,
        `$1${pronunciation.replace('this morning', 'before the meeting').replaceAll('working', 'planning')}`,
      ),
    );

    vi.mocked(prepareStudyTextSynthesis).mockClear();
    vi.mocked(buildPronunciationShadowSentenceMp3).mockClear();
    vi.mocked(buildPronunciationTextMp3).mockClear();
    const speechPlanner = {
      plan: vi.fn().mockRejectedValue(new Error('must not be called')),
    };

    await rerunAssignment(
      {
        md: mdPath,
        regenerateStudyTextAudio: false,
        regeneratePronunciationMainAudio: true,
        regeneratePronunciationChunkAudio: true,
        upload: 's3',
        dryRun: true,
        voices: voiceMapPath,
      },
      { speechPlanner },
    );

    expect(speechPlanner.plan).not.toHaveBeenCalled();
    expect(prepareStudyTextSynthesis).not.toHaveBeenCalled();
    expect(buildPronunciationShadowSentenceMp3).toHaveBeenCalledTimes(1);
    expect(buildPronunciationTextMp3).toHaveBeenCalled();
  });
});
