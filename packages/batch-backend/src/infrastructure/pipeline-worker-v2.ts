interface OrchestratorV2FailureEnvelope {
  message?: string;
  code?: string;
  causeName?: string;
  category?: string;
  stage?: string;
  retryable?: boolean;
}

export function toWorkerV2FailureError(
  failure: OrchestratorV2FailureEnvelope | undefined,
  fallbackMessage: string,
): Error {
  const message = failure?.message || fallbackMessage;
  const code = failure?.code;
  const causeName = failure?.causeName;

  const error = new Error(message);
  error.name = causeName || code || 'ORCHESTRATOR_V2_ERROR';

  if (code) {
    (error as { code?: string }).code = code;
  }
  if (causeName) {
    (error as { causeName?: string }).causeName = causeName;
  }
  if (failure?.category) {
    (error as { category?: string }).category = failure.category;
  }
  if (failure?.stage) {
    (error as { stage?: string }).stage = failure.stage;
  }
  if (typeof failure?.retryable === 'boolean') {
    (error as { retryable?: boolean }).retryable = failure.retryable;
  }

  return error;
}
