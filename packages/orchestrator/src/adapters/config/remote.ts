import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';

import type { ConfigProvider, PresetMap, StudentProfile } from '../../config.js';

export interface RemoteConfigProviderOptions {
  baseUrl: string;
  token?: string;
  presetsPath?: string;
  studentsPath?: string;
  voicesPath?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  staleIfErrorMs?: number;
  conditionalRequests?: boolean;
  fetchImplementation?: typeof fetch;
}

const DEFAULT_PRESETS_PATH = '/presets.json';
const DEFAULT_STUDENTS_PATH = '/students.json';
const DEFAULT_VOICES_PATH = '/voices.yml';
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_STALE_IF_ERROR_MS = 300_000;

type CachedContentKind = 'json' | 'text';

interface CachedRemoteResponse {
  kind: CachedContentKind;
  value: unknown;
  fetchedAt: number;
  expiresAt: number;
  etag?: string;
  lastModified?: string;
}

export class RemoteConfigProvider implements ConfigProvider {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly presetsPath: string;
  private readonly studentsPath: string;
  private readonly voicesPath: string;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly staleIfErrorMs: number;
  private readonly conditionalRequests: boolean;
  private readonly fetchImpl: typeof fetch;
  private voicesTmpPath?: string;
  private voicesTmpContent?: string;
  private readonly responseCache = new Map<string, CachedRemoteResponse>();
  private readonly inflightRequests = new Map<string, Promise<unknown>>();

  constructor(options: RemoteConfigProviderOptions) {
    if (!options.baseUrl) {
      throw new Error('RemoteConfigProvider requires a baseUrl.');
    }

    this.baseUrl = options.baseUrl;
    this.token = options.token;
    this.presetsPath = options.presetsPath ?? DEFAULT_PRESETS_PATH;
    this.studentsPath = options.studentsPath ?? DEFAULT_STUDENTS_PATH;
    this.voicesPath = options.voicesPath ?? DEFAULT_VOICES_PATH;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.cacheTtlMs = normalizeDuration(options.cacheTtlMs, DEFAULT_CACHE_TTL_MS, 'cacheTtlMs');
    this.staleIfErrorMs = normalizeDuration(
      options.staleIfErrorMs,
      DEFAULT_STALE_IF_ERROR_MS,
      'staleIfErrorMs',
    );
    this.conditionalRequests = options.conditionalRequests ?? true;
    this.fetchImpl = options.fetchImplementation ?? globalThis.fetch;

    if (!this.fetchImpl) {
      throw new Error('RemoteConfigProvider requires a fetch implementation (Node 18+).');
    }
  }

  async loadPresets(): Promise<PresetMap> {
    const data = await this.requestJson<PresetMap>(this.presetsPath);
    return (data ?? {}) as PresetMap;
  }

  async loadStudentProfiles(): Promise<StudentProfile[]> {
    const data = await this.requestJson<StudentProfile[]>(this.studentsPath);
    return Array.isArray(data) ? data : [];
  }

  async resolveVoicesPath(voicesPath?: string, fallback?: string): Promise<string | undefined> {
    if (voicesPath) return voicesPath;
    if (fallback) return fallback;

    const body = await this.requestText(this.voicesPath, 'remote voices.yml');
    if (this.voicesTmpPath && this.voicesTmpContent === body) {
      return this.voicesTmpPath;
    }

    const tmpPath = join(tmpdir(), `voices-${randomUUID()}.yml`);
    await writeFile(tmpPath, body, 'utf8');
    this.voicesTmpPath = tmpPath;
    this.voicesTmpContent = body;
    return tmpPath;
  }

  private resolveUrl(path: string): string {
    return new URL(path, this.baseUrl).toString();
  }

  private async requestJson<T = unknown>(path: string): Promise<T | undefined> {
    return this.requestWithCache<T>({
      path,
      kind: 'json',
      accept: 'application/json',
      errorLabel: 'remote config',
      parse: async (response) => (await response.json()) as T,
    });
  }

