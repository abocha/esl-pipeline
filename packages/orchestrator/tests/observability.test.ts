import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PipelineLogEvent, PipelineLogger, PipelineMetrics } from '../src/observability.js';

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

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-elevenlabs');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'abc123',
      voices: [{ speaker: 'Anna', voiceId: 'voice_id_default', source: 'default' }],
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
        voices: 'configs/voices.yml',
        dryRun: true,
      },
      {},
      { logger, metrics, runId: 'run-new' },
    );

    const expectedStages = [
      'validate',
      'import',
      'colorize',
      'tts',
      'upload',
      'add-audio',
      'manifest',
    ];
    for (const stage of expectedStages) {
      const start = logs.find((e) => e.message === `stage.${stage}.start`);
      const success = logs.find((e) => e.message === `stage.${stage}.success`);
      expect(start, `missing start for ${stage}`).toBeDefined();
      expect(success, `missing success for ${stage}`).toBeDefined();
    }

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
  }, 20_000);

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

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-elevenlabs');
    vi.mocked(buildStudyTextMp3).mockResolvedValue({
      path: audioPath,
      hash: 'abc123',
      voices: [{ speaker: 'Anna', voiceId: 'voice_id_default', source: 'default' }],
    });

    const { newAssignment, rerunAssignment } = await import('../src/index.js');
    await newAssignment(
      {
        md: mdPath,
        preset: 'default',
        withTts: true,
        upload: 's3',
        voices: 'configs/voices.yml',
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
        steps: ['upload', 'add-audio'],
        upload: 's3',
        dryRun: true,
      },
      { logger, metrics, runId: 'run-rerun' },
    );

    // Only upload/add-audio/manifest are executed; tts is skipped and should not emit start/success.
    const executedStages = ['upload', 'add-audio', 'manifest'];
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

    const stageTimings = timings.filter((t) => t.metric === 'esl.pipeline.stage.duration_ms');
    expect(stageTimings.map((t) => t.tags?.stage)).toEqual(expect.arrayContaining(executedStages));
    expect(
      timings.some(
        (t) =>
          t.metric === 'esl.pipeline.rerun_assignment.duration_ms' && t.tags?.result === 'success',
      ),
    ).toBe(true);

    const successCounters = increments.filter((i) => i.metric === 'esl.pipeline.stage.success');
    expect(successCounters.map((c) => c.tags?.stage)).toEqual(
      expect.arrayContaining(executedStages),
    );
  }, 20_000);
});
