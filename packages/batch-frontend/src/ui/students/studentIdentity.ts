export function getShortStudentId(studentId: string | null | undefined): string {
  const normalized = studentId?.trim();
  if (!normalized) return 'unknown';

  const uuidPrefix = normalized.match(
    /^([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  if (uuidPrefix) return uuidPrefix[1] ?? normalized.slice(0, 8);

  if (normalized.startsWith('student-')) {
    const suffix = normalized.slice('student-'.length);
    return suffix.length <= 8 ? suffix : suffix.slice(0, 8);
  }

  return normalized.length <= 8 ? normalized : normalized.slice(0, 8);
}

export function formatStudentShortId(studentId: string | null | undefined): string {
  return `Student ID: ${getShortStudentId(studentId)}`;
}
