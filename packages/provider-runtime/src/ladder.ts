export interface ProviderLadderAttemptContext<TCandidate> {
  candidate: TCandidate;
  retriesRemaining: number;
}

export interface ProviderLadderRetryContext<TCandidate, TMappedError> {
  candidate: TCandidate;
  retriesRemaining: number;
  backoffMs: number;
  mappedError: TMappedError;
}

export interface ProviderLadderFallbackContext<TCandidate, TMappedError> {
  candidate: TCandidate;
  mappedError: TMappedError;
}

export interface RunProviderFallbackLadderArgs<TCandidate, TResult, TMappedError> {
  candidates: readonly TCandidate[];
  runCandidate: (candidate: TCandidate) => Promise<TResult>;
  mapError: (candidate: TCandidate, error: unknown) => TMappedError;
  isTimeoutError: (mappedError: TMappedError) => boolean;
  isFailFastError: (mappedError: TMappedError) => boolean;
  getRetryMax: (candidate: TCandidate) => number;
  getRetryBackoffMs: (candidate: TCandidate) => number;
  sleep: (ms: number) => Promise<void>;
  onAttempt?: (context: ProviderLadderAttemptContext<TCandidate>) => void;
  onRetry?: (context: ProviderLadderRetryContext<TCandidate, TMappedError>) => void;
  onFallback?: (context: ProviderLadderFallbackContext<TCandidate, TMappedError>) => void;
}

export async function runProviderFallbackLadder<TCandidate, TResult, TMappedError>(
  args: RunProviderFallbackLadderArgs<TCandidate, TResult, TMappedError>,
): Promise<TResult> {
  let lastFallbackError: TMappedError | null = null;

  for (const candidate of args.candidates) {
    let retriesRemaining = Math.max(0, args.getRetryMax(candidate));

    while (true) {
      try {
        args.onAttempt?.({ candidate, retriesRemaining });
        return await args.runCandidate(candidate);
      } catch (error) {
        const mappedError = args.mapError(candidate, error);

        if (args.isTimeoutError(mappedError) && retriesRemaining > 0) {
          retriesRemaining -= 1;
          const backoffMs = Math.max(0, args.getRetryBackoffMs(candidate));
          args.onRetry?.({
            candidate,
            retriesRemaining,
            backoffMs,
            mappedError,
          });
          if (backoffMs > 0) {
            await args.sleep(backoffMs);
          }
          continue;
        }

        if (args.isFailFastError(mappedError)) {
          throw mappedError;
        }

        lastFallbackError = mappedError;
        args.onFallback?.({ candidate, mappedError });
        break;
      }
    }
  }

  if (lastFallbackError) {
    throw lastFallbackError;
  }

  throw new Error('Provider fallback ladder exhausted without a mapped fallback error.');
}
