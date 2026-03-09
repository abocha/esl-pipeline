import { describe, expect, it } from 'vitest';

import type { PipelineLogEvent, PipelineLogger, PipelineMetrics } from '../src/observability.js';
import { createStageReporter } from '../src/runtime/stage-reporter.js';

describe('runtime/stage-reporter', () => {
  it('emits stage lifecycle logs, callbacks, and metrics for success', () => {
    const logs: PipelineLogEvent[] = [];
    const callbacks: Array<Record<string, unknown>> = [];
    const timings: Array<{ metric: string; durationMs: number; tags?: Record<string, string> }> = [];
    const increments: Array<{ metric: string; value?: number; tags?: Record<string, string> }> = [];

    const logger: PipelineLogger = {
      log: (event) => logs.push(event),
    };

    const metrics: PipelineMetrics = {
      timing: (metric, durationMs, tags) => timings.push({ metric, durationMs, tags }),
      increment: (metric, value, tags) => increments.push({ metric, value, tags }),
    };

    const reporter = createStageReporter({
      callbacks: {
        onStage: (event) => callbacks.push(event as unknown as Record<string, unknown>),
      },
      logger,
      metrics,
      runId: 'run-stage-test',
    });

    reporter.emitStage('validate', 'start', { check: true });
    reporter.emitStage('validate', 'success', { check: true });

    expect(callbacks).toHaveLength(2);
    expect(logs.map((event) => event.message)).toEqual([
      'stage.validate.start',
      'stage.validate.success',
    ]);
    expect(timings).toHaveLength(1);
    expect(timings[0]?.metric).toBe('esl.pipeline.stage.duration_ms');
    expect(timings[0]?.tags).toEqual({ stage: 'validate', status: 'success' });
    expect(increments).toEqual([
      {
        metric: 'esl.pipeline.stage.success',
        value: 1,
        tags: { stage: 'validate' },
      },
    ]);
  });

  it('records skipped stages through recordSkip helper', () => {
    const logs: PipelineLogEvent[] = [];
    const increments: Array<{ metric: string; value?: number; tags?: Record<string, string> }> = [];

    const logger: PipelineLogger = {
      log: (event) => logs.push(event),
    };

    const metrics: PipelineMetrics = {
      timing: () => {
        // noop
      },
      increment: (metric, value, tags) => increments.push({ metric, value, tags }),
    };

    const reporter = createStageReporter({
      logger,
      metrics,
      runId: 'run-stage-skip-test',
    });

    reporter.recordSkip('upload', 'upload disabled');

    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toBe('stage.upload.skipped');
    expect(logs[0]?.detail).toEqual({ reason: 'upload disabled' });
    expect(increments).toEqual([
      {
        metric: 'esl.pipeline.stage.skipped',
        value: 1,
        tags: { stage: 'upload' },
      },
    ]);
  });
});
