import { fileURLToPath } from 'node:url';

import { loadCliEnv } from '@esl-pipeline/shared-infrastructure';

import { createAuditLogger } from './audit.js';
import { HttpBackendClient } from './backend-client.js';
import { loadBotConfigFromEnv } from './config.js';
import { TelegramOpsBotRunner } from './runner.js';
import { TelegramClient } from './telegram-client.js';
import { ForumTopicRouter } from './topic-router.js';

export async function startTelegramOpsBot(): Promise<void> {
  loadCliEnv({
    moduleUrl: import.meta.url,
    files: ['.env.batch-backend', '.env'],
    memoizeKey: 'telegram-ops-bot',
  });

  const config = loadBotConfigFromEnv();
  if (!config.enabled) {
    console.info('[telegram-ops-bot] TELEGRAM_OPS_BOT_ENABLED=false, skipping startup.');
    return;
  }

  const audit = createAuditLogger();
  const telegram = new TelegramClient({ token: config.token });
  const backend = new HttpBackendClient({
    baseUrl: config.backendBaseUrl,
    email: config.backendEmail,
    password: config.backendPassword,
    timeoutMs: config.backendTimeoutMs,
    sharedSecret: config.backendSharedSecret,
  });

  const topicRouter = new ForumTopicRouter({
    config,
    telegram,
    audit,
  });

  const runner = new TelegramOpsBotRunner({
    config,
    telegram,
    backend,
    topicRouter,
    audit,
  });

  const shutdown = () => {
    audit.log({
      level: 'info',
      event: 'telegram_bot_shutdown',
      message: 'Received shutdown signal',
      chatId: config.chatId,
    });
    runner.stop();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await runner.start();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void startTelegramOpsBot();
}
