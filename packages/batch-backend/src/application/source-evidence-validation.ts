import type { GenerationRequestEnvelopeV1 } from './generation-request-envelope.js';

interface EvidenceReference {
  sourceId?: unknown;
}

export class SourceEvidenceValidationError extends Error {
  readonly invalidSourceIds: string[];

  constructor(invalidSourceIds: string[]) {
    super(
      `Generated evidence references source IDs outside the request manifest: ${invalidSourceIds.join(', ')}`,
    );
    this.name = 'SourceEvidenceValidationError';
    this.invalidSourceIds = invalidSourceIds;
  }
}

/**
 * Consequential memory claims may cite only source blocks selected for this request.
 * Historical records without an envelope remain readable; new envelope-backed output is strict.
 */
export function assertEvidenceSourcesInEnvelope(
  content: unknown,
  envelope?: GenerationRequestEnvelopeV1,
): void {
  if (!envelope) return;

  const allowed = new Set(envelope.sourceManifest.map((source) => source.id));
  const referenced = collectEvidenceSourceIds(content);
  const invalid = [...new Set(referenced.filter((sourceId) => !allowed.has(sourceId)))];
  if (invalid.length > 0) {
    throw new SourceEvidenceValidationError(invalid);
  }
}

function collectEvidenceSourceIds(value: unknown): string[] {
  const output: string[] = [];
  visit(value, output);
  return output;
}

function visit(value: unknown, output: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, output);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  if (isEvidenceReference(record) && typeof record.sourceId === 'string') {
    output.push(record.sourceId);
  }
  for (const nested of Object.values(record)) visit(nested, output);
}

function isEvidenceReference(
  value: Record<string, unknown>,
): value is EvidenceReference & Record<string, unknown> {
  return (
    'sourceId' in value && ('quote' in value || 'observedForm' in value || 'observedIssue' in value)
  );
}
