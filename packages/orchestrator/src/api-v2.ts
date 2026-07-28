import {
  ConfigurationError,
  InfrastructureError,
  ManifestError,
  ValidationError,
} from '@esl-pipeline/contracts';

import type {
  AssignmentProgressCallbacks,
  AssignmentProgressEvent,
  AssignmentStageEventV2,
  AssignmentStatus,
  NewAssignmentResult,
  OrchestratorApiResultV2,
  OrchestratorErrorCategory,
  OrchestratorErrorV2,
  OrchestratorOperation,
  OrchestratorV2ExecutionContext,
  RerunAssignmentResult,
  RerunPlanResult,
} from './types.js';

function isCancelledErrorLike(error: unknown): error is Error & { stage?: string; code?: string } {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return (
    error.name === 'PipelineCancelledError' ||
    code === 'PIPELINE_CANCELLED' ||
    error.name === 'TtsSynthesisCancelledError' ||
    code === 'TTS_SYNTHESIS_CANCELLED' ||
    error.message.toLowerCase() === 'cancelled' ||
    error.message.toLowerCase().startsWith('cancelled:')
  );
}

function toErrorCode(category: OrchestratorErrorCategory): string {
  switch (category) {
    case 'cancelled': {
      return 'PIPELINE_CANCELLED';
    }
    case 'validation': {
      return 'VALIDATION_ERROR';
    }
    case 'configuration': {
      return 'CONFIGURATION_ERROR';
    }
    case 'manifest': {
      return 'MANIFEST_ERROR';
    }
    case 'infrastructure': {
      return 'INFRASTRUCTURE_ERROR';
    }
    default: {
      return 'UNKNOWN_ERROR';
    }
  }
}

function retryableByCategory(category: OrchestratorErrorCategory): boolean {
  return category === 'infrastructure' || category === 'unknown';
}

export function categorizeOrchestratorError(
  operation: OrchestratorOperation,
  error: unknown,
): OrchestratorErrorV2 {
  let category: OrchestratorErrorCategory = 'unknown';

  if (isCancelledErrorLike(error)) {
    category = 'cancelled';
  } else if (error instanceof ValidationError) {
    category = 'validation';
  } else if (error instanceof ConfigurationError) {
    category = 'configuration';
  } else if (error instanceof ManifestError) {
    category = 'manifest';
  } else if (error instanceof InfrastructureError) {
    category = 'infrastructure';
  }

  const message = error instanceof Error ? error.message : String(error);
  const stage =
    error instanceof Error && 'stage' in error && typeof error.stage === 'string'
      ? error.stage
      : undefined;
  const causeName = error instanceof Error ? error.name : undefined;

  return {
    schemaVersion: 'v2',
    operation,
    category,
    code: toErrorCode(category),
    message,
    retryable: retryableByCategory(category),
    stage: stage as OrchestratorErrorV2['stage'],
    causeName,
  };
}

export function toStageEventV2(
  operation: OrchestratorOperation,
  event: AssignmentProgressEvent,
  runId?: string,
): AssignmentStageEventV2 {
  return {
    schemaVersion: 'v2',
    source: 'orchestrator',
    operation,
    emittedAt: new Date().toISOString(),
    runId,
    stage: event.stage,
    status: event.status,
    detail: event.detail,
  };
}

export function createProgressCallbacksFromV2Context(
  operation: OrchestratorOperation,
  context: OrchestratorV2ExecutionContext,
): AssignmentProgressCallbacks {
  const onStageEvent = context.onStageEvent;
  if (!onStageEvent) return {};
  const runId = context.dependencies?.runId;
  return {
    onStage(event) {
      onStageEvent(toStageEventV2(operation, event, runId));
    },
  };
}

export function successResultV2<T>(
  operation: OrchestratorOperation,
  data: T,
): OrchestratorApiResultV2<T> {
  return {
    ok: true,
    schemaVersion: 'v2',
    operation,
    data,
  };
}

export function failureResultV2<T>(
  operation: OrchestratorOperation,
  error: unknown,
): OrchestratorApiResultV2<T> {
  return {
    ok: false,
    schemaVersion: 'v2',
    operation,
    error: categorizeOrchestratorError(operation, error),
  };
}

export function unwrapOrThrowV2Result<T>(result: OrchestratorApiResultV2<T>): T {
  if (result.ok) return result.data;

  const err = new Error(result.error.message);
  err.name = result.error.code;
  (err as { code?: string }).code = result.error.code;
  (err as { category?: string }).category = result.error.category;
  (err as { operation?: string }).operation = result.operation;
  throw err;
}

export type NewAssignmentOperationResultV2 = OrchestratorApiResultV2<NewAssignmentResult>;
export type RerunAssignmentOperationResultV2 = OrchestratorApiResultV2<RerunAssignmentResult>;
export type GetAssignmentStatusOperationResultV2 = OrchestratorApiResultV2<AssignmentStatus>;
export type PlanRerunAssignmentOperationResultV2 = OrchestratorApiResultV2<RerunPlanResult>;
