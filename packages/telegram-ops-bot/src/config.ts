import path from 'node:path';

import { readBool, readInt, readString } from '@esl-pipeline/shared-infrastructure';

import type { BotConfig } from './types.js';

function parseBotMode(raw: string | undefined): BotConfig['mode'] {
  const normalized = (raw ?? 'polling').trim().toLowerCase();
  if (normalized === 'polling' || normalized === 'webhook') {
    return normalized;
  }
  throw new Error('TELEGRAM_OPS_BOT_MODE must be either "polling" or "webhook"');
}

function parseWebhookPath(raw: string | undefined): string {
  const trimmed = (raw ?? '/telegram/webhook').trim();
  if (!trimmed) {
    throw new Error('TELEGRAM_OPS_BOT_WEBHOOK_PATH cannot be empty');
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function parseUserIds(raw: string): Set<number> {
  const result = new Set<number>();
  for (const token of raw.split(',')) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`Invalid TELEGRAM_OPS_BOT_ALLOWED_USER_IDS entry: ${trimmed}`);
    }
    result.add(parsed);
  }
  return result;
}

function parseOptionalThreadId(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('TELEGRAM_OPS_BOT_DEFAULT_THREAD_ID must be a positive integer when set');
  }
  return parsed;
}

export function loadBotConfigFromEnv(): BotConfig {
  const enabled = readBool('TELEGRAM_OPS_BOT_ENABLED', false);

  const token = readString('TELEGRAM_OPS_BOT_TOKEN', '') ?? '';
  const apiBaseUrl = readString('TELEGRAM_OPS_BOT_API_BASE_URL', 'https://api.telegram.org')!;
  const mode = parseBotMode(readString('TELEGRAM_OPS_BOT_MODE', 'polling'));
  const webhookHost = readString('TELEGRAM_OPS_BOT_WEBHOOK_HOST', '0.0.0.0')!;
  const webhookPort = readInt('TELEGRAM_OPS_BOT_WEBHOOK_PORT', 8091);
  const webhookPath = parseWebhookPath(readString('TELEGRAM_OPS_BOT_WEBHOOK_PATH'));
  const webhookSecretToken = readString('TELEGRAM_OPS_BOT_WEBHOOK_SECRET_TOKEN');
  const chatId = readString('TELEGRAM_OPS_BOT_CHAT_ID', '') ?? '';
  const backendBaseUrl = readString('TELEGRAM_OPS_BOT_BACKEND_URL', 'http://batch-backend:8080')!;
  const backendEmail = readString('TELEGRAM_OPS_BOT_BACKEND_EMAIL', '') ?? '';
  const backendPassword = readString('TELEGRAM_OPS_BOT_BACKEND_PASSWORD', '') ?? '';
  const backendTimeoutMs = readInt('TELEGRAM_OPS_BOT_BACKEND_TIMEOUT_MS', 15_000);
  const backendSharedSecret = readString('TELEGRAM_OPS_BOT_BACKEND_SHARED_SECRET');
  const leaderElectionEnabled = readBool('TELEGRAM_OPS_BOT_LEADER_ELECTION_ENABLED', false);

  const allowedUserIdsRaw = readString('TELEGRAM_OPS_BOT_ALLOWED_USER_IDS', '') ?? '';
  const allowedUserIds = parseUserIds(allowedUserIdsRaw);

  const pollIntervalMs = readInt('TELEGRAM_OPS_BOT_POLL_INTERVAL_MS', 1_500);
  const pollTimeoutSeconds = readInt('TELEGRAM_OPS_BOT_POLL_TIMEOUT_SECONDS', 20);
  const commandWindowMs = readInt('TELEGRAM_OPS_BOT_COMMAND_WINDOW_MS', 60_000);
  const maxCommandsPerWindow = readInt('TELEGRAM_OPS_BOT_MAX_COMMANDS_PER_WINDOW', 20);
  const enableActionCommands = readBool('TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS', false);
  const skipPendingUpdatesOnStartup = readBool(
    'TELEGRAM_OPS_BOT_SKIP_PENDING_UPDATES_ON_STARTUP',
    true,
  );

  const topicAutoCreate = readBool('TELEGRAM_OPS_BOT_TOPIC_AUTO_CREATE', true);
  const defaultThreadId = parseOptionalThreadId(readString('TELEGRAM_OPS_BOT_DEFAULT_THREAD_ID'));
  const topicsStateFile = path.resolve(
    readString(
      'TELEGRAM_OPS_BOT_TOPICS_STATE_FILE',
      path.join(process.cwd(), 'tmp/state/telegram-ops-topics.json'),
    )!,
  );

  const topicNames = {
    ops: readString('TELEGRAM_OPS_BOT_TOPIC_NAME_OPS', 'Ops Control')!,
    jobs: readString('TELEGRAM_OPS_BOT_TOPIC_NAME_JOBS', 'Jobs')!,
    alerts: readString('TELEGRAM_OPS_BOT_TOPIC_NAME_ALERTS', 'Alerts')!,
  };

  const appBaseUrl = readString('TELEGRAM_OPS_BOT_APP_BASE_URL');

  if (pollIntervalMs < 100 || pollIntervalMs > 60_000) {
    throw new Error('TELEGRAM_OPS_BOT_POLL_INTERVAL_MS must be between 100 and 60000');
  }
  if (pollTimeoutSeconds < 1 || pollTimeoutSeconds > 50) {
    throw new Error('TELEGRAM_OPS_BOT_POLL_TIMEOUT_SECONDS must be between 1 and 50');
  }
  if (commandWindowMs < 1000 || commandWindowMs > 3_600_000) {
    throw new Error('TELEGRAM_OPS_BOT_COMMAND_WINDOW_MS must be between 1000 and 3600000');
  }
  if (maxCommandsPerWindow < 1 || maxCommandsPerWindow > 500) {
    throw new Error('TELEGRAM_OPS_BOT_MAX_COMMANDS_PER_WINDOW must be between 1 and 500');
  }
  if (backendTimeoutMs < 1000 || backendTimeoutMs > 120_000) {
    throw new Error('TELEGRAM_OPS_BOT_BACKEND_TIMEOUT_MS must be between 1000 and 120000');
  }
  if (webhookPort < 1 || webhookPort > 65535) {
    throw new Error('TELEGRAM_OPS_BOT_WEBHOOK_PORT must be between 1 and 65535');
  }
  if (!webhookHost.trim()) {
    throw new Error('TELEGRAM_OPS_BOT_WEBHOOK_HOST cannot be empty');
  }

  if (enabled) {
    if (!token.trim()) {
      throw new Error('TELEGRAM_OPS_BOT_TOKEN is required when TELEGRAM_OPS_BOT_ENABLED=true');
    }
    if (!chatId.trim()) {
      throw new Error('TELEGRAM_OPS_BOT_CHAT_ID is required when TELEGRAM_OPS_BOT_ENABLED=true');
    }
    if (!backendEmail.trim() || !backendPassword.trim()) {
      throw new Error(
        'TELEGRAM_OPS_BOT_BACKEND_EMAIL and TELEGRAM_OPS_BOT_BACKEND_PASSWORD are required when TELEGRAM_OPS_BOT_ENABLED=true',
      );
    }
    if (allowedUserIds.size === 0) {
      throw new Error(
        'TELEGRAM_OPS_BOT_ALLOWED_USER_IDS must contain at least one numeric Telegram user id',
      );
    }
  }

  return {
    enabled,
    token,
    apiBaseUrl: apiBaseUrl.trim() || 'https://api.telegram.org',
    mode,
    webhookHost: webhookHost.trim(),
    webhookPort,
    webhookPath,
    webhookSecretToken: webhookSecretToken?.trim() ? webhookSecretToken : undefined,
    chatId,
    backendBaseUrl,
    backendEmail,
    backendPassword,
    backendTimeoutMs,
    backendSharedSecret: backendSharedSecret?.trim() ? backendSharedSecret : undefined,
    leaderElectionEnabled,
    allowedUserIds,
    pollIntervalMs,
    pollTimeoutSeconds,
    commandWindowMs,
    maxCommandsPerWindow,
    enableActionCommands,
    skipPendingUpdatesOnStartup,
    topicAutoCreate,
    defaultThreadId,
    topicsStateFile,
    topicNames,
    appBaseUrl: appBaseUrl?.trim() ? appBaseUrl : undefined,
  };
}
