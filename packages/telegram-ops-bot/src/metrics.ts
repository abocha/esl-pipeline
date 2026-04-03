import type { AuditLogger } from './types.js';

type MetricLabelValue = string | number | boolean | null | undefined;

function cleanLabels(
  labels: Record<string, MetricLabelValue> | undefined,
): Record<string, MetricLabelValue> {
  if (!labels) return {};
  const cleaned: Record<string, MetricLabelValue> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (value === undefined) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

export function emitBotMetricCounter(args: {
  audit: AuditLogger;
  metric: string;
  value?: number;
  labels?: Record<string, MetricLabelValue>;
}): void {
  args.audit.log({
    level: 'info',
    event: 'bot_metric',
    message: 'Bot metric emitted',
    details: {
      metric: args.metric,
      value: args.value ?? 1,
      labels: cleanLabels(args.labels),
    },
  });
}
