const runningJobControllers = new Map<string, AbortController>();

export function registerRunningJob(jobId: string, controller: AbortController): void {
  runningJobControllers.set(jobId, controller);
}

export function unregisterRunningJob(jobId: string): void {
  runningJobControllers.delete(jobId);
}

export function abortRunningJob(jobId: string, reason?: string): boolean {
  const controller = runningJobControllers.get(jobId);
  if (!controller) return false;

  if (controller.signal.aborted) {
    runningJobControllers.delete(jobId);
    return true;
  }

  const trimmedReason = reason?.trim();
  controller.abort(trimmedReason && trimmedReason.length > 0 ? trimmedReason : undefined);
  runningJobControllers.delete(jobId);
  return true;
}

export function isJobRunning(jobId: string): boolean {
  return runningJobControllers.has(jobId);
}
