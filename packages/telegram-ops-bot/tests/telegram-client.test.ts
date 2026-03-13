import { describe, expect, it, vi } from 'vitest';

import { TelegramClient } from '../src/telegram-client.js';

describe('telegram client', () => {
  it('uses configured api base url when calling methods', async () => {
    const urls: string[] = [];
    const fetchMock: typeof fetch = vi.fn(async (input) => {
      urls.push(String(input));
      return Response.json(
        {
          ok: true,
          result: [],
        },
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new TelegramClient({
      token: 'bot-token',
      apiBaseUrl: 'https://telegram-proxy.internal/',
      fetchImpl: fetchMock,
    });

    await client.getUpdates({
      timeout: 0,
    });

    expect(urls).toEqual(['https://telegram-proxy.internal/botbot-token/getUpdates']);
  });
});
