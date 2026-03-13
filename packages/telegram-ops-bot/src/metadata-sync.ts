import type { TelegramClient } from './telegram-client.js';
import { getAdvertisedCommands, type CommandRegistry } from './commands.js';
import type { AuditLogger, BotConfig } from './types.js';

const SHORT_DESCRIPTION = 'Internal ESL Pipeline ops bot.';
const DESCRIPTION =
  'Internal ESL Pipeline ops bot for allowlisted operators. Use private chat for onboarding and the configured ops chat for command execution.';

export async function syncTelegramMetadataBestEffort(args: {
  telegram: TelegramClient;
  config: BotConfig;
  audit: AuditLogger;
  registry: CommandRegistry;
}): Promise<void> {
  const privateCommands = getAdvertisedCommands(
    args.registry.commands,
    args.config,
    'private_onboarding',
  ).map((command) => ({
    command: command.command,
    description: command.description,
  }));

  const opsCommands = getAdvertisedCommands(args.registry.commands, args.config, 'ops_chat').map(
    (command) => ({
      command: command.command,
      description: command.description,
    }),
  );

  const steps: Array<{
    name: string;
    run: () => Promise<unknown>;
  }> = [
    {
      name: 'set_my_commands_private',
      run: () =>
        args.telegram.setMyCommands({
          scope: { type: 'all_private_chats' },
          commands: privateCommands,
        }),
    },
    {
      name: 'set_my_commands_ops_chat',
      run: () =>
        args.telegram.setMyCommands({
          scope: { type: 'chat', chat_id: args.config.chatId },
          commands: opsCommands,
        }),
    },
    {
      name: 'set_my_short_description',
      run: () =>
        args.telegram.setMyShortDescription({
          short_description: SHORT_DESCRIPTION,
        }),
    },
    {
      name: 'set_my_description',
      run: () =>
        args.telegram.setMyDescription({
          description: DESCRIPTION,
        }),
    },
    {
      name: 'set_chat_menu_button',
      run: () =>
        args.telegram.setChatMenuButton({
          menu_button: {
            type: 'commands',
          },
        }),
    },
  ];

  for (const step of steps) {
    try {
      await step.run();
      args.audit.log({
        level: 'info',
        event: 'telegram_metadata_sync_succeeded',
        message: 'Telegram metadata sync step succeeded',
        chatId: args.config.chatId,
        details: {
          step: step.name,
        },
      });
    } catch (error: unknown) {
      args.audit.log({
        level: 'warn',
        event: 'telegram_metadata_sync_failed',
        message: 'Telegram metadata sync step failed; continuing startup',
        chatId: args.config.chatId,
        details: {
          step: step.name,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}
