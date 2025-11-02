export type PipelineLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type PipelineLogEvent = {
  level: PipelineLogLevel;
  message: string;
  runId?: string;
  stage?: string;
  detail?: Record<string, unknown>;
};

export type PipelineLogger = {
  log: (event: PipelineLogEvent) => void;
};

export type PipelineMetrics = {
  timing: (metric: string, durationMs: number, tags?: Record<string, string>) => void;
  increment: (metric: string, value?: number, tags?: Record<string, string>) => void;
};

export const noopLogger: PipelineLogger = {
  log: () => {
    /* noop */
  },
};

export const noopMetrics: PipelineMetrics = {
  timing: () => {
    /* noop */
  },
  increment: () => {
    /* noop */
  },
};
