export type StudentMemoryOpenAiBatchResultLine =
  | {
      kind: 'response';
      customId: string;
      statusCode: number;
      requestId?: string;
      body: unknown;
    }
  | {
      kind: 'error';
      customId: string;
      error: unknown;
    };

export interface StudentMemoryOpenAiBatchReconcileFailure {
  reason: 'malformed_jsonl' | 'unknown_custom_id' | 'duplicate_custom_id' | 'missing_custom_id';
  customId?: string;
}

export function reconcileStudentMemoryOpenAiBatchJsonl(args: {
  expectedCustomIds: readonly string[];
  outputJsonl: string;
  errorJsonl: string;
}): {
  linesByCustomId: Map<string, StudentMemoryOpenAiBatchResultLine>;
  failures: StudentMemoryOpenAiBatchReconcileFailure[];
} {
  const expected = new Set(args.expectedCustomIds);
  const accepted = new Map<string, StudentMemoryOpenAiBatchResultLine>();
  const invalid = new Set<string>();
  const failures: StudentMemoryOpenAiBatchReconcileFailure[] = [];

  for (const rawLine of [...splitJsonl(args.outputJsonl), ...splitJsonl(args.errorJsonl)]) {
    const parsed = parseLine(rawLine);
    if (!parsed) {
      failures.push({ reason: 'malformed_jsonl' });
      continue;
    }
    const customId = parsed.custom_id;
    if (typeof customId !== 'string' || customId.trim().length === 0) {
      failures.push({ reason: 'missing_custom_id' });
      continue;
    }
    if (!expected.has(customId)) {
      failures.push({ reason: 'unknown_custom_id', customId });
      continue;
    }
    if (accepted.has(customId) || invalid.has(customId)) {
      accepted.delete(customId);
      invalid.add(customId);
      failures.push({ reason: 'duplicate_custom_id', customId });
      continue;
    }

    const line = normalizeLine(customId, parsed);
    if (!line) {
      failures.push({ reason: 'malformed_jsonl', customId });
      invalid.add(customId);
      continue;
    }
    accepted.set(customId, line);
  }

  return { linesByCustomId: accepted, failures };
}

function splitJsonl(input: string): string[] {
  return input
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseLine(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizeLine(
  customId: string,
  value: Record<string, unknown>,
): StudentMemoryOpenAiBatchResultLine | null {
  const response = value.response;
  if (response && typeof response === 'object') {
    const responseRecord = response as Record<string, unknown>;
    if (typeof responseRecord.status_code !== 'number' || !('body' in responseRecord)) {
      return null;
    }
    return {
      kind: 'response',
      customId,
      statusCode: responseRecord.status_code,
      ...(typeof responseRecord.request_id === 'string'
        ? { requestId: responseRecord.request_id }
        : {}),
      body: responseRecord.body,
    };
  }
  if ('error' in value) {
    return { kind: 'error', customId, error: value.error };
  }
  return null;
}
