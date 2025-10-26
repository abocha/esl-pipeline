export async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 5): Promise<T> {
  let delay = 350; // ms
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const status = e?.status ?? e?.code;
      const retryable =
        status === 429 || status === 503 || status === 'ECONNRESET' || status === 'ETIMEDOUT';
      if (!retryable || i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, delay + Math.floor(Math.random() * 120)));
      delay *= 2;
    }
  }
  // should never reach
  throw new Error(`withRetry(${label}) exhausted`);
}
