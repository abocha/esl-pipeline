export async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 5): Promise<T> {
  let delay = 350; // ms
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const status = (error as { status?: unknown })?.status ?? (error as { code?: unknown })?.code;
      const statusCode =
        typeof status === 'string' || typeof status === 'number' ? status : undefined;
      const retryable =
        statusCode === 429 ||
        statusCode === 503 ||
        statusCode === 'ECONNRESET' ||
        statusCode === 'ETIMEDOUT';
      if (!retryable || i === tries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay + Math.floor(Math.random() * 120)));
      delay *= 2;
    }
  }
  // should never reach
  throw new Error(`withRetry(${label}) exhausted`);
}
