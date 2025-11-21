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
  fetchImplementation?: typeof fetch;
}

const DEFAULT_PRESETS_PATH = '/presets.json';
const DEFAULT_STUDENTS_PATH = '/students.json';
const DEFAULT_VOICES_PATH = '/voices.yml';

export class RemoteConfigProvider implements ConfigProvider {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly presetsPath: string;
  private readonly studentsPath: string;
  private readonly voicesPath: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private voicesTmpPath?: string;

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
    if (this.voicesTmpPath) return this.voicesTmpPath;

    const url = this.resolveUrl(this.voicesPath);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: this.buildHeaders({ accept: 'text/plain' }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch remote voices.yml (${response.status} ${response.statusText})`,
        );
      }
      const body = await response.text();
      const tmpPath = join(tmpdir(), `voices-${randomUUID()}.yml`);
      await writeFile(tmpPath, body, 'utf8');
      this.voicesTmpPath = tmpPath;
      return tmpPath;
    } finally {
      clearTimeout(timeout);
    }
  }

  private resolveUrl(path: string): string {
    return new URL(path, this.baseUrl).toString();
  }

  private async requestJson<T = unknown>(path: string): Promise<T | undefined> {
    const url = this.resolveUrl(path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: this.buildHeaders({ accept: 'application/json' }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch remote config (${response.status} ${response.statusText})`,
        );
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildHeaders(overrides?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = overrides ? { ...overrides } : {};
    if (!headers.Accept) {
      headers.Accept = 'application/json';
    }
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }
}
