import {
  formatActionQueued,
  formatActionStatus,
  formatCommandError,
  formatFinishedJobs,
  formatHelp,
  formatJobDetails,
  formatJobLinks,
  formatOpsStatus,
} from './formatter.js';
import type { CommandContext, CommandDefinition, ParsedCommand } from './types.js';

export interface CommandRegistry {
  commands: CommandDefinition[];
  resolve: (commandName: string) => CommandDefinition | undefined;
}

function incomingThreadId(context: CommandContext): number | undefined {
  const threadId = context.message.message_thread_id;
  if (typeof threadId === 'number' && Number.isInteger(threadId) && threadId > 0) {
    return threadId;
  }
  return undefined;
}

async function sendDomainMessage(
  context: CommandContext,
  domain: CommandDefinition['domain'],
  html: string,
): Promise<void> {
  const threadId = context.topicRouter.resolveThreadId({
    domain,
    incomingThreadId: incomingThreadId(context),
  });
  await context.messenger.sendHtmlMessage({
    chatId: context.config.chatId,
    threadId,
    html,
  });
}

async function guardActionCommandsEnabled(context: CommandContext): Promise<boolean> {
  if (context.config.enableActionCommands) {
    return true;
  }
  await sendDomainMessage(
    context,
    'ops',
    '<b>Action commands disabled</b>\n\nThis bot is running in read-only mode. Enable `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=true` to use `/backup` and `/drill`.',
  );
  return false;
}

export function createCommandRegistry(): CommandRegistry {
  const commands: CommandDefinition[] = [
    {
      command: 'help',
      description: 'Show available commands',
      domain: 'ops',
      async execute(context) {
        await sendDomainMessage(context, 'ops', formatHelp(commands));
      },
    },
    {
      command: 'status',
      description: 'Show machine status summary',
      domain: 'ops',
      async execute(context) {
        const status = await context.backend.getOpsStatus();
        await sendDomainMessage(context, 'ops', formatOpsStatus(status));
      },
    },
    {
      command: 'op',
      description: 'Show one operation status (/op <operationId>)',
      domain: 'ops',
      async execute(context) {
        const operationId = context.args[0]?.trim();
        if (!operationId) {
          await sendDomainMessage(context, 'ops', formatCommandError('Usage: /op <operationId>'));
          return;
        }
        const status = await context.backend.getOpsActionStatus(operationId);
        await sendDomainMessage(context, 'ops', formatActionStatus(status));
      },
    },
    {
      command: 'finished',
      description: 'List recently finished jobs (/finished [limit])',
      domain: 'jobs',
      async execute(context) {
        const requestedLimit = context.args[0] ? Number(context.args[0]) : 10;
        const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(20, requestedLimit)) : 10;
        const jobs = await context.backend.getFinishedJobs(limit);
        await sendDomainMessage(context, 'jobs', formatFinishedJobs(jobs));
      },
    },
    {
      command: 'job',
      description: 'Show one job status (/job <jobId>)',
      domain: 'jobs',
      async execute(context) {
        const jobId = context.args[0]?.trim();
        if (!jobId) {
          await sendDomainMessage(context, 'jobs', formatCommandError('Usage: /job <jobId>'));
          return;
        }
        const job = await context.backend.getJob(jobId);
        await sendDomainMessage(context, 'jobs', formatJobDetails(job));
      },
    },
    {
      command: 'links',
      description: 'Show links for one job (/links <jobId>)',
      domain: 'jobs',
      async execute(context) {
        const jobId = context.args[0]?.trim();
        if (!jobId) {
          await sendDomainMessage(context, 'jobs', formatCommandError('Usage: /links <jobId>'));
          return;
        }
        const job = await context.backend.getJob(jobId);
        await sendDomainMessage(context, 'jobs', formatJobLinks(job, context.config.appBaseUrl));
      },
    },
    {
      command: 'backup',
      description: 'Queue backup upload (/backup [label])',
      domain: 'ops',
      async execute(context) {
        if (!(await guardActionCommandsEnabled(context))) {
          return;
        }
        const label = context.args.join(' ').trim();
        const result = await context.backend.enqueueOpsAction({
          action: 'backup_upload',
          ...(label ? { label } : {}),
        });
        context.audit.log({
          level: 'info',
          event: 'ops_action_enqueued',
          message: 'Ops action queued from Telegram command',
          userId: context.fromUserId,
          chatId: context.config.chatId,
          threadId: incomingThreadId(context),
          command: context.command,
          commandArgs: context.args,
          operationId: result.operationId,
          details: {
            action: result.action,
          },
        });
        await sendDomainMessage(context, 'ops', formatActionQueued(result));
      },
    },
    {
      command: 'drill',
      description: 'Queue restore drill (download-only)',
      domain: 'ops',
      async execute(context) {
        if (!(await guardActionCommandsEnabled(context))) {
          return;
        }
        const result = await context.backend.enqueueOpsAction({
          action: 'restore_drill_download_only',
        });
        context.audit.log({
          level: 'info',
          event: 'ops_action_enqueued',
          message: 'Ops action queued from Telegram command',
          userId: context.fromUserId,
          chatId: context.config.chatId,
          threadId: incomingThreadId(context),
          command: context.command,
          commandArgs: context.args,
          operationId: result.operationId,
          details: {
            action: result.action,
          },
        });
        await sendDomainMessage(context, 'ops', formatActionQueued(result));
      },
    },
  ];

  const byCommand = new Map(commands.map((command) => [command.command, command]));

  return {
    commands,
    resolve(commandName: string) {
      return byCommand.get(commandName);
    },
  };
}

export function parseCommandText(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  const [commandToken = '', ...rest] = trimmed.split(/\s+/);
  const commandWithoutSlash = commandToken.slice(1);
  if (!commandWithoutSlash) return null;

  const [command, mention] = commandWithoutSlash.split('@', 2);
  if (!command) return null;

  return {
    command: command.toLowerCase(),
    args: rest,
    mentionedBot: mention ? mention.trim().toLowerCase() : null,
  };
}
