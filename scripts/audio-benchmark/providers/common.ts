import type { NativeSegment } from '../schema';
import { ProviderExecutionError } from './types';

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function toMilliseconds(value: unknown): number | undefined {
  const seconds = numberValue(value);
  return seconds === undefined ? undefined : Math.round(seconds * 1000);
}

export function jsonBody(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

export function parseJsonBody(body: string): unknown {
  return JSON.parse(body) as unknown;
}

export function parseSubmissionObject(body: string, providerName: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseJsonBody(body);
  } catch {
    throw new ProviderExecutionError(
      `${providerName} submission response was not valid JSON; the harness failed closed and recorded the external attempt.`,
      'uncertain',
      'submission_response_unparseable',
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProviderExecutionError(
      `${providerName} submission response had an unrecognized shape; the harness failed closed and recorded the external attempt.`,
      'uncertain',
      'submission_response_unparseable',
    );
  }
  return parsed as Record<string, unknown>;
}

export function requireArrayResponse(
  value: unknown,
  providerName: string,
  fieldName: string,
): unknown[] {
  if (!Array.isArray(value)) {
    throw new ProviderExecutionError(
      `${providerName} response did not contain the expected ${fieldName} array; the harness rejected the response shape.`,
      'failed',
      'response_schema',
    );
  }
  return value;
}

export async function recordExternalReference(
  input: {
    recordExternalReference?: (reference: {
      kind: 'file' | 'job' | 'transcription';
      id: string;
    }) => Promise<void>;
  },
  reference: { kind: 'file' | 'job' | 'transcription'; id: string },
): Promise<void> {
  await input.recordExternalReference?.(reference);
}

export function rawUsage(value: Record<string, unknown>): Record<string, unknown> {
  return value;
}

export function segment(input: Omit<NativeSegment, 'index'>, index: number): NativeSegment {
  return { index, ...input };
}
