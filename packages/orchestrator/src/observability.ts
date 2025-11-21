export type PipelineLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface PipelineLogEvent {
  level: PipelineLogLevel;
  message: string;
  runId?: string;
  stage?: string;
  detail?: Record<string, unknown>;
}

export interface PipelineLogger {
  log: (event: PipelineLogEvent) => void;
}

export interface PipelineMetrics {
  timing: (metric: string, durationMs: number, tags?: Record<string, string>) => void;
  increment: (metric: string, value?: number, tags?: Record<string, string>) => void;
}

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