  private async requestText(path: string, label: string): Promise<string> {
    return this.requestWithCache<string>({
      path,
      kind: 'text',
      accept: 'text/plain',
      errorLabel: label,
      parse: async (response) => response.text(),
    });
  }

  private async requestWithCache<T>(options: {
    path: string;
    kind: CachedContentKind;
    accept: string;
    errorLabel: string;
    parse: (response: Response) => Promise<T>;
  }): Promise<T> {
    const url = this.resolveUrl(options.path);
    const cacheKey = `${options.kind}:${url}`;
    const now = Date.now();
    const cached = this.responseCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.value as T;
    }

    const existing = this.inflightRequests.get(cacheKey);
    if (existing) {
      return (await existing) as T;
    }

    const pending = this.fetchAndCache(options, url, cacheKey, cached);
    this.inflightRequests.set(cacheKey, pending);
    try {
      return (await pending) as T;
    } finally {
      this.inflightRequests.delete(cacheKey);
    }
  }

  private async fetchAndCache<T>(
    options: {
      kind: CachedContentKind;
      accept: string;
      errorLabel: string;
      parse: (response: Response) => Promise<T>;
    },
    url: string,
    cacheKey: string,
    cached?: CachedRemoteResponse,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();

    try {
      const headers = this.buildHeaders({ accept: options.accept });
      if (this.conditionalRequests && cached) {
        if (cached.etag) {
          headers['If-None-Match'] = cached.etag;
        }
        if (cached.lastModified) {
          headers['If-Modified-Since'] = cached.lastModified;
        }
      }

      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (response.status === 304 && cached) {
        const now = Date.now();
        const reused = {
          ...cached,
          expiresAt: now + this.cacheTtlMs,
          etag: readResponseHeader(response, 'etag') ?? cached.etag,
          lastModified: readResponseHeader(response, 'last-modified') ?? cached.lastModified,
        };
        this.responseCache.set(cacheKey, reused);
        return cached.value as T;
      }

      if (!response.ok) {
        throw new Error(
          `Failed to fetch ${options.errorLabel} (${response.status} ${response.statusText})`,
        );
      }

      const value = await options.parse(response);
      const now = Date.now();
      this.responseCache.set(cacheKey, {
        kind: options.kind,
        value,
        fetchedAt: now,
        expiresAt: now + this.cacheTtlMs,
        etag: readResponseHeader(response, 'etag') ?? undefined,
        lastModified: readResponseHeader(response, 'last-modified') ?? undefined,
      });
      return value;
    } catch (error) {
      if (cached && this.isStaleCacheUsable(cached)) {
        this.responseCache.set(cacheKey, {
          ...cached,
          expiresAt: Date.now() + this.cacheTtlMs,
        });
        return cached.value as T;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private isStaleCacheUsable(cached: CachedRemoteResponse): boolean {
    if (this.staleIfErrorMs <= 0) {
      return false;
    }
    const maxStaleAgeMs = this.cacheTtlMs + this.staleIfErrorMs;
    const ageMs = Date.now() - cached.fetchedAt;
    return ageMs <= maxStaleAgeMs;
  }

  private buildHeaders(overrides?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = overrides ? { ...overrides } : {};
    if (headers.accept && !headers.Accept) {
      headers.Accept = headers.accept;
      delete headers.accept;
    }
    if (!headers.Accept) {
      headers.Accept = 'application/json';
    }
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }
}

function normalizeDuration(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new Error(`RemoteConfigProvider ${name} must be a non-negative number.`);
  }
  return resolved;
}

function readResponseHeader(response: Response, key: string): string | null {
  const headers = response.headers as unknown;
  if (!headers) return null;

  if (typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as { get: (name: string) => string | null }).get(key);
  }

  const normalizedKey = key.toLowerCase();
  const record = headers as Record<string, string | undefined>;
  return record[normalizedKey] ?? record[key] ?? null;
}
