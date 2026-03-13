import { afterEach, describe, expect, it } from 'vitest';

import { loadBotConfigFromEnv } from '../src/config.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('bot config env parsing', () => {
  it('defaults bot mode to polling and telegram api base url to official endpoint', () => {
    delete process.env.TELEGRAM_OPS_BOT_MODE;
    delete process.env.TELEGRAM_OPS_BOT_API_BASE_URL;
    delete process.env.TELEGRAM_OPS_BOT_LEADER_ELECTION_ENABLED;
    delete process.env.TELEGRAM_OPS_BOT_WEBHOOK_HOST;
    delete process.env.TELEGRAM_OPS_BOT_WEBHOOK_PORT;
    delete process.env.TELEGRAM_OPS_BOT_WEBHOOK_PATH;
    delete process.env.TELEGRAM_OPS_BOT_WEBHOOK_SECRET_TOKEN;
    process.env.TELEGRAM_OPS_BOT_ENABLED = 'false';

    const cfg = loadBotConfigFromEnv();

    expect(cfg.mode).toBe('polling');
    expect(cfg.apiBaseUrl).toBe('https://api.telegram.org');
    expect(cfg.leaderElectionEnabled).toBe(false);
    expect(cfg.webhookHost).toBe('0.0.0.0');
    expect(cfg.webhookPort).toBe(8091);
    expect(cfg.webhookPath).toBe('/telegram/webhook');
    expect(cfg.webhookSecretToken).toBeUndefined();
  });

  it('accepts webhook mode and custom telegram api base url', () => {
    process.env.TELEGRAM_OPS_BOT_ENABLED = 'false';
    process.env.TELEGRAM_OPS_BOT_MODE = 'webhook';
    process.env.TELEGRAM_OPS_BOT_API_BASE_URL = 'https://telegram-proxy.example.com';
    process.env.TELEGRAM_OPS_BOT_LEADER_ELECTION_ENABLED = 'true';
    process.env.TELEGRAM_OPS_BOT_WEBHOOK_HOST = '127.0.0.1';
    process.env.TELEGRAM_OPS_BOT_WEBHOOK_PORT = '18091';
    process.env.TELEGRAM_OPS_BOT_WEBHOOK_PATH = 'bot/webhook';
    process.env.TELEGRAM_OPS_BOT_WEBHOOK_SECRET_TOKEN = 'secret-token';

    const cfg = loadBotConfigFromEnv();

    expect(cfg.mode).toBe('webhook');
    expect(cfg.apiBaseUrl).toBe('https://telegram-proxy.example.com');
    expect(cfg.leaderElectionEnabled).toBe(true);
    expect(cfg.webhookHost).toBe('127.0.0.1');
    expect(cfg.webhookPort).toBe(18091);
    expect(cfg.webhookPath).toBe('/bot/webhook');
    expect(cfg.webhookSecretToken).toBe('secret-token');
  });

  it('rejects unknown bot mode', () => {
    process.env.TELEGRAM_OPS_BOT_ENABLED = 'false';
    process.env.TELEGRAM_OPS_BOT_MODE = 'streaming';

    expect(() => loadBotConfigFromEnv()).toThrow(
      'TELEGRAM_OPS_BOT_MODE must be either "polling" or "webhook"',
    );
  });

  it('rejects invalid webhook port', () => {
    process.env.TELEGRAM_OPS_BOT_ENABLED = 'false';
    process.env.TELEGRAM_OPS_BOT_WEBHOOK_PORT = '70000';

    expect(() => loadBotConfigFromEnv()).toThrow(
      'TELEGRAM_OPS_BOT_WEBHOOK_PORT must be between 1 and 65535',
    );
  });

  it('rejects empty webhook path', () => {
    process.env.TELEGRAM_OPS_BOT_ENABLED = 'false';
    process.env.TELEGRAM_OPS_BOT_WEBHOOK_PATH = '   ';

    expect(() => loadBotConfigFromEnv()).toThrow('TELEGRAM_OPS_BOT_WEBHOOK_PATH cannot be empty');
  });
});
