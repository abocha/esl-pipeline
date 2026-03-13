import { describe, expect, it, vi } from 'vitest';

import { TelegramClient } from '../src/telegram-client.js';

describe('telegram client metadata methods', () => {
  it('serializes setMyCommands payloads correctly', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ok: true, result: true }, {
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
      Response.json({ ok: true, result: true }, {
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

  it('serializes editMessageText and answerCallbackQuery payloads correctly', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ok: true, result: true }, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new TelegramClient({
      token: 'token',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await client.editHtmlMessage({
      chatId: '123',
      messageId: 42,
      html: '<b>Hello</b>',
      replyMarkup: {
        inline_keyboard: [[{ text: 'Status', callback_data: 'a4|s' }]],
      },
    });
    await client.answerCallbackQuery({
      callback_query_id: 'cb-1',
      text: 'Done',
    });

    const [, editInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const [, answerInit] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];

    expect(JSON.parse(String(editInit.body))).toEqual({
      chat_id: '123',
      message_id: 42,
      text: '<b>Hello</b>',
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: 'Status', callback_data: 'a4|s' }]],
      },
      link_preview_options: {
        is_disabled: true,
      },
    });
    expect(JSON.parse(String(answerInit.body))).toEqual({
      callback_query_id: 'cb-1',
      text: 'Done',
    });
  });
});
