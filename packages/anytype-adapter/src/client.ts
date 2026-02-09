import { ConfigurationError } from '@esl-pipeline/contracts';

import type {
  AnytypeCreateObjectPayload,
  AnytypeObject,
  AnytypeSearchPayload,
  AnytypeSpace,
  AnytypeUpdateObjectPayload,
} from './types.js';

export interface AnytypeClientOptions {
  baseUrl?: string;
  auth: string;
  version?: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
}

export class AnytypeClient {
  private baseUrl: string;
  private token: string;
  private version: string;
  private fetchImpl: typeof fetch;
  private requestTimeoutMs: number;
  private maxAttempts: number;
  private retryBaseDelayMs: number;

  constructor(options: AnytypeClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.token = options.auth;
    this.version = options.version ?? '2025-11-08';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.maxAttempts = Math.max(1, (options.maxRetries ?? 2) + 1);
    this.retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? 250);
  }

  private async request<T>(endpoint: string, method: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
      'Anytype-Version': this.version,
    };

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      timeout.unref?.();

      try {
        const response = await this.fetchImpl(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const detail = await safeReadText(response);
          const suffix = detail ? ` - ${detail}` : '';
          const error = new Error(
            `Anytype API Error: ${response.status} ${response.statusText}${suffix}`,
          );

          if (attempt < this.maxAttempts && RETRYABLE_STATUS_CODES.has(response.status)) {
            lastError = error;
            await wait(this.getBackoffDelay(attempt));
            continue;
          }

          throw error;
        }

        if (response.status === 204) {
          return undefined as T;
        }

        return (await response.json()) as T;
      } catch (error) {
        if (attempt < this.maxAttempts && isRetryableTransportError(error)) {
          lastError = toError(error);
          await wait(this.getBackoffDelay(attempt));
          continue;
        }

        if (isRetryableTransportError(error)) {
          throw createAnytypeConnectionError(this.baseUrl, this.requestTimeoutMs, error);
        }

        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    if (lastError && isRetryableTransportError(lastError)) {
      throw createAnytypeConnectionError(this.baseUrl, this.requestTimeoutMs, lastError);
    }

    throw lastError ?? new Error('Anytype request failed after retries');
  }

  public async listSpaces(): Promise<AnytypeSpace[]> {
    return this.request<AnytypeSpace[]>('/spaces', 'GET');
  }

  public async createObject(
    spaceId: string,
    data: AnytypeCreateObjectPayload,
  ): Promise<AnytypeObject> {
    return this.request<AnytypeObject>(
      `/spaces/${encodeURIComponent(spaceId)}/objects`,
      'POST',
      data,
    );
  }

  public async getObject(spaceId: string, objectId: string): Promise<AnytypeObject> {
    return this.request<AnytypeObject>(
      `/spaces/${encodeURIComponent(spaceId)}/objects/${encodeURIComponent(objectId)}`,
      'GET',
    );
  }

  public async updateObject(
    spaceId: string,
    objectId: string,
    data: AnytypeUpdateObjectPayload,
  ): Promise<AnytypeObject> {
    return this.request<AnytypeObject>(
      `/spaces/${encodeURIComponent(spaceId)}/objects/${encodeURIComponent(objectId)}`,
      'PATCH',
      data,
    );
  }

  public async search(spaceId: string, payload: AnytypeSearchPayload): Promise<AnytypeObject[]> {
    return this.request<AnytypeObject[]>(
      `/spaces/${encodeURIComponent(spaceId)}/search`,
      'POST',
      payload,
    );
  }

  public async addObjectsToList(
    spaceId: string,
    listId: string,
    objectIds: string[],
  ): Promise<{ message?: string }> {
    return this.request<{ message?: string }>(
      `/spaces/${encodeURIComponent(spaceId)}/lists/${encodeURIComponent(listId)}/objects`,
      'POST',
      { object_ids: objectIds },
    );
  }

  public async globalSearch(query: string, limit = 10): Promise<AnytypeObject[]> {
    return this.request<AnytypeObject[]>('/search', 'POST', { query, limit });
  }

  private getBackoffDelay(attempt: number): number {
    return Math.min(this.retryBaseDelayMs * 2 ** (attempt - 1), 2_000);
  }
}

export function createAnytypeClient(): AnytypeClient {
  const token = process.env.ANYTYPE_TOKEN;
  if (!token) throw new ConfigurationError('ANYTYPE_TOKEN is required in environment');
  const baseUrl = process.env.ANYTYPE_API_URL;
  const version = process.env.ANYTYPE_API_VERSION;
  return new AnytypeClient({ auth: token, baseUrl, version });
}

function normalizeBaseUrl(baseUrl?: string): string {
  const fallback = 'http://localhost:31009/v1';
  if (!baseUrl) return fallback;
  return baseUrl.replace(/\/+$/, '');
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function isRetryableTransportError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const name = 'name' in error && typeof error.name === 'string' ? error.name.toLowerCase() : '';
  const message =
    'message' in error && typeof error.message === 'string' ? error.message.toLowerCase() : '';
  const causeCode = extractCauseCode(error);

  if (name === 'aborterror') {
    return true;
  }

  if (causeCode && RETRYABLE_NETWORK_CODES.has(causeCode)) {
    return true;
  }

  return RETRYABLE_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
}

function extractCauseCode(error: object): string | null {
  if (!('cause' in error)) return null;
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== 'object') return null;
  const code = (cause as { code?: unknown }).code;
  return typeof code === 'string' ? code.toLowerCase() : null;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

function createAnytypeConnectionError(
  baseUrl: string,
  timeoutMs: number,
  originalError: unknown,
): Error {
  const originalMessage =
    originalError instanceof Error ? originalError.message : String(originalError);

  const guidance = `Anytype server unreachable at ${baseUrl}. Ensure Anytype Desktop is running and the local API is available.`;
  const timeoutHint = `Request timeout: ${timeoutMs}ms.`;
  return new Error(`${guidance} ${timeoutHint} Original error: ${originalMessage}`);
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  'econnreset',
  'econnrefused',
  'etimedout',
  'enotfound',
  'eai_again',
  'und_err_socket',
  'und_err_connect_timeout',
  'und_err_headers_timeout',
  'und_err_body_timeout',
]);
const RETRYABLE_MESSAGE_PATTERNS = [
  'fetch failed',
  'terminated',
  'socket',
  'network',
  'timeout',
  'timed out',
  'aborted',
];
