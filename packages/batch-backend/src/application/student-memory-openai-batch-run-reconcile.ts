import type { BatchBackendConfig } from '../config/env.js';
import {
  listStudentMemoryOpenAiBatchItems,
  markStudentMemoryOpenAiBatchItemOutcome,
  markStudentMemoryOpenAiBatchRunReconciled,
  recordStudentMemoryOpenAiBatchItemDiagnostics,
  recordStudentMemoryOpenAiBatchReconciliationAudit,
} from '../domain/student-memory-openai-batch-repository.js';
import { importValidatedStudentMemoryOpenAiBatchResult } from './student-memory-openai-batch-importer.js';
import { processStudentMemoryOpenAiBatchResults } from './student-memory-openai-batch-result-processing.js';
import { validateStudentMemoryOpenAiBatchResponse } from './student-memory-openai-batch-validation.js';

export async function reconcileStudentMemoryOpenAiBatchRun(args: {
  config: BatchBackendConfig;
  runId: string;
  runStatus: 'completed' | 'expired';
  outputJsonl: string;
  errorJsonl: string;
}): Promise<{
  imported: number;
  stale: number;
  retryableFailures: number;
  terminalFailures: number;
  protocolFailureCount: number;
}> {
  const items = await listStudentMemoryOpenAiBatchItems({ runId: args.runId });
  const byCustomId = new Map(items.map((item) => [item.customId, item]));
  const result = await processStudentMemoryOpenAiBatchResults({
    runStatus: args.runStatus,
    items: items.map((item) => ({ customId: item.customId, workload: item.workload })),
    outputJsonl: args.outputJsonl,
    errorJsonl: args.errorJsonl,
    validateAndImport: async ({ customId }, responseBody) => {
      const item = byCustomId.get(customId);
      if (!item) throw new Error('Batch result item disappeared during reconciliation');
      const validated = await validateStudentMemoryOpenAiBatchResponse({
        config: args.config.generation,
        item,
        response: responseBody,
      });
      const canonicalRecordId = await importValidatedStudentMemoryOpenAiBatchResult({
        item,
        content: validated.content,
      });
      return { canonicalRecordId, ...validated };
    },
  });

  for (const outcome of result.outcomes) {
    const item = byCustomId.get(outcome.customId);
    if (!item) continue;
    if (outcome.outcome === 'imported') {
      await recordStudentMemoryOpenAiBatchItemDiagnostics({
        itemId: item.id,
        providerRequestId: outcome.providerRequestId,
        returnedModel: outcome.returnedModel,
        finishReason: outcome.finishReason,
        usage: outcome.usage,
      });
      continue;
    }
    if (outcome.outcome === 'superseded_by_online') continue;
    await markStudentMemoryOpenAiBatchItemOutcome({
      itemId: item.id,
      state: outcome.outcome === 'stale' ? 'stale' : outcome.outcome,
      normalizedError: { reason: outcome.reason },
    });
  }

  await recordStudentMemoryOpenAiBatchReconciliationAudit({
    runId: args.runId,
    protocolFailures: result.protocolFailures,
  });

  await markStudentMemoryOpenAiBatchRunReconciled(args.runId);

  return {
    imported: result.outcomes.filter((outcome) => outcome.outcome === 'imported').length,
    stale: result.outcomes.filter((outcome) => outcome.outcome === 'stale').length,
    retryableFailures: result.outcomes.filter((outcome) => outcome.outcome === 'retryable_failure')
      .length,
    terminalFailures: result.outcomes.filter((outcome) => outcome.outcome === 'terminal_failure')
      .length,
    protocolFailureCount: result.protocolFailures.length,
  };
}
