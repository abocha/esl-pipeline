export type { PipelineLogEvent, PipelineLogger, PipelineLogLevel } from '@esl-pipeline/contracts';
export { noopLogger } from '@esl-pipeline/contracts';

export interface PipelineMetrics {
  timing: (metric: string, durationMs: number, tags?: Record<string, string>) => void;
  increment: (metric: string, value?: number, tags?: Record<string, string>) => void;
}

export const noopMetrics: PipelineMetrics = {
  timing: () => {
    /* noop */
  },
  increment: () => {
    /* noop */
  },
};
