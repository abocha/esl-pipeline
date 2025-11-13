// packages/batch-backend/src/infrastructure/metrics.ts

// Minimal metrics facade used by the batch-backend and orchestrator wrapper.
// Default implementation is noop so the service runs without a metrics stack.
// Hook up Prometheus/statsd/etc by replacing the exported `metrics` in one place.

export interface MetricsTags {
  [key: string]: string | number | boolean | undefined;
}

export interface Metrics {
  increment(name: string, value?: number, tags?: MetricsTags): void;
  timing(name: string, ms: number, tags?: MetricsTags): void;
}

// metrics.declaration()
export const metrics: Metrics = {
  increment() {
    // Intentionally noop by default.
  },
  timing() {
    // Intentionally noop by default.
  },
};
