import { noopLogger as sharedNoopLogger } from '@esl-pipeline/contracts';

export type {
  PipelineLogEvent,
  PipelineLogLevel,
  PipelineLogger,
} from '@esl-pipeline/contracts';

export interface PipelineMetrics {
  timing: (metric: string, durationMs: number, tags?: Record<string, string>) => void;
  increment: (metric: string, value?: number, tags?: Record<string, string>) => void;
}

export const noopLogger = sharedNoopLogger;

export const noopMetrics: PipelineMetrics = {
  timing: () => {
    /* noop */
  },
  increment: () => {
    /* noop */
  },
};
