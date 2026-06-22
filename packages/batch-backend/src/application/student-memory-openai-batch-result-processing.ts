import { reconcileStudentMemoryOpenAiBatchJsonl } from './student-memory-openai-batch-reconcile.js';

export type StudentMemoryOpenAiBatchItemOutcome =
  | 'imported'
  | 'stale'
  | 'superseded_by_online'
  | 'retryable_failure'
  | 'terminal_failure';

export async function processStudentMemoryOpenAiBatchResults(args: {
  runStatus: 'completed' | 'expired';
  items: Array<{ customId: string; workload: string }>;
  outputJsonl: string;
  errorJsonl: string;
  validateAndImport: (
    item: { customId: string; workload: string },
    responseBody: unknown,
    requestId?: string,
  ) => Promise<
    | string
    | {
        canonicalRecordId: string;
        providerRequestId?: string;
        returnedModel?: string;
        finishReason?: string;
        usage?: unknown;
      }
  >;
}): Promise<{
  outcomes: Array<{
    customId: string;
    outcome: StudentMemoryOpenAiBatchItemOutcome;
    reason: string;
    canonicalRecordId?: string;
    providerRequestId?: string;
    returnedModel?: string;
    finishReason?: string;
    usage?: unknown;
  }>;
  protocolFailures: ReturnType<typeof reconcileStudentMemoryOpenAiBatchJsonl>['failures'];
}> {
  const reconciled = reconcileStudentMemoryOpenAiBatchJsonl({
    expectedCustomIds: args.items.map((item) => item.customId),
    outputJsonl: args.outputJsonl,
    errorJsonl: args.errorJsonl,
  });
  const outcomes = [] as Array<{
    customId: string;
    outcome: StudentMemoryOpenAiBatchItemOutcome;
    reason: string;
    canonicalRecordId?: string;
  }>;

  for (const item of args.items) {
    const line = reconciled.linesByCustomId.get(item.customId);
    if (!line) {
      outcomes.push({
        customId: item.customId,
        outcome: args.runStatus === 'expired' ? 'retryable_failure' : 'terminal_failure',
        reason: args.runStatus === 'expired' ? 'batch_expired' : 'missing_result',
      });
      continue;
    }
    if (line.kind === 'error' || line.statusCode < 200 || line.statusCode >= 300) {
      outcomes.push({
        customId: item.customId,
        outcome: 'retryable_failure',
        reason: 'provider_error',
      });
      continue;
    }
    try {
      const imported = await args.validateAndImport(item, line.body, line.requestId);
      const details = typeof imported === 'string' ? { canonicalRecordId: imported } : imported;
      outcomes.push({
        customId: item.customId,
        outcome: 'imported',
        reason: 'imported',
        canonicalRecordId: details.canonicalRecordId,
        ...(line.requestId
          ? { providerRequestId: line.requestId }
          : details.providerRequestId
            ? { providerRequestId: details.providerRequestId }
            : {}),
        ...(details.returnedModel ? { returnedModel: details.returnedModel } : {}),
        ...(details.finishReason ? { finishReason: details.finishReason } : {}),
        ...(details.usage !== undefined ? { usage: details.usage } : {}),
      });
    } catch (error) {
      outcomes.push({
        customId: item.customId,
        outcome:
          error instanceof Error && error.name === 'StudentMemoryOpenAiBatchStaleSourceError'
            ? 'stale'
            : error instanceof Error &&
                error.name === 'StudentMemoryOpenAiBatchIneligibleClaimError'
              ? 'superseded_by_online'
              : 'terminal_failure',
        reason:
          error instanceof Error && error.name === 'StudentMemoryOpenAiBatchStaleSourceError'
            ? 'source_stale'
            : error instanceof Error &&
                error.name === 'StudentMemoryOpenAiBatchIneligibleClaimError'
              ? 'superseded_by_online'
              : 'validation_failed',
      });
    }
  }

  return { outcomes, protocolFailures: reconciled.failures };
}
