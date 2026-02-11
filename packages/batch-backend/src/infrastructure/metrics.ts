// packages/batch-backend/src/infrastructure/metrics.ts

// Minimal metrics facade used by the batch-backend and orchestrator wrapper.
// Default implementation is noop so the service runs without a metrics stack.
// Hook up Prometheus/statsd/etc by replacing the exported `metrics` in one place.
import type { ReadinessMetricSourceMap } from '@esl-pipeline/contracts';

export type MetricsTags = Record<string, string | number | boolean | undefined>;

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

// WS6-S1: readiness metric source map.
// This is intentionally explicit so weekly review metrics stay source-grounded.
export const READINESS_METRIC_SOURCE_MAP: ReadinessMetricSourceMap = {
  publishSuccessRate: {
    source: 'jobs table, terminal publish rows (state in succeeded|failed, publish_target present)',
    window: 'request window, default last 7 days by jobs.created_at',
    calculation: 'succeeded / (succeeded + failed)',
  },
  medianPublishLatencyMs: {
    source: 'jobs table, succeeded publish rows with finished_at',
    window: 'request window, default last 7 days by jobs.created_at',
    calculation: 'median of (finished_at - created_at) in milliseconds',
  },
  firstSessionSuccessProxy: {
    source: 'jobs table, first publish job per user inside request window',
    window: 'request window, default last 7 days by jobs.created_at',
    calculation: 'users whose first in-window publish job succeeded / users with an in-window publish job',
  },
  voiceValidationFailureRate: {
    source: 'jobs table failed rows with voice/frontmatter validation signatures in error text',
    window: 'request window, default last 7 days by jobs.created_at',
    calculation: 'voice validation failure count / failed jobs in window',
  },
  voiceStrictMismatchRate: {
    source: 'jobs table failed rows with strict mismatch signatures in error text',
    window: 'request window, default last 7 days by jobs.created_at',
    calculation: 'strict mismatch count / voice validation failures',
  },
  voiceFallbackRate: {
    source: 'tts voice selection telemetry (not yet persisted in jobs table)',
    window: 'request window, default last 7 days by jobs.created_at',
    calculation: 'fallback selections / total speaker selections (null until persisted)',
  },
  voiceProviderErrorRate: {
    source: 'jobs table failed rows tagged with provider error category',
    window: 'request window, default last 7 days by jobs.created_at',
    calculation: 'provider tagged failures / failed jobs in window',
  },
};
