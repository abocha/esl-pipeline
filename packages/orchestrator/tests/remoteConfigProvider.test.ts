import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RemoteConfigProvider } from '../src/adapters/config/remote.js';

function createHeaders(values: Record<string, string> = {}) {
  const normalized = new Map<string, string>();
  for (const [key, value] of Object.entries(values)) {
    normalized.set(key.toLowerCase(), value);
  }
  return {
    get(name: string) {
      return normalized.get(name.toLowerCase()) ?? null;
    },
  };
}

const createJsonResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: createHeaders(headers),
    json: async () => body,
  }) as Response;

const createTextResponse = (
  body: string,
  status = 200,
  headers: Record<string, string> = {},
) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: createHeaders(headers),
    text: async () => body,
  }) as Response;

describe('RemoteConfigProvider', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fetches presets and student profiles and reuses fresh cache entries', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({ 'b1-default': { h2: '#ff0000' } }))
      .mockResolvedValueOnce(createJsonResponse([{ student: 'Test Student' }]))
      .mockResolvedValueOnce(
        createTextResponse(
          `voices:\n  narrator: voice-id\n`,
          200,
          { ETag: '"voices-v1"' },
        ),
      );

    const provider = new RemoteConfigProvider({ baseUrl: 'https://config.test/', token: 'abc' });

    const presets = await provider.loadPresets();
    const presetsAgain = await provider.loadPresets();
    const students = await provider.loadStudentProfiles();
    const voicesPath = await provider.resolveVoicesPath();
    const voicesPathAgain = await provider.resolveVoicesPath();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://config.test/presets.json');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://config.test/students.json');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://config.test/voices.yml');

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer abc');

    expect(presets['b1-default']?.h2).toBe('#ff0000');
    expect(presetsAgain['b1-default']?.h2).toBe('#ff0000');
    expect(students[0]?.student).toBe('Test Student');
    expect(voicesPathAgain).toBe(voicesPath);
    expect(voicesPath).toMatch(/voices-.*\.yml$/);
    expect(existsSync(voicesPath!)).toBe(true);
    expect(readFileSync(voicesPath!, 'utf8')).toContain('narrator');
  });

  it('dedupes in-flight requests for the same resource', async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const provider = new RemoteConfigProvider({ baseUrl: 'https://config.test/' });

    const first = provider.loadPresets();
    const second = provider.loadPresets();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch?.(createJsonResponse({ alpha: { h2: '#00ff00' } }));

    await expect(first).resolves.toEqual({ alpha: { h2: '#00ff00' } });
    await expect(second).resolves.toEqual({ alpha: { h2: '#00ff00' } });
  });

  it('revalidates stale cache entries with conditional requests and handles 304', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse(
          { alpha: { h2: '#00ff00' } },
          200,
          { ETag: '"presets-v1"', 'Last-Modified': 'Tue, 10 Feb 2026 00:00:00 GMT' },
        ),
      )
      .mockResolvedValueOnce(createJsonResponse({}, 304));

    const provider = new RemoteConfigProvider({
      baseUrl: 'https://config.test/',
      cacheTtlMs: 10,
    });

    const first = await provider.loadPresets();
    vi.advanceTimersByTime(11);
    const second = await provider.loadPresets();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(secondHeaders['If-None-Match']).toBe('"presets-v1"');
    expect(secondHeaders['If-Modified-Since']).toBe('Tue, 10 Feb 2026 00:00:00 GMT');
    expect(second).toEqual(first);
  });

  it('serves stale cache on fetch errors within grace window', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({ alpha: { h2: '#00ff00' } }))
      .mockRejectedValueOnce(new Error('remote unavailable'))
      .mockRejectedValueOnce(new Error('remote unavailable'));

    const provider = new RemoteConfigProvider({
      baseUrl: 'https://config.test/',
      cacheTtlMs: 10,
      staleIfErrorMs: 30,
    });

    const first = await provider.loadPresets();

    vi.advanceTimersByTime(11);
    const stale = await provider.loadPresets();
    expect(stale).toEqual(first);

    vi.advanceTimersByTime(40);
    await expect(provider.loadPresets()).rejects.toThrow('remote unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reuses voices file path when revalidation returns 304', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(
        createTextResponse(`voices:\n  narrator: voice-id\n`, 200, { ETag: '"voices-v1"' }),
      )
      .mockResolvedValueOnce(createTextResponse('', 304));

    const provider = new RemoteConfigProvider({
      baseUrl: 'https://config.test/',
      cacheTtlMs: 10,
    });

    const firstPath = await provider.resolveVoicesPath();
    vi.advanceTimersByTime(11);
    const secondPath = await provider.resolveVoicesPath();

    expect(firstPath).toBe(secondPath);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(secondHeaders['If-None-Match']).toBe('"voices-v1"');
  });
});
