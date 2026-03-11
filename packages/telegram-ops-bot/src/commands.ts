import { readFile } from 'node:fs/promises';

import {
  formatActionQueued,
  formatActionStatus,
  formatAudioPlaybackLink,
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
  options?: {
    disableLinkPreview?: boolean;
  },
): Promise<void> {
  const threadId = context.topicRouter.resolveThreadId({
    domain,
    incomingThreadId: incomingThreadId(context),
  });
  await context.messenger.sendHtmlMessage({
    chatId: context.config.chatId,
    threadId,
    html,
    disableLinkPreview: options?.disableLinkPreview,
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

interface ResolvedSharePayload {
  studyTextAudioUrl: string | null;
  pronunciationAudioUrl: string | null;
  assignmentTitle: string | null;
  assignmentEmoji: string | null;
}

async function resolveSharePayloadForJob(context: CommandContext, mdOrHtmlSource: {
  md: string | null;
  htmlUrl?: string | null;
}): Promise<ResolvedSharePayload> {
  let markdown: string | null = mdOrHtmlSource.md;
  let html: string | null = null;

  if (markdown && looksLikeMarkdownFilePath(markdown)) {
    try {
      markdown = await readFile(markdown, 'utf8');
    } catch {
      // Ignore filesystem read errors; we'll try HTML fallback.
    }
  }

  let studyTextAudioUrl = extractLabeledMarkdownAudioUrl(markdown, 'Audio recording: Study Text');
  if (!studyTextAudioUrl) {
    studyTextAudioUrl = extractAudioUrlByPathHint(markdown, '/audio/final/');
  }

  let pronunciationAudioUrl = extractLabeledMarkdownAudioUrl(
    markdown,
    'Audio recording: Pronunciation Shadow Sentence',
  );
  if (!pronunciationAudioUrl) {
    pronunciationAudioUrl = extractAudioUrlByPathHint(markdown, '/audio/pronunciation-shadow/');
  }

  const markdownTitle = extractAssignmentTitleFromMarkdown(markdown);
  const markdownEmoji = extractAssignmentEmojiFromMarkdown(markdown);
  if ((!studyTextAudioUrl || !pronunciationAudioUrl || !markdownTitle || !markdownEmoji) && mdOrHtmlSource.htmlUrl) {
    html = await fetchTextWithTimeout(mdOrHtmlSource.htmlUrl, context.config.backendTimeoutMs);
    if (html) {
      studyTextAudioUrl ??= extractAudioUrlByPathHint(html, '/audio/final/');
      pronunciationAudioUrl ??= extractAudioUrlByPathHint(html, '/audio/pronunciation-shadow/');
    }
  }
  const htmlTitle = extractAssignmentTitleFromHtml(html);
  const htmlEmoji = extractAssignmentEmojiFromHtml(html);
  const assignmentTitle = markdownTitle ?? htmlTitle ?? null;
  const assignmentEmoji = markdownEmoji ?? htmlEmoji ?? null;

  return {
    studyTextAudioUrl,
    pronunciationAudioUrl,
    assignmentTitle,
    assignmentEmoji,
  };
}

function looksLikeMarkdownFilePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().endsWith('.md')) return false;
  return trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../');
}

function extractLabeledMarkdownAudioUrl(markdown: string | null | undefined, label: string): string | null {
  if (!markdown) return null;
  const pattern = new RegExp(`\\[${escapeRegExp(label)}\\]\\((https?:\\/\\/[^\\s)]+)\\)`, 'i');
  const match = markdown.match(pattern);
  return match?.[1] ?? null;
}

function extractAudioUrlByPathHint(input: string | null | undefined, pathHint: string): string | null {
  if (!input) return null;
  const pattern = new RegExp(`(https?:\\/\\/\\S*${escapeRegExp(pathHint)}\\S*\\.mp3(?:\\?\\S*)?)`, 'i');
  const match = input.match(pattern);
  return match?.[1] ?? null;
}

function extractAssignmentTitleFromMarkdown(markdown: string | null | undefined): string | null {
  if (!markdown) return null;
  const frontmatterMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (frontmatterMatch?.[1]) {
    const titleMatch = frontmatterMatch[1].match(/^\s*title:\s*(.+)\s*$/im);
    if (titleMatch?.[1]) {
      const cleaned = cleanupTitleToken(titleMatch[1]);
      if (cleaned) return cleaned;
    }
  }

  const headingMatch = markdown.match(/^#\s+(.+)$/m);
  if (headingMatch?.[1]) {
    return cleanupTitleToken(headingMatch[1]);
  }
  return null;
}

function extractAssignmentEmojiFromMarkdown(markdown: string | null | undefined): string | null {
  if (!markdown) return null;
  const frontmatterMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatterMatch?.[1]) return null;
  const iconMatch = frontmatterMatch[1].match(/^\s*icon:\s*(.+)\s*$/im);
  if (!iconMatch?.[1]) return null;
  return cleanupIconToken(iconMatch[1]);
}

function extractAssignmentTitleFromHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch?.[1]) return null;
  const decoded = decodeHtmlEntities(titleMatch[1]);
  return cleanupTitleToken(decoded);
}

function extractAssignmentEmojiFromHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const iconMatch = html.match(
    /<div[^>]*class=["'][^"']*hero-emoji[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  );
  if (!iconMatch?.[1]) return null;
  const decoded = decodeHtmlEntities(stripTags(iconMatch[1]));
  return cleanupIconToken(decoded);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function cleanupTitleToken(value: string): string | null {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed) return null;
  return trimmed.replace(/^homework\s+ass+i?ignment\s*:\s*/i, '').trim() || null;
}

function cleanupIconToken(value: string): string | null {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed) return null;
  return trimmed;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const safeTimeoutMs = Math.max(1_000, Math.min(15_000, timeoutMs));
  const timer = setTimeout(() => controller.abort(), safeTimeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function sendShareableJobLinks(context: CommandContext, jobIdRaw: string | undefined): Promise<void> {
  const jobId = jobIdRaw?.trim();
  if (!jobId) {
    await sendDomainMessage(context, 'jobs', formatCommandError(`Usage: /${context.command} <jobId>`));
    return;
  }

  const job = await context.backend.getJob(jobId);
  const sharePayload = await resolveSharePayloadForJob(context, {
    md: job.md,
    htmlUrl: job.htmlUrl,
  });

  await sendDomainMessage(
    context,
    'jobs',
    formatJobLinks(job, context.config.appBaseUrl, {
      ...sharePayload,
      includeAudioLinks: false,
    }),
    {
      disableLinkPreview: true,
    },
  );

  if (sharePayload.studyTextAudioUrl) {
    await sendDomainMessage(
      context,
      'jobs',
      formatAudioPlaybackLink('🎧 Listen 1: Study Text', sharePayload.studyTextAudioUrl),
      {
        disableLinkPreview: false,
      },
    );
  }

  if (sharePayload.pronunciationAudioUrl) {
    await sendDomainMessage(
      context,
      'jobs',
      formatAudioPlaybackLink('🗣️ Listen 2: Pronunciation', sharePayload.pronunciationAudioUrl),
      {
        disableLinkPreview: false,
      },
    );
  }
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
      description: 'Show shareable links for one job (/links <jobId>)',
      domain: 'jobs',
      async execute(context) {
        await sendShareableJobLinks(context, context.args[0]);
      },
    },
    {
      command: 'share',
      description: 'Create student-shareable cards (/share <jobId>)',
      domain: 'jobs',
      async execute(context) {
        await sendShareableJobLinks(context, context.args[0]);
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
