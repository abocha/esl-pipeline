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
}

export class AnytypeClient {
  private baseUrl: string;
  private token: string;
  private version: string;
  private fetchImpl: typeof fetch;

  constructor(options: AnytypeClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.token = options.auth;
    this.version = options.version ?? '2025-11-08';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(endpoint: string, method: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
      'Anytype-Version': this.version,
    };

    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await safeReadText(response);
      const suffix = detail ? ` - ${detail}` : '';
      throw new Error(`Anytype API Error: ${response.status} ${response.statusText}${suffix}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  public async listSpaces(): Promise<AnytypeSpace[]> {
    return this.request<AnytypeSpace[]>('/spaces', 'GET');
  }

  public async createObject(spaceId: string, data: AnytypeCreateObjectPayload): Promise<AnytypeObject> {
    return this.request<AnytypeObject>(`/spaces/${encodeURIComponent(spaceId)}/objects`, 'POST', data);
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
