import type { PipelineLogger, PipelineMetrics } from '../observability.js';
import type {
  AssignmentProgressCallbacks,
  AssignmentStage,
  AssignmentStageStatus,
} from '../types.js';

export interface StageReporterOptions {
  callbacks?: AssignmentProgressCallbacks;
  logger: PipelineLogger;
  metrics: PipelineMetrics;
  runId: string;
}

export interface StageReporter {
  emitStage: (
    stage: AssignmentStage,
    status: AssignmentStageStatus,
    detail?: Record<string, unknown>,
  ) => void;
  recordSkip: (stage: AssignmentStage, reason: string) => void;
}

export function createStageReporter(options: StageReporterOptions): StageReporter {
  const { callbacks, logger, metrics, runId } = options;
  const stageStartTimes = new Map<AssignmentStage, number>();

  const emitStage = (
    stage: AssignmentStage,
    status: AssignmentStageStatus,
    detail?: Record<string, unknown>,
  ): void => {
    callbacks?.onStage?.({ stage, status, detail });

    if (status === 'start') {
      stageStartTimes.set(stage, Date.now());
      logger.log({
        level: 'info',
        message: `stage.${stage}.start`,
        runId,
        stage,
        detail,
      });
      return;
    }

    const startedAt = stageStartTimes.get(stage);
    if (startedAt !== undefined) {
      stageStartTimes.delete(stage);
    }

    const durationMs = startedAt === undefined ? undefined : Math.max(Date.now() - startedAt, 0);
    const detailWithDuration = durationMs === undefined ? detail : { ...detail, durationMs };

    if (status === 'success') {
      logger.log({
        level: 'info',
        message: `stage.${stage}.success`,
        runId,
        stage,
        detail: detailWithDuration,
      });
      if (durationMs !== undefined) {
        metrics.timing('esl.pipeline.stage.duration_ms', durationMs, {
          stage,
          status,
        });
      }
      metrics.increment('esl.pipeline.stage.success', 1, { stage });
      return;
    }

    logger.log({
      level: 'warn',
      message: `stage.${stage}.skipped`,
      runId,
      stage,
      detail: detailWithDuration,
    });
    metrics.increment('esl.pipeline.stage.skipped', 1, { stage });
  };

  const recordSkip = (stage: AssignmentStage, reason: string): void => {
    emitStage(stage, 'skipped', { reason });
  };

  return {
    emitStage,
    recordSkip,
  };
}
