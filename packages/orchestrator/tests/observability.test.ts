import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PipelineLogEvent, PipelineLogger, PipelineMetrics } from '../src/observability.js';

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

vi.mock('../src/runtime/pronunciation-audio.js', () => ({
  synthesizePronunciationAudio: vi.fn(),
}));

import { uploadFile } from '@esl-pipeline/storage-uploader';

import { synthesizePronunciationAudio } from '../src/runtime/pronunciation-audio.js';

describe('orchestrator observability', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('emits start/success events for each stage in newAssignment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-observe-'));
    const mdPath = join(dir, 'assignment.md');
    const audioPath = join(dir, 'lesson.mp3');

    const markdown = await readFile(
      join(import.meta.dirname, '../../md-validator/fixtures/ok.md'),
      'utf8',
    );
    await writeFile(mdPath, markdown);
    await writeFile(audioPath, 'dummy audio');

    process.env.S3_BUCKET = 'observability-bucket';
    process.env.AWS_REGION = 'us-east-1';

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-core');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'abc123',
      voices: [{ speaker: 'Anna', voiceId: 'voice_id_default', source: 'default' }],
    });
    vi.mocked(synthesizePronunciationAudio).mockResolvedValue({
      mode: 'shadow_sentence',
      primaryClip: {
        id: 'pron-primary',
        kind: 'shadow_sentence',
        engine: 'provider',
        text: 'Hello there.',
        tts: {
          provider: 'google',
          generatedCharacters: 12,
          cachedCharacters: 3,
        },
      },
      itemClips: [
        {
          id: 'pron-item-1',
          itemIndex: 0,
          kind: 'sentence_item',
          engine: 'provider',
          text: 'Hello',
          tts: {
            provider: 'google',
            generatedCharacters: 5,
            cachedCharacters: 2,
          },
        },
      ],
    });

    const logs: PipelineLogEvent[] = [];
    const timings: { metric: string; durationMs: number; tags?: Record<string, string> }[] = [];
    const increments: { metric: string; value?: number; tags?: Record<string, string> }[] = [];

    const logger: PipelineLogger = { log: (event) => logs.push(event) };
    const metrics: PipelineMetrics = {
      timing: (metric, durationMs, tags) => timings.push({ metric, durationMs, tags }),
      increment: (metric, value, tags) => increments.push({ metric, value, tags }),
    };

    const { newAssignment } = await import('../src/index.js');
    await newAssignment(
      {
        md: mdPath,
        preset: 'default',
        withTts: true,
        upload: 's3',
        voices: 'packages/orchestrator/configs/voices.yml',
        dryRun: true,
      },
      {},
      { logger, metrics, runId: 'run-new' },
    );

    const expectedStages = ['validate', 'import', 'tts', 'upload', 'add-audio', 'manifest'];
    for (const stage of expectedStages) {
      const start = logs.find((e) => e.message === `stage.${stage}.start`);
      const success = logs.find((e) => e.message === `stage.${stage}.success`);
      expect(start, `missing start for ${stage}`).toBeDefined();
      expect(success, `missing success for ${stage}`).toBeDefined();
    }
    expect(logs.find((event) => event.message === 'stage.colorize.skipped')).toBeDefined();

    // Ensure one timing metric per successful stage (stage.*) plus the pipeline summary metric.
    const stageTimings = timings.filter((t) => t.metric === 'esl.pipeline.stage.duration_ms');
    expect(stageTimings.map((t) => t.tags?.stage)).toEqual(expect.arrayContaining(expectedStages));
    expect(
      timings.some(
        (t) =>
          t.metric === 'esl.pipeline.new_assignment.duration_ms' && t.tags?.result === 'success',
      ),
    ).toBe(true);

    // Success counters should be present for each stage.
    const successCounters = increments.filter((i) => i.metric === 'esl.pipeline.stage.success');
    expect(successCounters.map((c) => c.tags?.stage)).toEqual(
      expect.arrayContaining(expectedStages),
    );
    expect(increments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: 'esl.tts.provider_characters',
          value: 17,
          tags: { type: 'generated' },
        }),
        expect.objectContaining({
          metric: 'esl.tts.provider_characters',
          value: 5,
          tags: { type: 'cached' },
        }),
      ]),
    );
  }, 90_000);

  it('emits start/success events for rerunAssignment steps', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-observe-rerun-'));
    const mdPath = join(dir, 'assignment.md');
    const audioPath = join(dir, 'lesson.mp3');

    const markdown = await readFile(
      join(import.meta.dirname, '../../md-validator/fixtures/ok.md'),
      'utf8',
    );
    await writeFile(mdPath, markdown);
    await writeFile(audioPath, 'dummy audio');
    process.env.S3_BUCKET = 'observability-bucket';
    process.env.AWS_REGION = 'us-east-1';

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-core');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'abc123',
      voices: [{ speaker: 'Anna', voiceId: 'voice_id_default', source: 'default' }],
    });
    vi.mocked(synthesizePronunciationAudio).mockImplementation(async () => {});

    const { newAssignment, rerunAssignment } = await import('../src/index.js');
    await newAssignment(
      {
        md: mdPath,
        preset: 'default',
        withTts: true,
        upload: 's3',
        voices: 'packages/orchestrator/configs/voices.yml',
        dryRun: true,
      },
      {},
      { runId: 'run-initial' },
    );

    const logs: PipelineLogEvent[] = [];
    const timings: { metric: string; durationMs: number; tags?: Record<string, string> }[] = [];
    const increments: { metric: string; value?: number; tags?: Record<string, string> }[] = [];

    const logger: PipelineLogger = { log: (event) => logs.push(event) };
    const metrics: PipelineMetrics = {
      timing: (metric, durationMs, tags) => timings.push({ metric, durationMs, tags }),
      increment: (metric, value, tags) => increments.push({ metric, value, tags }),
    };

    await rerunAssignment(
      {
        md: mdPath,
        republishOnly: true,
        upload: 's3',
        dryRun: true,
      },
      { logger, metrics, runId: 'run-rerun' },
    );

    // Only add-audio/manifest are executed for republish-only reruns; tts/upload are skipped.
    const executedStages = ['add-audio', 'manifest'];
    for (const stage of executedStages) {
      const start = logs.find((e) => e.message === `stage.${stage}.start`);
      const success = logs.find((e) => e.message === `stage.${stage}.success`);
      expect(start, `missing start for ${stage}`).toBeDefined();
      expect(success, `missing success for ${stage}`).toBeDefined();
    }

    const skippedTts = logs.find(
      (e) => e.message === 'stage.tts.skipped' || e.message === 'stage.tts.success',
    );
    expect(skippedTts?.message).toBe('stage.tts.skipped');
    const skippedUpload = logs.find(
      (e) => e.message === 'stage.upload.skipped' || e.message === 'stage.upload.success',
    );
    expect(skippedUpload?.message).toBe('stage.upload.skipped');

    const stageTimings = timings.filter((t) => t.metric === 'esl.pipeline.stage.duration_ms');
    expect(stageTimings.map((t) => t.tags?.stage)).toEqual(expect.arrayContaining(executedStages));
    expect(
      timings.some(
        (t) => t.metric === 'esl.pipeline.rerun.duration_ms' && t.tags?.result === 'success',
      ),
    ).toBe(true);

    const successCounters = increments.filter((i) => i.metric === 'esl.pipeline.stage.success');
    expect(successCounters.map((c) => c.tags?.stage)).toEqual(
      expect.arrayContaining(executedStages),
    );
  }, 90_000);

  it('forces upload replacement for regenerated rerun artifacts while reusing unchecked audio', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-rerun-upload-'));
    const mdPath = join(dir, 'assignment.md');
    const audioPath = join(dir, 'lesson.mp3');

    const markdown = await readFile(
      join(import.meta.dirname, '../../md-validator/fixtures/ok.md'),
      'utf8',
    );
    await writeFile(mdPath, markdown);
    await writeFile(audioPath, 'dummy audio');

    process.env.S3_BUCKET = 'observability-bucket';
    process.env.AWS_REGION = 'us-east-1';

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-core');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'study-hash',
      voices: [{ speaker: 'Anna', voiceId: 'voice_id_default', source: 'default' }],
    });
    vi.mocked(synthesizePronunciationAudio)
      .mockResolvedValueOnce({
        mode: 'shadow_sentence',
        primaryClip: {
          id: 'pron-primary',
          kind: 'shadow_sentence',
          engine: 'provider',
          text: 'Hello there.',
          path: join(dir, 'pron-primary.mp3'),
          hash: 'pron-primary-hash',
        },
        itemClips: [
          {
            id: 'pron-item-1',
            itemIndex: 0,
            kind: 'sentence_item',
            engine: 'provider',
            text: 'Hello',
            path: join(dir, 'pron-item-1.mp3'),
            hash: 'pron-item-hash',
          },
        ],
      })
      .mockResolvedValueOnce({
        mode: 'shadow_sentence',
        primaryClip: {
          id: 'pron-primary',
          kind: 'shadow_sentence',
          engine: 'provider',
          text: 'Hello there.',
          path: join(dir, 'pron-primary.mp3'),
          hash: 'pron-primary-hash',
        },
        itemClips: [
          {
            id: 'pron-item-1',
            itemIndex: 0,
            kind: 'sentence_item',
            engine: 'provider',
            text: 'Hello',
            path: join(dir, 'pron-item-1.mp3'),
            hash: 'pron-item-hash',
          },
        ],
      });

    const { newAssignment, rerunAssignment } = await import('../src/index.js');
    await newAssignment(
      {
        md: mdPath,
        preset: 'default',
        withTts: true,
        upload: 's3',
        voices: 'packages/orchestrator/configs/voices.yml',
        dryRun: false,
      },
      {},
      { runId: 'run-initial' },
    );

    vi.mocked(uploadFile).mockClear();
    vi.mocked(buildStudyTextMp3).mockClear();

    await rerunAssignment(
      {
        md: mdPath,
        regeneratePronunciationChunkAudio: true,
        upload: 's3',
        dryRun: false,
      },
      { runId: 'run-rerun' },
    );

    expect(buildStudyTextMp3).not.toHaveBeenCalled();

    const studyUploadCall = vi
      .mocked(uploadFile)
      .mock.calls.find((call) => call[1]?.key === 'audio/final/study-hash.mp3');
    const itemUploadCall = vi
      .mocked(uploadFile)
      .mock.calls.find((call) => call[1]?.key === 'audio/pronunciation-item/pron-item-hash.mp3');

    expect(studyUploadCall).toBeUndefined();
    expect(itemUploadCall?.[1]).toEqual(
      expect.objectContaining({
        skipIfExists: false,
      }),
    );
  }, 20_000);

  it('does not reuse a previous provider voice id when rerun chunk synthesis switches providers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-rerun-provider-switch-'));
    const mdPath = join(dir, 'assignment.md');
    const audioPath = join(dir, 'lesson.mp3');

    const markdown = await readFile(
      join(import.meta.dirname, '../../md-validator/fixtures/ok.md'),
      'utf8',
    );
    await writeFile(mdPath, markdown);
    await writeFile(audioPath, 'dummy audio');

    process.env.S3_BUCKET = 'observability-bucket';
    process.env.AWS_REGION = 'us-east-1';

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-core');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'study-hash',
      provider: 'elevenlabs',
      voices: [{ speaker: 'Anna', voiceId: 'pNInz6obpgDQGcFmaJgB', source: 'default' }],
    });
    vi.mocked(synthesizePronunciationAudio)
      .mockResolvedValueOnce({
        mode: 'shadow_sentence',
        primaryClip: {
          id: 'pron-primary',
          kind: 'shadow_sentence',
          engine: 'provider',
          text: 'Hello there.',
          path: join(dir, 'pron-primary.mp3'),
          hash: 'pron-primary-hash',
          voiceId: 'pNInz6obpgDQGcFmaJgB',
          tts: {
            provider: 'elevenlabs',
            modelId: 'eleven_flash_v2_5',
          },
        },
        itemClips: [
          {
            id: 'pron-item-1',
            itemIndex: 0,
            kind: 'sentence_item',
            engine: 'provider',
            text: 'pull',
            path: join(dir, 'pron-item-1.mp3'),
            hash: 'pron-item-hash',
            voiceId: 'pNInz6obpgDQGcFmaJgB',
            tts: {
              provider: 'elevenlabs',
              modelId: 'eleven_flash_v2_5',
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        mode: 'shadow_sentence',
        primaryClip: {
          id: 'pron-primary',
          kind: 'shadow_sentence',
          engine: 'provider',
          text: 'Hello there.',
          path: join(dir, 'pron-primary-rerun.mp3'),
          hash: 'pron-primary-rerun-hash',
          voiceId: 'en-US-Chirp3-HD-Achernar',
          tts: {
            provider: 'google',
            modelId: 'chirp3_hd',
          },
        },
        itemClips: [
          {
            id: 'pron-item-1',
            itemIndex: 0,
            kind: 'sentence_item',
            engine: 'provider',
            text: 'pull',
            path: join(dir, 'pron-item-rerun.mp3'),
            hash: 'pron-item-rerun-hash',
            voiceId: 'en-US-Chirp3-HD-Achernar',
            tts: {
              provider: 'google',
              modelId: 'chirp3_hd',
            },
          },
        ],
      });

    const { newAssignment, rerunAssignment } = await import('../src/index.js');
    await newAssignment(
      {
        md: mdPath,
        preset: 'default',
        withTts: true,
        upload: 's3',
        voices: 'packages/orchestrator/configs/voices.yml',
        dryRun: true,
        ttsProvider: 'elevenlabs',
      },
      {},
      { runId: 'run-initial' },
    );

    await rerunAssignment(
      {
        md: mdPath,
        regeneratePronunciationChunkAudio: true,
        upload: 's3',
        dryRun: true,
        pronunciationChunkTtsProvider: 'google',
        pronunciationChunkGoogleTtsModel: 'chirp3_hd',
      },
      { runId: 'run-rerun' },
    );

    const rerunInvocation = vi.mocked(synthesizePronunciationAudio).mock.calls[1]?.[0];
    expect(rerunInvocation).toEqual(
      expect.objectContaining({
        chunkTtsProvider: 'google',
        chunkGoogleTtsModel: 'chirp3_hd',
        chunkVoiceId: undefined,
      }),
    );
  }, 20_000);

  it('warns when rerun chunk provider metadata is missing and voice fallback becomes ambiguous', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-rerun-provider-warning-'));
    const mdPath = join(dir, 'assignment.md');
    const audioPath = join(dir, 'lesson.mp3');

    const markdown = await readFile(
      join(import.meta.dirname, '../../md-validator/fixtures/ok.md'),
      'utf8',
    );
    await writeFile(mdPath, markdown);
    await writeFile(audioPath, 'dummy audio');

    process.env.S3_BUCKET = 'observability-bucket';
    process.env.AWS_REGION = 'us-east-1';

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-core');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'study-hash',
      provider: 'elevenlabs',
      voices: [{ speaker: 'Anna', voiceId: 'voice_id_default', source: 'default' }],
    });
    vi.mocked(synthesizePronunciationAudio)
      .mockResolvedValueOnce({
        mode: 'shadow_sentence',
        primaryClip: {
          id: 'pron-primary',
          kind: 'shadow_sentence',
          engine: 'provider',
          text: 'Hello there.',
          path: join(dir, 'pron-primary.mp3'),
          hash: 'pron-primary-hash',
        },
        itemClips: [
          {
            id: 'pron-item-1',
            itemIndex: 0,
            kind: 'sentence_item',
            engine: 'provider',
            text: 'pull',
            path: join(dir, 'pron-item-1.mp3'),
            hash: 'pron-item-hash',
            voiceId: 'legacy-voice-without-provider',
            tts: {
              modelId: 'eleven_flash_v2_5',
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        mode: 'shadow_sentence',
        itemClips: [
          {
            id: 'pron-item-rerun-1',
            itemIndex: 0,
            kind: 'sentence_item',
            engine: 'provider',
            text: 'pull',
            path: join(dir, 'pron-item-rerun.mp3'),
            hash: 'pron-item-rerun-hash',
            voiceId: 'resolved-google-voice',
            tts: {
              provider: 'google',
              modelId: 'chirp3_hd',
            },
          },
        ],
      });

    const logs: PipelineLogEvent[] = [];
    const logger: PipelineLogger = { log: (event) => logs.push(event) };

    const { newAssignment, rerunAssignment } = await import('../src/index.js');
    await newAssignment(
      {
        md: mdPath,
        preset: 'default',
        withTts: true,
        upload: 's3',
        voices: 'packages/orchestrator/configs/voices.yml',
        dryRun: true,
        ttsProvider: 'elevenlabs',
      },
      {},
      { runId: 'run-initial' },
    );

    await rerunAssignment(
      {
        md: mdPath,
        regeneratePronunciationChunkAudio: true,
        upload: 's3',
        dryRun: true,
        pronunciationChunkTtsProvider: 'google',
        pronunciationChunkGoogleTtsModel: 'chirp3_hd',
      },
      { runId: 'run-rerun', logger },
    );

    const warnLog = logs.find(
      (entry) =>
        entry.message ===
        'Pronunciation chunk rerun could not confirm the previous clip provider; using provider-scoped fallback resolution instead.',
    );
    expect(warnLog).toBeDefined();
    expect(warnLog?.detail).toEqual(
      expect.objectContaining({
        code: 'rerun_pronunciation_chunk_unknown_previous_provider',
      }),
    );

    const ttsSuccessLog = logs.find((entry) => entry.message === 'stage.tts.success');
    expect(ttsSuccessLog?.detail).toEqual(
      expect.objectContaining({
        rerunWarnings: expect.arrayContaining([
          expect.objectContaining({
            code: 'rerun_pronunciation_chunk_unknown_previous_provider',
          }),
          expect.objectContaining({
            code: 'rerun_pronunciation_chunk_voice_unresolved',
          }),
        ]),
      }),
    );
  }, 20_000);
});
