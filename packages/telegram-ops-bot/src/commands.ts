import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { JobListResponse, OpsActionListResponse, OpsActionRequest } from '@esl-pipeline/contracts';

import {
  type ApprovalReplayStore,
  InMemoryApprovalReplayStore,
} from './approval-replay-store.js';
import {
  formatActionQueued,
  formatActionStatus,
  formatAudioPlaybackLink,
  formatCommandError,
  formatFinishedJobs,
  formatHelp,
  formatGuidedHelpHome,
  formatGuidedActionConfirmation,
  formatGuidedActionSubmitted,
  formatHelpWithOptions,
  formatJobDetails,
  formatJobLinks,
  formatOpsStatus,
  formatPrivateOnboardingRedirect,
  formatRecentOpsActions,
  formatStartMessage,
} from './formatter.js';
import { encodeGuidedCallback } from './guided-callbacks.js';
import { emitBotMetricCounter } from './metrics.js';
import type {
  CommandContext,
  CommandDefinition,
  ParsedCommand,
  TelegramInlineKeyboardMarkup,
} from './types.js';

export interface CommandRegistry {
  commands: CommandDefinition[];
  resolve: (commandName: string) => CommandDefinition | undefined;
}

export type CommandAudience = 'private_onboarding' | 'ops_chat';

interface PendingAdvancedApproval {
  requestedAtMs: number;
  expiresAtMs: number;
  requestedByUserId: number;
  request: OpsActionRequest;
  sourceCommand: 'backup' | 'drill';
}

const ADVANCED_APPROVAL_TTL_MS = 10 * 60 * 1000;
const ADVANCED_APPROVAL_TOKEN_VERSION = 1;
const defaultApprovalReplayStore = new InMemoryApprovalReplayStore();

export function resetAdvancedControlApprovalsForTests(): void {
  defaultApprovalReplayStore.resetForTests();
}

function advancedControlsEnabled(context: CommandContext): boolean {
  return context.config.mode === 'webhook';
}

function advancedApprovalTokenSecret(context: CommandContext): string {
  return `${context.config.token}:${context.config.chatId}`;
}

function signApprovalTokenPayload(payloadSegment: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadSegment).digest('base64url');
}

function approvalTokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createApprovalToken(context: CommandContext, approval: PendingAdvancedApproval): string {
  const payload = {
    v: ADVANCED_APPROVAL_TOKEN_VERSION,
    n: randomUUID(),
    iat: approval.requestedAtMs,
    exp: approval.expiresAtMs,
    uid: approval.requestedByUserId,
    sourceCommand: approval.sourceCommand,
    action: approval.request.action,
    label: approval.request.label ?? null,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signApprovalTokenPayload(encodedPayload, advancedApprovalTokenSecret(context));
  return `${encodedPayload}.${signature}`;
}

function decodeApprovalToken(
  context: CommandContext,
  token: string,
  nowMs: number,
): PendingAdvancedApproval | null {
  const [encodedPayload, providedSignature, extra] = token.split('.');
  if (!encodedPayload || !providedSignature || extra) {
    return null;
  }

  const expectedSignature = signApprovalTokenPayload(
    encodedPayload,
    advancedApprovalTokenSecret(context),
  );
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const providedBuffer = Buffer.from(providedSignature, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) {
    return null;
  }
  if (!timingSafeEqual(expectedBuffer, providedBuffer)) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const obj = payload as Record<string, unknown>;
  if (obj.v !== ADVANCED_APPROVAL_TOKEN_VERSION) {
    return null;
  }
  if (typeof obj.iat !== 'number' || !Number.isFinite(obj.iat)) {
    return null;
  }
  if (typeof obj.exp !== 'number' || !Number.isFinite(obj.exp) || obj.exp <= nowMs) {
    return null;
  }
  if (typeof obj.uid !== 'number' || !Number.isInteger(obj.uid) || obj.uid <= 0) {
    return null;
  }
  if (obj.sourceCommand !== 'backup' && obj.sourceCommand !== 'drill') {
    return null;
  }

  const action = obj.action;
  if (action !== 'backup_upload' && action !== 'restore_drill_download_only') {
    return null;
  }
  if (
    (obj.sourceCommand === 'backup' && action !== 'backup_upload') ||
    (obj.sourceCommand === 'drill' && action !== 'restore_drill_download_only')
  ) {
    return null;
  }

  const rawLabel = obj.label;
  const label =
    typeof rawLabel === 'string' && rawLabel.trim().length > 0 ? rawLabel.trim() : undefined;

  return {
    requestedAtMs: obj.iat,
    expiresAtMs: obj.exp,
    requestedByUserId: obj.uid,
    sourceCommand: obj.sourceCommand,
    request: label ? { action, label } : { action },
  };
}

async function queueAdvancedApproval(
  context: CommandContext,
  sourceCommand: 'backup' | 'drill',
  request: OpsActionRequest,
): Promise<void> {
  const nowMs = Date.now();
  const approval: PendingAdvancedApproval = {
    requestedAtMs: nowMs,
    expiresAtMs: nowMs + ADVANCED_APPROVAL_TTL_MS,
    requestedByUserId: context.fromUserId,
    request,
    sourceCommand,
  };
  const token = createApprovalToken(context, approval);

  context.audit.log({
    level: 'info',
    event: 'advanced_control_approval_requested',
    message: 'Approval token created for high-risk action command',
    userId: context.fromUserId,
    chatId: context.config.chatId,
    threadId: incomingThreadId(context),
    command: context.command,
    commandArgs: context.args,
    details: {
      sourceCommand,
      token,
      expiresInMs: ADVANCED_APPROVAL_TTL_MS,
      action: request.action,
    },
  });

  await sendDomainMessage(
    context,
    'ops',
    [
      '<b>Approval required</b>',
      '',
      `Confirm <code>/${sourceCommand}</code> with <code>/approve ${token}</code>.`,
      'Token expires in 10 minutes.',
    ].join('\n'),
  );
}

async function approveAdvancedAction(
  context: CommandContext,
  tokenRaw: string | undefined,
  replayStore: ApprovalReplayStore,
): Promise<void> {
  if (!advancedControlsEnabled(context)) {
    await sendDomainMessage(
      context,
      'ops',
      formatCommandError(
        'Advanced controls are disabled. Set TELEGRAM_OPS_BOT_MODE=webhook to use /approve.',
      ),
    );
    return;
  }

  const token = tokenRaw?.trim();
  if (!token) {
    await sendDomainMessage(context, 'ops', formatCommandError('Usage: /approve <token>'));
    return;
  }

  const nowMs = Date.now();
  const pending = decodeApprovalToken(context, token, nowMs);
  if (!pending) {
    await sendDomainMessage(
      context,
      'ops',
      formatCommandError('Approval token not found or expired.'),
    );
    return;
  }

  if (pending.requestedByUserId !== context.fromUserId) {
    await sendDomainMessage(
      context,
      'ops',
      formatCommandError('Only the requesting operator can approve this action token.'),
    );
    return;
  }

  const tokenFingerprint = approvalTokenFingerprint(token);
  let reserveResult;
  try {
    reserveResult = await replayStore.reserveTokenUse({
      tokenFingerprint,
      nowMs,
      expiresAtMs: pending.expiresAtMs,
    });
  } catch (error: unknown) {
    context.audit.log({
      level: 'error',
      event: 'advanced_control_approval_replay_store_failed',
      message: 'Approval replay guard check failed',
      userId: context.fromUserId,
      chatId: context.config.chatId,
      threadId: incomingThreadId(context),
      command: context.command,
      commandArgs: context.args,
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
    await sendDomainMessage(
      context,
      'ops',
      formatCommandError('Approval verification unavailable. Please retry shortly.'),
    );
    return;
  }
  if (reserveResult === 'replayed') {
    await sendDomainMessage(context, 'ops', formatCommandError('Approval token has already been used.'));
    return;
  }

  const result = await (async () => {
    try {
      return await context.backend.enqueueOpsAction(pending.request);
    } catch (error: unknown) {
      context.audit.log({
        level: 'warn',
        event: 'advanced_control_approval_enqueue_ambiguous',
        message: 'Approval token left reserved after enqueue failure to avoid duplicate execution',
        userId: context.fromUserId,
        chatId: context.config.chatId,
        threadId: incomingThreadId(context),
        command: context.command,
        commandArgs: context.args,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw new Error(
        'Approval enqueue confirmation failed after token was consumed. Do not reuse this token; start a new request if action is still needed.',
      );
    }
  })();
  context.audit.log({
    level: 'info',
    event: 'advanced_control_approval_applied',
    message: 'Approved high-risk action command and enqueued action',
    userId: context.fromUserId,
    chatId: context.config.chatId,
    threadId: incomingThreadId(context),
    command: context.command,
    commandArgs: context.args,
    operationId: result.operationId,
    details: {
      sourceCommand: pending.sourceCommand,
      token,
      action: result.action,
    },
  });
  await sendDomainMessage(context, 'ops', formatActionQueued(result));
}

function incomingThreadId(context: CommandContext): number | undefined {
  const threadId = context.message.message_thread_id;
  if (typeof threadId === 'number' && Number.isInteger(threadId) && threadId > 0) {
    return threadId;
  }
  return undefined;
}

function replyChatId(context: CommandContext): string {
  return String(context.message.chat.id);
}

function isPrivateChatContext(context: CommandContext): boolean {
  return context.message.chat.type === 'private';
}

function visibleInOpsChat(command: CommandDefinition, config: CommandContext['config']): boolean {
  if (command.command === 'start') {
    return false;
  }
  if (command.command === 'backup' || command.command === 'drill') {
    return config.enableActionCommands;
  }
  if (command.command === 'approve') {
    return config.enableActionCommands && config.mode === 'webhook';
  }
  return true;
}

export function isPrivateOnboardingCommand(commandName: string): boolean {
  return commandName === 'start' || commandName === 'help';
}

export function getAdvertisedCommands(
  commands: CommandDefinition[],
  config: CommandContext['config'],
  audience: CommandAudience,
): CommandDefinition[] {
  if (audience === 'private_onboarding') {
    return commands.filter((command) => isPrivateOnboardingCommand(command.command));
  }

  return commands.filter((command) => visibleInOpsChat(command, config));
}

export function buildGuidedHomeKeyboard(config: CommandContext['config']): TelegramInlineKeyboardMarkup {
  const rows = [
    [
      { text: 'Status', callback_data: encodeGuidedCallback({ kind: 'status' }) },
      { text: 'Finished Jobs', callback_data: encodeGuidedCallback({ kind: 'finished' }) },
    ],
    [{ text: 'Recent Operations', callback_data: encodeGuidedCallback({ kind: 'recent_ops' }) }],
  ];

  if (config.enableActionCommands) {
    rows.push([
      { text: 'Backup', callback_data: encodeGuidedCallback({ kind: 'action', action: 'backup' }) },
      { text: 'Drill', callback_data: encodeGuidedCallback({ kind: 'action', action: 'drill' }) },
    ]);
  }

  return {
    inline_keyboard: rows,
  };
}

export function buildGuidedActionConfirmationKeyboard(
  action: 'backup' | 'drill',
): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: action === 'backup' ? 'Confirm Backup' : 'Confirm Drill',
          callback_data: encodeGuidedCallback({ kind: 'confirm', action }),
        },
      ],
      [{ text: 'Home', callback_data: encodeGuidedCallback({ kind: 'home' }) }],
    ],
  };
}

export function buildGuidedHomeOnlyKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: 'Home', callback_data: encodeGuidedCallback({ kind: 'home' }) }]],
  };
}

export function buildStatusKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: 'Refresh', callback_data: encodeGuidedCallback({ kind: 'status' }) },
        { text: 'Home', callback_data: encodeGuidedCallback({ kind: 'home' }) },
      ],
    ],
  };
}

export function buildFinishedJobsKeyboard(response: JobListResponse): TelegramInlineKeyboardMarkup {
  const buttons = response.jobs.slice(0, 5).map((job) => [
    {
      text: job.jobId.slice(0, 12),
      callback_data: encodeGuidedCallback({ kind: 'job', jobId: job.jobId }),
    },
  ]);
  return {
    inline_keyboard: [
      ...buttons,
      [
        { text: 'Refresh', callback_data: encodeGuidedCallback({ kind: 'finished' }) },
        { text: 'Home', callback_data: encodeGuidedCallback({ kind: 'home' }) },
      ],
    ],
  };
}

export function buildRecentOpsKeyboard(response: OpsActionListResponse): TelegramInlineKeyboardMarkup {
  const buttons = response.actions.slice(0, 5).map((action) => [
    {
      text: action.operationId.slice(0, 12),
      callback_data: encodeGuidedCallback({ kind: 'op', operationId: action.operationId }),
    },
  ]);
  return {
    inline_keyboard: [
      ...buttons,
      [
        { text: 'Refresh', callback_data: encodeGuidedCallback({ kind: 'recent_ops' }) },
        { text: 'Home', callback_data: encodeGuidedCallback({ kind: 'home' }) },
      ],
    ],
  };
}

