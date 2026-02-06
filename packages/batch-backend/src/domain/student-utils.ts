import { createHash } from 'node:crypto';

const STUDENT_NAMESPACE = 'esl-pipeline-student';

export function normalizeStudentName(name: string): string {
  return name.trim().replaceAll(/\s+/g, ' ');
}

export function deriveStudentId(name: string): string {
  const normalized = normalizeStudentName(name).toLowerCase();
  if (!normalized) {
    throw new Error('Student name is required');
  }

  const hash = createHash('sha256').update(`${STUDENT_NAMESPACE}:${normalized}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  return formatUuid(bytes);
}

export function extractStudentNameFromPath(relativePath: string): string | null {
  if (!relativePath) return null;
  const segments = relativePath.split(/[/\\]+/).filter(Boolean);
  if (segments.length < 2) return null;
  const name = normalizeStudentName(segments[0] ?? '');
  return name.length > 0 ? name : null;
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
