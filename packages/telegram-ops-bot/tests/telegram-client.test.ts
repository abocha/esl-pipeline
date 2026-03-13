import { describe, expect, it, vi } from 'vitest';

import { TelegramClient } from '../src/telegram-client.js';

describe('telegram client metadata methods', () => {
  it('serializes setMyCommands payloads correctly', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new TelegramClient({
      token: 'token',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await client.setMyCommands({
      scope: { type: 'all_private_chats' },
      commands: [{ command: 'start', description: 'Start here' }],
    });

    const firstCall = fetchImpl.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [url, init] = firstCall as unknown as [string, RequestInit];

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(url).toBe('https://api.telegram.org/bottoken/setMyCommands');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(String(init.body))).toEqual({
      scope: { type: 'all_private_chats' },
      commands: [{ command: 'start', description: 'Start here' }],
    });
  });

  it('serializes setChatMenuButton payloads correctly', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new TelegramClient({
      token: 'token',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await client.setChatMenuButton({
      menu_button: { type: 'commands' },
    });

    const firstCall = fetchImpl.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [, init] = firstCall as unknown as [string, RequestInit];

    expect(JSON.parse(String(init.body))).toEqual({
      menu_button: { type: 'commands' },
    });
  });
});
