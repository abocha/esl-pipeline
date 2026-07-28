export interface TtsRequestControl {
  signal?: AbortSignal;
  deadlineAtMs?: number;
}

export class TtsSynthesisCancelledError extends Error {
  readonly code = 'TTS_SYNTHESIS_CANCELLED';

  constructor(readonly reason?: unknown) {
    super('TTS synthesis cancelled');
    this.name = 'TtsSynthesisCancelledError';
  }
}

export function throwIfTtsCancelled(
  control: TtsRequestControl,
  now: () => number = Date.now,
): void {
  if (control.signal?.aborted) {
    throw new TtsSynthesisCancelledError(control.signal.reason);
  }
  if (control.deadlineAtMs !== undefined && control.deadlineAtMs <= now()) {
    throw new TtsSynthesisCancelledError('deadline_expired');
  }
}
