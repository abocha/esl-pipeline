const MAX_RETRIES = Number(process.env.NOTION_COLORIZER_MAX_RETRIES ?? 5);
const INITIAL_DELAY_MS = Number(process.env.NOTION_COLORIZER_RETRY_DELAY_MS ?? 350);

export async function withRetry<T>(fn: () => Promise<T>, label: string, tries = MAX_RETRIES): Promise<T> {
  let delay = INITIAL_DELAY_MS;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.status ?? error?.code;
      const retryable =
        status === 429 ||
        status === 503 ||
        status === 'ECONNRESET' ||
        status === 'ETIMEDOUT' ||
        status === 'AbortError';

      if (!retryable || attempt === tries - 1) {
        throw error;
      }

      await new Promise(resolve => setTimeout(resolve, delay + Math.floor(Math.random() * 120)));
      delay *= 2;
    }
  }

  throw new Error(`withRetry(${label}) exhausted`);
}
