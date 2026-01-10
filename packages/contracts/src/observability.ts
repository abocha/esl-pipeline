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

export const noopLogger: PipelineLogger = {
  log: () => {
    /* noop */
  },
};