export function buildJobDetailsKeyboard(jobId: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: 'Links', callback_data: encodeGuidedCallback({ kind: 'job_links', jobId }) },
        { text: 'Share', callback_data: encodeGuidedCallback({ kind: 'job_share', jobId }) },
      ],
      [
        { text: 'Refresh', callback_data: encodeGuidedCallback({ kind: 'job', jobId }) },
        { text: 'Back', callback_data: encodeGuidedCallback({ kind: 'finished' }) },
        { text: 'Home', callback_data: encodeGuidedCallback({ kind: 'home' }) },
      ],
    ],
  };
}

export function buildOperationDetailsKeyboard(operationId: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: 'Refresh', callback_data: encodeGuidedCallback({ kind: 'op', operationId }) },
        { text: 'Back', callback_data: encodeGuidedCallback({ kind: 'recent_ops' }) },
        { text: 'Home', callback_data: encodeGuidedCallback({ kind: 'home' }) },
      ],
    ],
  };
}

async function sendDirectMessage(
  context: CommandContext,
  html: string,
  options?: {
    disableLinkPreview?: boolean;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  },
) {
  return context.messenger.sendHtmlMessage({
    chatId: replyChatId(context),
    html,
    disableLinkPreview: options?.disableLinkPreview,
    replyMarkup: options?.replyMarkup,
  });
}

function emitUxUsageMetric(context: CommandContext, command: 'start' | 'help'): void {
  emitBotMetricCounter({
    audit: context.audit,
    metric: 'ux_entry_usage',
    labels: {
      command,
      audience: isPrivateChatContext(context) ? 'private_onboarding' : 'ops_chat',
    },
  });
}

function emitUxLatencyMetric(
  context: CommandContext,
  command: 'start' | 'help',
  startedAtMs: number,
): void {
  emitBotMetricCounter({
    audit: context.audit,
    metric: 'ux_response_latency_ms',
    value: Date.now() - startedAtMs,
    labels: {
      command,
      audience: isPrivateChatContext(context) ? 'private_onboarding' : 'ops_chat',
    },
  });
}

