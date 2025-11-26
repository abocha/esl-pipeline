import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RemoteConfigProvider } from '../src/adapters/config/remote.js';

const createResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: 'OK',
  json: async () => body,
});

describe('RemoteConfigProvider', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches presets and student profiles', async () => {
    fetchMock
      .mockResolvedValueOnce(createResponse({ 'b1-default': { h2: '#ff0000' } }))
      .mockResolvedValueOnce(createResponse([{ student: 'Test Student' }]))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => `voices:
  narrator: voice-id
`,
      });

    const provider = new RemoteConfigProvider({ baseUrl: 'https://config.test/', token: 'abc' });

    const presets = await provider.loadPresets();
    const students = await provider.loadStudentProfiles();
    const voicesUrl = await provider.resolveVoicesPath();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://config.test/presets.json');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://config.test/students.json');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://config.test/voices.yml');
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer abc');
    expect(presets['b1-default']?.h2).toBe('#ff0000');
    expect(students[0]?.student).toBe('Test Student');
    expect(voicesUrl).toMatch(/voices-.*\.yml$/);
    expect(existsSync(voicesUrl!)).toBe(true);
    expect(readFileSync(voicesUrl!, 'utf8')).toContain('narrator');
  });
});
