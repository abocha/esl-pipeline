import { fileURLToPath } from 'node:url';

import { loadCliEnv } from '@esl-pipeline/shared-infrastructure';

import { PostgresApprovalReplayStore } from './approval-replay-store.js';
import { createAuditLogger } from './audit.js';
import { HttpBackendClient } from './backend-client.js';
import { createCommandRegistry } from './commands.js';
import { loadBotConfigFromEnv } from './config.js';
import { PostgresPollingLeaderElection } from './leader-election.js';
import { syncTelegramMetadataBestEffort } from './metadata-sync.js';
import { TelegramOpsBotRunner } from './runner.js';
import { TelegramClient } from './telegram-client.js';
import { ForumTopicRouter } from './topic-router.js';
import { type RunningWebhookUpdateServer, startWebhookUpdateServer } from './webhook-server.js';

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
  const telegram = new TelegramClient({
    token: config.token,
    apiBaseUrl: config.apiBaseUrl,
  });
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

  const leaderElection =
    config.mode === 'polling' && config.leaderElectionEnabled
      ? PostgresPollingLeaderElection.fromEnv(audit)
      : undefined;
  const approvalReplayStore = PostgresApprovalReplayStore.fromEnv(audit);
  const registry = createCommandRegistry({
    replayStore: approvalReplayStore,
  });

  await syncTelegramMetadataBestEffort({
    telegram,
    config,
    audit,
    registry,
  });

  const runner = new TelegramOpsBotRunner({
    config,
    telegram,
    backend,
    topicRouter,
    audit,
    leaderElection,
    approvalReplayStore,
  });

  let webhookServer: RunningWebhookUpdateServer | null = null;
  if (config.mode === 'webhook') {
    await runner.prepareForWebhookUpdates();
    webhookServer = await startWebhookUpdateServer({
      config,
      audit,
      onUpdate: async (update) => {
        await runner.handleWebhookUpdate(update);
      },
    });
  }

  const shutdown = () => {
    audit.log({
      level: 'info',
      event: 'telegram_bot_shutdown',
      message: 'Received shutdown signal',
      chatId: config.chatId,
    });
    runner.stop();
    if (webhookServer) {
      void webhookServer.close();
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await runner.start();
  } finally {
    if (webhookServer) {
      await webhookServer.close();
    }
    await approvalReplayStore.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void startTelegramOpsBot();
}