async function sendDomainMessage(
  context: CommandContext,
  domain: CommandDefinition['domain'],
  html: string,
  options?: {
    disableLinkPreview?: boolean;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  },
) {
  const threadId = context.topicRouter.resolveThreadId({
    domain,
    incomingThreadId: incomingThreadId(context),
  });
  return context.messenger.sendHtmlMessage({
    chatId: context.config.chatId,
    threadId,
    domain,
    html,
    disableLinkPreview: options?.disableLinkPreview,
    replyMarkup: options?.replyMarkup,
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

export async function renderGuidedHome(
  context: CommandContext,
  commands: CommandDefinition[],
): Promise<{ html: string; replyMarkup: TelegramInlineKeyboardMarkup }> {
  const opsCommands = getAdvertisedCommands(commands, context.config, 'ops_chat');
  return {
    html: formatGuidedHelpHome({
      commands: opsCommands,
      enableActionCommands: context.config.enableActionCommands,
    }),
    replyMarkup: buildGuidedHomeKeyboard(context.config),
  };
}

export async function loadOpsStatusView(context: CommandContext): Promise<{
  html: string;
  replyMarkup: TelegramInlineKeyboardMarkup;
}> {
  const status = await context.backend.getOpsStatus();
  return {
    html: formatOpsStatus(status),
    replyMarkup: buildStatusKeyboard(),
  };
}

export async function loadFinishedJobsView(
  context: CommandContext,
  limit = 10,
): Promise<{
  html: string;
  replyMarkup: TelegramInlineKeyboardMarkup;
  response: JobListResponse;
}> {
  const response = await context.backend.getFinishedJobs(limit);
  return {
    html: formatFinishedJobs(response),
    replyMarkup: buildFinishedJobsKeyboard(response),
    response,
  };
}

export async function loadRecentOpsView(
  context: CommandContext,
  limit = 10,
): Promise<{
  html: string;
  replyMarkup: TelegramInlineKeyboardMarkup;
  response: OpsActionListResponse;
}> {
  const response = await context.backend.listOpsActions(limit, 0);
  return {
    html: formatRecentOpsActions(response),
    replyMarkup: buildRecentOpsKeyboard(response),
    response,
  };
}

export async function loadJobDetailsView(
  context: CommandContext,
  jobId: string,
): Promise<{
  html: string;
  replyMarkup: TelegramInlineKeyboardMarkup;
}> {
  const job = await context.backend.getJob(jobId);
  return {
    html: formatJobDetails(job),
    replyMarkup: buildJobDetailsKeyboard(jobId),
  };
}

export async function loadOperationDetailsView(
  context: CommandContext,
  operationId: string,
): Promise<{
  html: string;
  replyMarkup: TelegramInlineKeyboardMarkup;
}> {
  const status = await context.backend.getOpsActionStatus(operationId);
  return {
    html: formatActionStatus(status),
    replyMarkup: buildOperationDetailsKeyboard(operationId),
  };
}

export function renderGuidedActionConfirmation(
  context: CommandContext,
  action: 'backup' | 'drill',
): {
  html: string;
  replyMarkup: TelegramInlineKeyboardMarkup;
} {
  return {
    html: formatGuidedActionConfirmation({
      action,
      webhookMode: context.config.mode === 'webhook',
    }),
    replyMarkup: buildGuidedActionConfirmationKeyboard(action),
  };
}

export function renderGuidedActionSubmitted(
  context: CommandContext,
  action: 'backup' | 'drill',
): {
  html: string;
  replyMarkup: TelegramInlineKeyboardMarkup;
} {
  return {
    html: formatGuidedActionSubmitted({
      action,
      webhookMode: context.config.mode === 'webhook',
    }),
    replyMarkup: buildGuidedHomeOnlyKeyboard(),
  };
}

interface ResolvedSharePayload {
  studyTextAudioUrl: string | null;
  pronunciationAudioUrl: string | null;
  assignmentTitle: string | null;
  assignmentEmoji: string | null;
  telemetry: {
    markdownSource: 'none' | 'inline' | 'file_path';
    htmlFetched: boolean;
    usedHtmlFallback: boolean;
    studyAudioSource: 'markdown_label' | 'markdown_path' | 'html_path' | 'missing';
    pronunciationAudioSource: 'markdown_label' | 'markdown_path' | 'html_path' | 'missing';
    titleSource: 'markdown_frontmatter' | 'markdown_heading' | 'html_title' | 'missing';
    emojiSource: 'markdown_frontmatter' | 'html_hero' | 'missing';
    missingStudyAudio: boolean;
    missingPronunciationAudio: boolean;
    missingAudioCount: number;
  };
}

async function resolveSharePayloadForJob(
  context: CommandContext,
  mdOrHtmlSource: {
    md: string | null;
    htmlUrl?: string | null;
  },
): Promise<ResolvedSharePayload> {
  let markdown: string | null = mdOrHtmlSource.md;
  let markdownSource: 'none' | 'inline' | 'file_path' = markdown ? 'inline' : 'none';
  let html: string | null = null;

  if (markdown && looksLikeMarkdownFilePath(markdown)) {
    markdownSource = 'file_path';
    try {
      markdown = await readFile(markdown, 'utf8');
    } catch {
      // Ignore filesystem read errors; we'll try HTML fallback.
      markdown = null;
    }
  }

  let studyTextAudioUrl: string | null = null;
  let studyAudioSource: ResolvedSharePayload['telemetry']['studyAudioSource'] = 'missing';
  const studyTextLabeledUrl = extractLabeledMarkdownAudioUrl(markdown, 'Audio recording: Study Text');
  if (studyTextLabeledUrl) {
    studyTextAudioUrl = studyTextLabeledUrl;
    studyAudioSource = 'markdown_label';
  } else {
    const studyTextFallbackUrl = extractAudioUrlByPathHint(markdown, '/audio/final/');
    if (studyTextFallbackUrl) {
      studyTextAudioUrl = studyTextFallbackUrl;
      studyAudioSource = 'markdown_path';
    }
  }

  let pronunciationAudioUrl: string | null = null;
  let pronunciationAudioSource: ResolvedSharePayload['telemetry']['pronunciationAudioSource'] = 'missing';
  const pronunciationLabeledUrl = extractLabeledMarkdownAudioUrl(
    markdown,
    'Audio recording: Pronunciation Shadow Sentence',
  );
  if (pronunciationLabeledUrl) {
    pronunciationAudioUrl = pronunciationLabeledUrl;
    pronunciationAudioSource = 'markdown_label';
  } else {
    const pronunciationFallbackUrl = extractAudioUrlByPathHint(markdown, '/audio/pronunciation-shadow/');
    if (pronunciationFallbackUrl) {
      pronunciationAudioUrl = pronunciationFallbackUrl;
      pronunciationAudioSource = 'markdown_path';
    }
  }

  const markdownTitle = extractAssignmentTitleFromMarkdown(markdown);
  const markdownEmoji = extractAssignmentEmojiFromMarkdown(markdown);
  const markdownTitleSource = detectMarkdownTitleSource(markdownTitle, markdown);
  const markdownEmojiSource = detectMarkdownEmojiSource(markdownEmoji, markdown);
  let htmlFetched = false;

  if ((!studyTextAudioUrl || !pronunciationAudioUrl || !markdownTitle) && mdOrHtmlSource.htmlUrl) {
    html = await fetchTextWithTimeout(mdOrHtmlSource.htmlUrl, context.config.backendTimeoutMs);
    htmlFetched = html !== null;
    if (html) {
      if (!studyTextAudioUrl) {
        const htmlStudyTextAudioUrl = extractAudioUrlByPathHint(html, '/audio/final/');
        if (htmlStudyTextAudioUrl) {
          studyTextAudioUrl = htmlStudyTextAudioUrl;
          studyAudioSource = 'html_path';
        }
      }
      if (!pronunciationAudioUrl) {
        const htmlPronunciationAudioUrl = extractAudioUrlByPathHint(
          html,
          '/audio/pronunciation-shadow/',
        );
        if (htmlPronunciationAudioUrl) {
          pronunciationAudioUrl = htmlPronunciationAudioUrl;
          pronunciationAudioSource = 'html_path';
        }
      }
    }
  }

  const htmlTitle = extractAssignmentTitleFromHtml(html);
  const htmlEmoji = extractAssignmentEmojiFromHtml(html);

  const assignmentTitle = markdownTitle ?? htmlTitle ?? null;
  const assignmentEmoji = markdownEmoji ?? htmlEmoji ?? null;
  const titleSource: ResolvedSharePayload['telemetry']['titleSource'] = markdownTitle
    ? (markdownTitleSource ?? 'missing')
    : htmlTitle
      ? 'html_title'
      : 'missing';
  const emojiSource: ResolvedSharePayload['telemetry']['emojiSource'] = markdownEmoji
    ? (markdownEmojiSource ?? 'missing')
    : htmlEmoji
      ? 'html_hero'
      : 'missing';
  const missingStudyAudio = studyTextAudioUrl === null;
  const missingPronunciationAudio = pronunciationAudioUrl === null;
  const missingAudioCount = Number(missingStudyAudio) + Number(missingPronunciationAudio);
  const usedHtmlFallback =
    studyAudioSource === 'html_path' || pronunciationAudioSource === 'html_path' || titleSource === 'html_title';

  return {
    studyTextAudioUrl,
    pronunciationAudioUrl,
    assignmentTitle,
    assignmentEmoji,
    telemetry: {
      markdownSource,
      htmlFetched,
      usedHtmlFallback,
      studyAudioSource,
      pronunciationAudioSource,
      titleSource,
      emojiSource,
      missingStudyAudio,
      missingPronunciationAudio,
      missingAudioCount,
    },
  };
}

function looksLikeMarkdownFilePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().endsWith('.md')) return false;
  return trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../');
}

function extractLabeledMarkdownAudioUrl(
  markdown: string | null | undefined,
  label: string,
): string | null {
  if (!markdown) return null;
  const pattern = new RegExp(String.raw`\[${escapeRegExp(label)}\]\((https?:\/\/[^\s)]+)\)`, 'i');
  const match = markdown.match(pattern);
  return match?.[1] ?? null;
}

function extractAudioUrlByPathHint(
  input: string | null | undefined,
  pathHint: string,
): string | null {
  if (!input) return null;
  const pattern = new RegExp(
    String.raw`(https?:\/\/[^\s<>"')\]]*${escapeRegExp(pathHint)}[^\s<>"')\]]*\.mp3(?:\?[^\s<>"')\]]*)?)`,
    'i',
  );
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

function detectMarkdownTitleSource(
  title: string | null,
  markdown: string | null | undefined,
): 'markdown_frontmatter' | 'markdown_heading' | null {
  if (!title || !markdown) return null;
  const frontmatterMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (frontmatterMatch?.[1]) {
    const titleMatch = frontmatterMatch[1].match(/^\s*title:\s*(.+)\s*$/im);
    if (titleMatch?.[1] && cleanupTitleToken(titleMatch[1]) === title) {
      return 'markdown_frontmatter';
    }
  }
  const headingMatch = markdown.match(/^#\s+(.+)$/m);
  if (headingMatch?.[1] && cleanupTitleToken(headingMatch[1]) === title) {
    return 'markdown_heading';
  }
  return null;
}

function detectMarkdownEmojiSource(
  emoji: string | null,
  markdown: string | null | undefined,
): 'markdown_frontmatter' | null {
  if (!emoji || !markdown) return null;
  const frontmatterMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatterMatch?.[1]) return null;
  const iconMatch = frontmatterMatch[1].match(/^\s*icon:\s*(.+)\s*$/im);
  if (iconMatch?.[1] && cleanupIconToken(iconMatch[1]) === emoji) {
    return 'markdown_frontmatter';
  }
  return null;
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
  const trimmed = value.trim().replaceAll(/^['"]|['"]$/g, '');
  if (!trimmed) return null;
  return trimmed.replaceAll(/^homework\s+ass+i?ignment\s*:\s*/gi, '').trim() || null;
}

function cleanupIconToken(value: string): string | null {
  const trimmed = value.trim().replaceAll(/^['"]|['"]$/g, '');
  if (!trimmed) return null;
  return trimmed;
}

function stripTags(value: string): string {
  return value.replaceAll(/<[^>]*>/g, '');
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
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

export async function sendShareableJobLinks(
  context: CommandContext,
  jobIdRaw: string | undefined,
): Promise<void> {
  const jobId = jobIdRaw?.trim();
  if (!jobId) {
    await sendDomainMessage(
      context,
      'jobs',
      formatCommandError(`Usage: /${context.command} <jobId>`),
    );
    return;
  }

  const job = await context.backend.getJob(jobId);
  const sharePayload = await resolveSharePayloadForJob(context, {
    md: job.md,
    htmlUrl: job.htmlUrl,
  });

  context.audit.log({
    level: 'info',
    event: 'share_path_telemetry',
    message: 'Resolved share extraction sources',
    userId: context.fromUserId,
    chatId: context.config.chatId,
    threadId: incomingThreadId(context),
    command: context.command,
    commandArgs: context.args,
    details: {
      jobId,
      htmlUrlPresent: Boolean(job.htmlUrl),
      ...sharePayload.telemetry,
    },
  });

  for (const [kind, source] of [
    ['study', sharePayload.telemetry.studyAudioSource],
    ['pronunciation', sharePayload.telemetry.pronunciationAudioSource],
  ] as const) {
    if (source === 'markdown_label' || source === 'markdown_path' || source === 'html_path') {
      emitBotMetricCounter({
        audit: context.audit,
        metric: 'share_extraction_source',
        labels: {
          kind,
          source,
        },
      });
    }
  }
  if (sharePayload.telemetry.missingStudyAudio) {
    emitBotMetricCounter({
      audit: context.audit,
      metric: 'share_missing_audio',
      labels: {
        kind: 'missing_study',
      },
    });
  }
  if (sharePayload.telemetry.missingPronunciationAudio) {
    emitBotMetricCounter({
      audit: context.audit,
      metric: 'share_missing_audio',
      labels: {
        kind: 'missing_pronunciation',
      },
    });
  }
  if (sharePayload.telemetry.missingAudioCount > 0) {
    emitBotMetricCounter({
      audit: context.audit,
      metric: 'share_missing_audio',
      labels: {
        kind: 'missing_any',
      },
    });
  }
  if (sharePayload.telemetry.usedHtmlFallback) {
    emitBotMetricCounter({
      audit: context.audit,
      metric: 'share_fallback_source',
      labels: {
        source: 'html',
      },
    });
  }

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

export async function executeBackupAction(
  context: CommandContext,
  label?: string,
): Promise<void> {
  if (!(await guardActionCommandsEnabled(context))) {
    return;
  }
  const trimmedLabel = label?.trim();
  const request: OpsActionRequest = {
    action: 'backup_upload',
    ...(trimmedLabel ? { label: trimmedLabel } : {}),
  };
  if (advancedControlsEnabled(context)) {
    await queueAdvancedApproval(context, 'backup', request);
    return;
  }
  const result = await context.backend.enqueueOpsAction(request);
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
}

export async function executeDrillAction(context: CommandContext): Promise<void> {
  if (!(await guardActionCommandsEnabled(context))) {
    return;
  }
  const request: OpsActionRequest = {
    action: 'restore_drill_download_only',
  };
  if (advancedControlsEnabled(context)) {
    await queueAdvancedApproval(context, 'drill', request);
    return;
  }
  const result = await context.backend.enqueueOpsAction(request);
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
}

export function createCommandRegistry(args?: { replayStore?: ApprovalReplayStore }): CommandRegistry {
  const replayStore = args?.replayStore ?? defaultApprovalReplayStore;
  const commands: CommandDefinition[] = [
    {
      command: 'start',
      description: 'Show bot onboarding and where to run ops commands',
      domain: 'ops',
      async execute(context) {
        emitUxUsageMetric(context, 'start');
        const startedAtMs = Date.now();
        const html = formatStartMessage({
          enableActionCommands: context.config.enableActionCommands,
          opsChatId: context.config.chatId,
          inOpsChat: !isPrivateChatContext(context),
        });
        if (isPrivateChatContext(context)) {
          await sendDirectMessage(context, html);
        } else {
          await sendDomainMessage(context, 'ops', html);
        }
        emitUxLatencyMetric(context, 'start', startedAtMs);
      },
    },
    {
      command: 'help',
      description: 'Show available commands',
      domain: 'ops',
      async execute(context) {
        emitUxUsageMetric(context, 'help');
        const startedAtMs = Date.now();
        if (isPrivateChatContext(context)) {
          const privateCommands = getAdvertisedCommands(
            commands,
            context.config,
            'private_onboarding',
          );
          await sendDirectMessage(
            context,
            formatHelpWithOptions(privateCommands, {
              title: 'ESL Ops Control Onboarding',
              footerLines: [
                context.config.enableActionCommands
                  ? 'This deployment currently allows enabled action commands in the ops chat.'
                  : 'This deployment is currently read-only in the ops chat.',
                `Run operational commands in the configured ops chat: ${context.config.chatId}.`,
              ],
            }),
          );
        } else {
          const guidedHome = await renderGuidedHome(context, commands);
          await sendDomainMessage(context, 'ops', guidedHome.html, {
            replyMarkup: guidedHome.replyMarkup,
          });
        }
        emitUxLatencyMetric(context, 'help', startedAtMs);
      },
    },
    {
      command: 'status',
      description: 'Show machine status summary',
      domain: 'ops',
      async execute(context) {
        const view = await loadOpsStatusView(context);
        await sendDomainMessage(context, 'ops', view.html);
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
        const view = await loadOperationDetailsView(context, operationId);
        await sendDomainMessage(context, 'ops', view.html);
      },
    },
    {
      command: 'finished',
      description: 'List recently finished jobs (/finished [limit])',
      domain: 'jobs',
      async execute(context) {
        const requestedLimit = context.args[0] ? Number(context.args[0]) : 10;
        const limit = Number.isInteger(requestedLimit)
          ? Math.max(1, Math.min(20, requestedLimit))
          : 10;
        const view = await loadFinishedJobsView(context, limit);
        await sendDomainMessage(context, 'jobs', view.html);
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
        const view = await loadJobDetailsView(context, jobId);
        await sendDomainMessage(context, 'jobs', view.html);
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
        await executeBackupAction(context, context.args.join(' ').trim());
      },
    },
    {
      command: 'drill',
      description: 'Queue restore drill (download-only)',
      domain: 'ops',
      async execute(context) {
        await executeDrillAction(context);
      },
    },
    {
      command: 'approve',
      description: 'Approve a pending advanced action (/approve <token>)',
      domain: 'ops',
      async execute(context) {
        await approveAdvancedAction(context, context.args[0], replayStore);
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
