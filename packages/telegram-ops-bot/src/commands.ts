import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type {
  JobListResponse,
  JobState,
  JobStatusDto,
  OpsActionListResponse,
  OpsActionRequest,
  StudentProfileDto,
  StudentSummaryResponse,
} from '@esl-pipeline/contracts';

import { type ApprovalReplayStore, InMemoryApprovalReplayStore } from './approval-replay-store.js';
import {
  formatActionQueued,
  formatActionStatus,
  formatAudioPlaybackLink,
  formatBotStatusReport,
  formatCommandError,
  formatFinishedJobs,
  formatGuidedActionConfirmation,
  formatGuidedActionSubmitted,
  formatGuidedHelpHome,
  formatHelpWithOptions,
  formatJobDetails,
  formatJobLinks,
  formatJobsQueryResults,
  formatOpsStatus,
  formatRecentOpsActions,
  formatShareJobHeader,
  formatStartMessage,
  formatStudentDisambiguation,
  formatStudentNotFound,
  formatStudentSummary,
  formatStudentsBrowser,
  formatTodaySummary,
} from './formatter.js';
import { encodeGuidedCallback, type JobsViewKey } from './guided-callbacks.js';
import { emitBotMetricCounter } from './metrics.js';
import type {
  BotDomain,
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
const STUDENTS_PAGE_SIZE = 10;
const STUDENT_RESOLUTION_LIMIT = 500;
const COMPACT_JOBS_VIEW_VERSION = '1';
const COMPACT_JOBS_VIEW_EMPTY_DAY = 'zzz';
const COMPACT_JOBS_VIEW_EMPTY_STUDENT = '____________';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXACT_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const defaultApprovalReplayStore = new InMemoryApprovalReplayStore();

interface StudentMatchResult {
  status: 'none' | 'single' | 'multiple';
  matches: StudentProfileDto[];
}

interface StudentViewModel {
  student: StudentProfileDto;
  jobs: JobStatusDto[];
  latestJob: JobStatusDto | null;
  latestAssignmentTitle: string | null;
}

interface StudentSummaryViewModel {
  response: StudentSummaryResponse;
  page: number;
  offset: number;
}

interface ParsedJobsFilter {
  states?: JobState[];
  studentQuery?: string;
  from?: string;
  to?: string;
  limit: number;
  order: 'asc' | 'desc';
  normalizedTokens: string[];
}

interface JobsViewOptions {
  title?: string;
  footerLines?: string[];
  emptyMessage?: string;
  viewKey?: JobsViewKey;
  keyboardScope?: 'global' | 'today' | 'student';
  backToStudentId?: string;
}

const JOB_STATE_BIT_BY_STATE: Record<JobState, number> = {
  queued: 1,
  running: 2,
  awaiting_approval: 4,
  succeeded: 8,
  failed: 16,
};

const JOB_STATE_ORDER: readonly JobState[] = [
  'queued',
  'running',
  'awaiting_approval',
  'succeeded',
  'failed',
];

function toCompactStudentRef(studentId: string): string {
  return studentId.slice(0, 12).toLowerCase().padEnd(12, '_');
}

function encodeDayCode(iso: string | undefined): string {
  if (!iso) {
    return COMPACT_JOBS_VIEW_EMPTY_DAY;
  }
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    throw new TypeError(`Cannot encode jobs view day from ${iso}.`);
  }
  return Math.floor(parsed / MS_PER_DAY)
    .toString(36)
    .padStart(3, '0')
    .slice(-3);
}

function decodeDayCode(dayCode: string): string | null {
  if (dayCode === COMPACT_JOBS_VIEW_EMPTY_DAY) {
    return null;
  }
  const daysSinceEpoch = Number.parseInt(dayCode, 36);
  if (!Number.isFinite(daysSinceEpoch) || daysSinceEpoch < 0) {
    throw new Error(`Invalid jobs view day code: ${dayCode}`);
  }
  return new Date(daysSinceEpoch * MS_PER_DAY).toISOString();
}

function encodeJobStateMask(states: JobState[] | undefined): string {
  const mask = (states ?? []).reduce((value, state) => value | JOB_STATE_BIT_BY_STATE[state], 0);
  return mask.toString(36);
}

function decodeJobStateMask(maskCode: string): JobState[] | undefined {
  const mask = Number.parseInt(maskCode, 36);
  if (!Number.isFinite(mask) || mask < 0 || mask > 31) {
    throw new Error(`Invalid jobs view state mask: ${maskCode}`);
  }
  const states = JOB_STATE_ORDER.filter((state) => (mask & JOB_STATE_BIT_BY_STATE[state]) !== 0);
  return states.length > 0 ? states : undefined;
}

function buildAdHocJobsViewKey(parsed: ParsedJobsFilter, options: JobsViewOptions): JobsViewKey {
  const limitCode = parsed.limit.toString(36);
  const studentCode = options.backToStudentId
    ? toCompactStudentRef(options.backToStudentId)
    : COMPACT_JOBS_VIEW_EMPTY_STUDENT;
  const orderCode = parsed.order === 'asc' ? 'a' : 'd';
  return `q:${COMPACT_JOBS_VIEW_VERSION}${encodeJobStateMask(parsed.states)}${limitCode}${orderCode}${encodeDayCode(parsed.from)}${encodeDayCode(parsed.to)}${studentCode}` as JobsViewKey;
}

function buildNormalizedJobsTokens(parsed: {
  states?: JobState[];
  studentLabel?: string;
  from?: string;
  to?: string;
  limit: number;
  order: 'asc' | 'desc';
}): string[] {
  const tokens: string[] = [];
  if (parsed.states && parsed.states.length > 0) {
    tokens.push(`state:${parsed.states.join(',')}`);
  }
  if (parsed.studentLabel) {
    tokens.push(`student:${parsed.studentLabel}`);
  }
  if (parsed.from) {
    tokens.push(`since:${parsed.from.slice(0, 10)}`);
  }
  if (parsed.to) {
    tokens.push(`before:${parsed.to.slice(0, 10)}`);
  }
  if (parsed.limit !== 10) {
    tokens.push(`limit:${parsed.limit}`);
  }
  if (parsed.order !== 'desc') {
    tokens.push(`order:${parsed.order}`);
  }
  return tokens.length > 0 ? tokens : ['latest 10 jobs'];
}

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
    await sendDomainMessage(
      context,
      'ops',
      formatCommandError('Approval token has already been used.'),
    );
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
  if (command.command === 'links') {
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

export function buildGuidedHomeKeyboard(
  config: CommandContext['config'],
): TelegramInlineKeyboardMarkup {
  const rows = [
    [
      { text: 'Today', callback_data: encodeGuidedCallback({ kind: 'today' }) },
      { text: 'Students', callback_data: encodeGuidedCallback({ kind: 'students_home' }) },
    ],
    [
      { text: 'Finished', callback_data: encodeGuidedCallback({ kind: 'finished' }) },
      { text: 'Status', callback_data: encodeGuidedCallback({ kind: 'status' }) },
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
  return buildJobsViewKeyboard(response, {
    viewKey: 'gs',
    scope: 'global',
  });
}

function buildFinishedJobButtonLabel(job: JobListResponse['jobs'][number]): string {
  const studentName = job.studentName?.trim();
  const studentId = job.studentId?.trim();
  const shortStudentId = studentId ? studentId.slice(0, 8) : null;

  if (studentName && shortStudentId) {
    const combined = `${studentName} · ${shortStudentId}`;
    return combined.length > 30 ? `${combined.slice(0, 27)}...` : combined;
  }

  if (studentName) {
    return studentName.length > 30 ? `${studentName.slice(0, 27)}...` : studentName;
  }

  if (shortStudentId) {
    return shortStudentId;
  }

  return job.jobId.slice(0, 12);
}

function buildStudentButtonLabel(student: StudentProfileDto): string {
  const shortStudentId = student.id.slice(0, 8);
  const combined = `${student.student} · ${shortStudentId}`;
  return combined.length > 30 ? `${combined.slice(0, 27)}...` : combined;
}

export function buildStudentDisambiguationKeyboard(
  matches: StudentProfileDto[],
): TelegramInlineKeyboardMarkup {
  const buttons = matches.slice(0, 5).map((student) => [
    {
      text: buildStudentButtonLabel(student),
      callback_data: encodeGuidedCallback({ kind: 'student', studentId: student.id }),
    },
  ]);
  return {
    inline_keyboard: [
      ...buttons,
      [{ text: 'Home', callback_data: encodeGuidedCallback({ kind: 'home' }) }],
    ],
  };
}

export function buildStudentDetailsKeyboard(args: {
  studentId: string;
  latestJobId?: string | null;
  shareLatestJobId?: string | null;
}): TelegramInlineKeyboardMarkup {
  const rows: TelegramInlineKeyboardMarkup['inline_keyboard'] = [];
  const studentRef = toStudentRef(args.studentId);
  rows.push([
    {
      text: 'Recent Jobs',
      callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: `sr:${studentRef}` }),
    },
    {
      text: 'Failed',
      callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: `sf:${studentRef}` }),
    },
    {
      text: 'Succeeded',
      callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: `ss:${studentRef}` }),
    },
  ]);
  if (args.latestJobId || args.shareLatestJobId) {
    rows.push(
      [
        ...(args.latestJobId
          ? [
              {
                text: 'Latest Job',
                callback_data: encodeGuidedCallback({
                  kind: 'job',
                  jobId: args.latestJobId,
                  backViewKey: `sr:${studentRef}`,
                }),
              },
            ]
          : []),
        ...(args.shareLatestJobId
          ? [
              {
                text: 'Share Latest',
                callback_data: encodeGuidedCallback({
                  kind: 'job_share',
                  jobId: args.shareLatestJobId,
                }),
              },
            ]
          : []),
      ].filter(Boolean) as TelegramInlineKeyboardMarkup['inline_keyboard'][number],
    );
  }
  rows.push([
    {
      text: 'Refresh',
      callback_data: encodeGuidedCallback({ kind: 'student', studentId: args.studentId }),
    },
    { text: 'Home', callback_data: encodeGuidedCallback({ kind: 'home' }) },
  ]);
  return { inline_keyboard: rows };
}

export function buildJobsViewKeyboard(
  response: JobListResponse,
  args: {
    viewKey?: JobsViewKey;
    scope: 'global' | 'today' | 'student';
    backToStudentId?: string;
  },
): TelegramInlineKeyboardMarkup {
  const buttons = response.jobs.slice(0, 5).map((job) => [
    {
      text: buildFinishedJobButtonLabel(job),
      callback_data: encodeGuidedCallback({
        kind: 'job',
        jobId: job.jobId,
        ...(args.viewKey ? { backViewKey: args.viewKey } : {}),
      }),
    },
  ]);

  const rows: TelegramInlineKeyboardMarkup['inline_keyboard'] = [...buttons];
  if (args.scope === 'global') {
    rows.push([
      { text: 'Failed', callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: 'gf' }) },
      {
        text: 'Running',
        callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: 'gn' }),
      },
      {
        text: 'Succeeded',
        callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: 'gs' }),
      },
      { text: 'Today', callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: 'ta' }) },
      { text: 'Home', callback_data: encodeGuidedCallback({ kind: 'home' }) },
    ]);
  }
  if (args.scope === 'student' && args.backToStudentId) {
    const studentRef = toStudentRef(args.backToStudentId);
    rows.push(
      [
        {
          text: 'Recent',
          callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: `sr:${studentRef}` }),
        },
        {
          text: 'Failed',
          callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: `sf:${studentRef}` }),
        },
        {
          text: 'Succeeded',
          callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: `ss:${studentRef}` }),
        },
      ],
      [
        {
          text: 'Back to Student',
          callback_data: encodeGuidedCallback({ kind: 'student', studentId: args.backToStudentId }),
        },
        { text: 'Home', callback_data: encodeGuidedCallback({ kind: 'home' }) },
      ],
    );
  }
  if (args.scope === 'today') {
    rows.push(
      [
        {
          text: 'Failed',
          callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: 'tf' }),
        },
        {
          text: 'Running',
          callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: 'tn' }),
        },
        {
          text: 'Awaiting',
          callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: 'tw' }),
        },
        {
          text: 'Finished',
          callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: 'ts' }),
        },
      ],
      [
        {
          text: 'All Today',
          callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: 'ta' }),
        },
        { text: 'Back to Today', callback_data: encodeGuidedCallback({ kind: 'today' }) },
        { text: 'Home', callback_data: encodeGuidedCallback({ kind: 'home' }) },
      ],
    );
  }

  return {
    inline_keyboard: rows,
  };
}

export function buildJobsQueryKeyboard(response: JobListResponse): TelegramInlineKeyboardMarkup {
  return buildJobsViewKeyboard(response, {
    scope: 'global',
  });
}

export function buildStudentsKeyboard(args: {
  response: StudentSummaryResponse;
  offset: number;
}): TelegramInlineKeyboardMarkup {
  const buttons = args.response.items.map((student) => [
    {
      text: `${student.name} · ${student.id.slice(0, 8)}`,
      callback_data: encodeGuidedCallback({ kind: 'student', studentId: student.id }),
    },
  ]);
  const navigation: TelegramInlineKeyboardMarkup['inline_keyboard'][number] = [];
  if (args.offset > 0) {
    navigation.push({
      text: 'Prev',
      callback_data: encodeGuidedCallback({
        kind: 'students_page',
        offset: Math.max(0, args.offset - STUDENTS_PAGE_SIZE),
      }),
    });
  }
  if (args.offset + args.response.items.length < args.response.total) {
    navigation.push({
      text: 'Next',
      callback_data: encodeGuidedCallback({
        kind: 'students_page',
        offset: args.offset + STUDENTS_PAGE_SIZE,
      }),
    });
  }
  navigation.push({
    text: 'Home',
    callback_data: encodeGuidedCallback({ kind: 'home' }),
  });
  return {
    inline_keyboard: [...buttons, navigation],
  };
}

export function buildTodayKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: 'Failed',
          callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: 'tf' }),
        },
        {
          text: 'Running',
          callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: 'tn' }),
        },
        {
          text: 'Awaiting',
          callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: 'tw' }),
        },
      ],
      [
        {
          text: 'Finished',
          callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: 'ts' }),
        },
        {
          text: 'All Today',
          callback_data: encodeGuidedCallback({ kind: 'jobs_view', viewKey: 'ta' }),
        },
        { text: 'Home', callback_data: encodeGuidedCallback({ kind: 'home' }) },
      ],
    ],
  };
}

export function buildRecentOpsKeyboard(
  response: OpsActionListResponse,
): TelegramInlineKeyboardMarkup {
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

export function buildJobDetailsKeyboard(
  jobId: string,
  backViewKey?: JobsViewKey,
): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Share', callback_data: encodeGuidedCallback({ kind: 'job_share', jobId }) }],
      [
        {
          text: 'Refresh',
          callback_data: encodeGuidedCallback({
            kind: 'job',
            jobId,
            ...(backViewKey ? { backViewKey } : {}),
          }),
        },
        {
          text: 'Back',
          callback_data: backViewKey
            ? encodeGuidedCallback({ kind: 'jobs_view', viewKey: backViewKey })
            : encodeGuidedCallback({ kind: 'finished' }),
        },
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

export async function loadStudentsView(
  context: CommandContext,
  offset = 0,
): Promise<{
  html: string;
  replyMarkup: TelegramInlineKeyboardMarkup;
  response: StudentSummaryResponse;
}> {
  const response = await context.backend.listStudentSummaries({
    limit: STUDENTS_PAGE_SIZE,
    offset,
    order: 'desc',
  });
  const viewModel: StudentSummaryViewModel = {
    response,
    page: Math.floor(offset / STUDENTS_PAGE_SIZE) + 1,
    offset,
  };
  return {
    html: formatStudentsBrowser({
      response: viewModel.response,
      page: viewModel.page,
    }),
    replyMarkup: buildStudentsKeyboard({
      response: viewModel.response,
      offset: viewModel.offset,
    }),
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

export async function loadStudentView(
  context: CommandContext,
  studentId: string,
): Promise<{
  html: string;
  replyMarkup: TelegramInlineKeyboardMarkup;
}> {
  const viewModel = await loadStudentViewModel(context, studentId);
  return {
    html: formatStudentSummary({
      student: viewModel.student,
      latestJob: viewModel.latestJob,
      latestAssignmentTitle: viewModel.latestAssignmentTitle,
      recentJobs: viewModel.jobs,
    }),
    replyMarkup: buildStudentDetailsKeyboard({
      studentId: viewModel.student.id,
      latestJobId: viewModel.latestJob?.jobId ?? null,
      shareLatestJobId:
        viewModel.latestJob?.state === 'succeeded' ? viewModel.latestJob.jobId : null,
    }),
  };
}

export async function loadJobsView(
  context: CommandContext,
  parsed: ParsedJobsFilter,
  options: JobsViewOptions = {},
): Promise<{
  html: string;
  replyMarkup: TelegramInlineKeyboardMarkup;
  response: JobListResponse;
}> {
  const resolvedStudent = options.backToStudentId
    ? {
        status: 'single' as const,
        matches: [await resolveStudentById(context, options.backToStudentId)],
      }
    : parsed.studentQuery
      ? await resolveStudentQuery(context, parsed.studentQuery)
      : null;
  if (resolvedStudent?.status === 'none') {
    return {
      html: formatStudentNotFound(parsed.studentQuery ?? ''),
      replyMarkup: buildGuidedHomeOnlyKeyboard(),
      response: { jobs: [], total: 0, limit: parsed.limit, offset: 0 },
    };
  }
  if (resolvedStudent?.status === 'multiple') {
    return {
      html: formatStudentDisambiguation({
        query: parsed.studentQuery ?? '',
        matches: resolvedStudent.matches.slice(0, 5),
        footer: 'Multiple students matched. Re-run /jobs with an exact student ID.',
      }),
      replyMarkup: buildGuidedHomeOnlyKeyboard(),
      response: { jobs: [], total: 0, limit: parsed.limit, offset: 0 },
    };
  }
  const response = await context.backend.listJobs({
    states: parsed.states ?? null,
    studentId: resolvedStudent?.matches[0]?.id ?? null,
    from: parsed.from ?? null,
    to: parsed.to ?? null,
    limit: parsed.limit,
    offset: 0,
    order: parsed.order,
  });
  const effectiveBackToStudentId = resolvedStudent?.matches[0]?.id ?? options.backToStudentId;
  const effectiveViewKey =
    options.viewKey ??
    buildAdHocJobsViewKey(parsed, {
      ...options,
      backToStudentId: effectiveBackToStudentId,
    });
  return {
    html: formatJobsQueryResults({
      response,
      normalizedFilters: parsed.normalizedTokens,
      title: options.title,
      footerLines: options.footerLines,
      emptyMessage: options.emptyMessage,
    }),
    replyMarkup: buildJobsViewKeyboard(response, {
      scope: options.keyboardScope ?? 'global',
      viewKey: effectiveViewKey,
      backToStudentId: effectiveBackToStudentId,
    }),
    response,
  };
}

export async function loadJobsViewFromKey(
  context: CommandContext,
  viewKey: JobsViewKey,
): Promise<{
  html: string;
  replyMarkup: TelegramInlineKeyboardMarkup;
  response: JobListResponse;
}> {
  const descriptor = await describeJobsViewKey(context, viewKey);
  return loadJobsView(context, descriptor.parsed, descriptor.options);
}

export async function loadTodayView(
  context: CommandContext,
  now = new Date(),
): Promise<{
  html: string;
  replyMarkup: TelegramInlineKeyboardMarkup;
}> {
  const dayStart = startOfUtcDay(now);
  const from = dayStart.toISOString();
  const to = now.toISOString();
  const [summary, failed, running, succeeded] = await Promise.all([
    context.backend.getAdminJobSummary({ from, to }),
    context.backend.listJobs({ states: ['failed'], from, to, order: 'desc', limit: 3 }),
    context.backend.listJobs({ states: ['running'], from, to, order: 'desc', limit: 3 }),
    context.backend.listJobs({ states: ['succeeded'], from, to, order: 'desc', limit: 5 }),
  ]);
  return {
    html: formatTodaySummary({
      dateLabel: formatUtcDateOnly(dayStart),
      summary,
      failedJobs: failed.jobs,
      runningJobs: running.jobs,
      succeededJobs: succeeded.jobs,
    }),
    replyMarkup: buildTodayKeyboard(),
  };
}

export async function loadBotStatusView(context: CommandContext): Promise<{
  html: string;
}> {
  let backendReachable = true;
  let backendError: string | null = null;
  try {
    await context.backend.getOpsStatus();
  } catch (error: unknown) {
    backendReachable = false;
    backendError = error instanceof Error ? error.message : String(error);
  }
  const topicStates = (['ops', 'jobs', 'alerts'] as const).map((domain) =>
    resolveTopicStatus(context, domain),
  );
  return {
    html: formatBotStatusReport({
      runtimeSnapshot: context.runtimeSnapshot,
      config: context.config,
      backendReachable,
      backendError,
      topicStates,
    }),
  };
}

export async function loadJobDetailsView(
  context: CommandContext,
  jobId: string,
  backViewKey?: JobsViewKey,
): Promise<{
  html: string;
  replyMarkup: TelegramInlineKeyboardMarkup;
}> {
  const job = await context.backend.getJob(jobId);
  const sharePayload = await resolveSharePayloadForJob(context, {
    md: job.md,
    htmlUrl: job.htmlUrl,
  });
  return {
    html: formatJobDetails(job, {
      assignmentTitle: sharePayload.assignmentTitle,
    }),
    replyMarkup: buildJobDetailsKeyboard(jobId, backViewKey),
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

async function loadStudentViewModel(
  context: CommandContext,
  studentId: string,
): Promise<StudentViewModel> {
  const student = await resolveStudentById(context, studentId);
  const jobsResponse = await context.backend.listJobs({
    studentId: student.id,
    order: 'desc',
    limit: 5,
  });
  const latestJob = jobsResponse.jobs[0] ?? null;
  const latestAssignmentTitle = await resolveAssignmentTitleForJob(context, latestJob);
  return {
    student,
    jobs: jobsResponse.jobs,
    latestJob,
    latestAssignmentTitle,
  };
}

async function resolveAssignmentTitleForJob(
  context: CommandContext,
  job: JobStatusDto | null,
): Promise<string | null> {
  if (!job) {
    return null;
  }
  const sharePayload = await resolveSharePayloadForJob(context, {
    md: job.md,
    htmlUrl: job.htmlUrl,
  });
  return sharePayload.assignmentTitle;
}

async function resolveStudentById(
  context: CommandContext,
  studentId: string,
): Promise<StudentProfileDto> {
  const response = await context.backend.searchStudents(studentId, STUDENT_RESOLUTION_LIMIT);
  const student =
    response.items.find((candidate) => candidate.id.toLowerCase() === studentId.toLowerCase()) ??
    null;
  if (!student) {
    throw new Error(`Student ${studentId} could not be resolved.`);
  }
  return student;
}

async function resolveStudentRef(
  context: CommandContext,
  studentRef: string,
): Promise<StudentProfileDto | null> {
  const response = await context.backend.searchStudents(studentRef, STUDENT_RESOLUTION_LIMIT);
  const exactPrefixMatches = response.items.filter((student) =>
    student.id.toLowerCase().startsWith(studentRef.toLowerCase()),
  );
  if (exactPrefixMatches.length === 1) {
    return exactPrefixMatches[0] ?? null;
  }
  return null;
}

async function resolveStudentQuery(
  context: CommandContext,
  queryRaw: string,
): Promise<StudentMatchResult> {
  const query = queryRaw.trim();
  if (!query) {
    return { status: 'none', matches: [] };
  }
  const response = await context.backend.searchStudents(query, STUDENT_RESOLUTION_LIMIT);
  const matches = response.items;
  if (matches.length === 0) {
    return { status: 'none', matches: [] };
  }

  if (EXACT_UUID_REGEX.test(query)) {
    const exactIdMatches = matches.filter(
      (student) => student.id.toLowerCase() === query.toLowerCase(),
    );
    if (exactIdMatches.length === 1) {
      return { status: 'single', matches: exactIdMatches };
    }
  }

  const exactNameMatches = matches.filter(
    (student) => student.student.trim().toLowerCase() === query.toLowerCase(),
  );
  if (exactNameMatches.length === 1) {
    return { status: 'single', matches: exactNameMatches };
  }
  if (exactNameMatches.length > 1) {
    return { status: 'multiple', matches: exactNameMatches };
  }

  return matches.length === 1 ? { status: 'single', matches } : { status: 'multiple', matches };
}

function toStudentRef(studentId: string): string {
  return studentId.slice(0, 12);
}

async function describeJobsViewKey(
  context: CommandContext,
  viewKey: JobsViewKey,
): Promise<{
  parsed: ParsedJobsFilter;
  options: JobsViewOptions;
}> {
  const now = new Date();
  const todayStart = startOfUtcDay(now).toISOString();
  if (viewKey === 'gr') {
    return {
      parsed: {
        limit: 10,
        order: 'desc',
        normalizedTokens: ['latest 10 jobs'],
      },
      options: {
        title: 'Browse Jobs',
        footerLines: ['Try /jobs failed', 'Try /jobs running today', 'Try /jobs Margarita'],
        keyboardScope: 'global',
        viewKey,
      },
    };
  }
  if (viewKey === 'gf' || viewKey === 'gn' || viewKey === 'gs') {
    const state = viewKey === 'gf' ? 'failed' : viewKey === 'gn' ? 'running' : 'succeeded';
    return {
      parsed: {
        states: [state],
        limit: 10,
        order: 'desc',
        normalizedTokens: [`state:${state}`],
      },
      options: {
        title:
          viewKey === 'gf'
            ? 'Jobs · Failed'
            : viewKey === 'gn'
              ? 'Jobs · Running'
              : 'Jobs · Recent Finished',
        keyboardScope: 'global',
        viewKey,
      },
    };
  }
  if (
    viewKey === 'ta' ||
    viewKey === 'tf' ||
    viewKey === 'tn' ||
    viewKey === 'tw' ||
    viewKey === 'ts'
  ) {
    const state =
      viewKey === 'tf'
        ? 'failed'
        : viewKey === 'tn'
          ? 'running'
          : viewKey === 'tw'
            ? 'awaiting_approval'
            : viewKey === 'ts'
              ? 'succeeded'
              : null;
    const title =
      viewKey === 'ta'
        ? 'Jobs · Today'
        : viewKey === 'tf'
          ? 'Jobs · Failed · Today'
          : viewKey === 'tn'
            ? 'Jobs · Running · Today'
            : viewKey === 'tw'
              ? 'Jobs · Awaiting · Today'
              : 'Jobs · Finished · Today';
    return {
      parsed: {
        ...(state ? { states: [state] } : {}),
        from: todayStart,
        limit: 10,
        order: 'desc',
        normalizedTokens: [...(state ? [`state:${state}`] : []), 'since:today'],
      },
      options: {
        title,
        keyboardScope: 'today',
        viewKey,
      },
    };
  }

  if (viewKey.startsWith('q:')) {
    const payload = viewKey.slice(2);
    if (payload.length !== 22 || payload[0] !== COMPACT_JOBS_VIEW_VERSION) {
      throw new Error(`Unsupported jobs view: ${viewKey}`);
    }
    const states = decodeJobStateMask(payload.charAt(1));
    const limitCode = payload[2];
    if (!limitCode) {
      throw new Error(`Invalid jobs view limit in ${viewKey}`);
    }
    const limit = Number.parseInt(limitCode, 36);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new Error(`Invalid jobs view limit in ${viewKey}`);
    }
    const orderCode = payload.charAt(3);
    if (orderCode !== 'a' && orderCode !== 'd') {
      throw new Error(`Invalid jobs view order in ${viewKey}`);
    }
    const from = decodeDayCode(payload.slice(4, 7)) ?? undefined;
    const to = decodeDayCode(payload.slice(7, 10)) ?? undefined;
    const studentCode = payload.slice(10, 22);
    const studentRef =
      studentCode === COMPACT_JOBS_VIEW_EMPTY_STUDENT ? null : studentCode.replace(/_+$/u, '');
    const student = studentRef ? await resolveStudentRef(context, studentRef) : null;
    if (studentRef && !student) {
      throw new Error(`Student view ${viewKey} could not be resolved.`);
    }
    const parsed: ParsedJobsFilter = {
      ...(states ? { states } : {}),
      ...(student ? { studentQuery: student.student } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      limit,
      order: orderCode === 'a' ? 'asc' : 'desc',
      normalizedTokens: buildNormalizedJobsTokens({
        states,
        studentLabel: student?.student,
        from,
        to,
        limit,
        order: orderCode === 'a' ? 'asc' : 'desc',
      }),
    };
    return {
      parsed,
      options: {
        title: 'Jobs',
        keyboardScope: 'global',
        viewKey,
        ...(student ? { backToStudentId: student.id } : {}),
      },
    };
  }

  const studentViewMatch = viewKey.match(/^(sr|sf|ss):(.+)$/i);
  if (!studentViewMatch?.[1] || !studentViewMatch?.[2]) {
    throw new Error(`Unsupported jobs view: ${viewKey}`);
  }

  const student = await resolveStudentRef(context, studentViewMatch[2]);
  if (!student) {
    throw new Error(`Student view ${viewKey} could not be resolved.`);
  }
  const state =
    studentViewMatch[1] === 'sf' ? 'failed' : studentViewMatch[1] === 'ss' ? 'succeeded' : null;
  const title =
    studentViewMatch[1] === 'sf'
      ? `Jobs · ${student.student} (${student.id.slice(0, 8)}) · Failed`
      : studentViewMatch[1] === 'ss'
        ? `Jobs · ${student.student} (${student.id.slice(0, 8)}) · Succeeded`
        : `Jobs · ${student.student} (${student.id.slice(0, 8)}) · Recent`;
  return {
    parsed: {
      ...(state ? { states: [state] } : {}),
      limit: 10,
      order: 'desc',
      normalizedTokens: [...(state ? [`state:${state}`] : []), `student:${student.student}`],
    },
    options: {
      title,
      keyboardScope: 'student',
      backToStudentId: student.id,
      viewKey,
    },
  };
}

function parseJobsFilterInput(raw: string, now = new Date()): ParsedJobsFilter | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      limit: 10,
      order: 'desc',
      normalizedTokens: ['latest 10 jobs'],
    };
  }

  const tokens = splitCommandArguments(trimmed);
  if (tokens.some((token) => token.startsWith('__PARSE_ERROR__'))) {
    return { error: 'Quoted filter values must be closed, e.g. student:"Mary Jane".' };
  }
  const hasStructuredTokens = tokens.some((token) => token.includes(':'));

  if (!hasStructuredTokens) {
    const parsedKeywordResult = parseSoftJobsKeywords(tokens, now);
    if (parsedKeywordResult) {
      return parsedKeywordResult;
    }
    return {
      studentQuery: trimmed,
      limit: 10,
      order: 'desc',
      normalizedTokens: [`student:${trimmed}`],
    };
  }

  const parsed: ParsedJobsFilter = {
    limit: 10,
    order: 'desc',
    normalizedTokens: [],
  };
  const seenKeys = new Set<string>();

  for (const token of tokens) {
    const separatorIndex = token.indexOf(':');
    if (separatorIndex <= 0) {
      return { error: 'Usage: /jobs state:failed since:today student:"Mary Jane" limit:10' };
    }
    const key = token.slice(0, separatorIndex).trim().toLowerCase();
    const rawValue = token.slice(separatorIndex + 1).trim();
    if (!rawValue) {
      return { error: `Missing value for ${key}.` };
    }
    if (seenKeys.has(key)) {
      return { error: `Duplicate filter key: ${key}.` };
    }
    seenKeys.add(key);
    const value = stripMatchingQuotes(rawValue);

    switch (key) {
      case 'state': {
        const states = value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        if (states.length === 0 || !states.every((state) => isJobState(state))) {
          return {
            error: 'state must be queued, running, awaiting_approval, succeeded, or failed.',
          };
        }
        parsed.states = states;
        parsed.normalizedTokens.push(`state:${states.join(',')}`);
        break;
      }
      case 'student': {
        parsed.studentQuery = value;
        parsed.normalizedTokens.push(`student:${value}`);
        break;
      }
      case 'since': {
        const since = resolveDateFilter(value, 'since', now);
        if (!since) {
          return { error: 'since must be today, yesterday, or YYYY-MM-DD.' };
        }
        parsed.from = since.toISOString();
        parsed.normalizedTokens.push(`since:${value}`);
        break;
      }
      case 'before': {
        const before = resolveDateFilter(value, 'before', now);
        if (!before) {
          return { error: 'before must be today, yesterday, or YYYY-MM-DD.' };
        }
        parsed.to = before.toISOString();
        parsed.normalizedTokens.push(`before:${value}`);
        break;
      }
      case 'limit': {
        const limit = Number(value);
        if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
          return { error: 'limit must be an integer between 1 and 20.' };
        }
        parsed.limit = limit;
        parsed.normalizedTokens.push(`limit:${limit}`);
        break;
      }
      case 'order': {
        if (value !== 'asc' && value !== 'desc') {
          return { error: 'order must be asc or desc.' };
        }
        parsed.order = value;
        parsed.normalizedTokens.push(`order:${value}`);
        break;
      }
      default: {
        return { error: `Unknown filter key: ${key}.` };
      }
    }
  }

  if (parsed.from && parsed.to && new Date(parsed.from) >= new Date(parsed.to)) {
    return { error: 'since must be earlier than before.' };
  }

  return parsed;
}

function parseSoftJobsKeywords(tokens: string[], now: Date): ParsedJobsFilter | null {
  const states: JobState[] = [];
  let from: string | undefined;
  let to: string | undefined;
  const residualTokens: string[] = [];

  for (const token of tokens) {
    const value = stripMatchingQuotes(token).trim();
    const lower = value.toLowerCase();
    if (lower === 'failed' || lower === 'running' || lower === 'succeeded') {
      states.push(lower);
      continue;
    }
    if (lower === 'today') {
      from = startOfUtcDay(now).toISOString();
      continue;
    }
    if (lower === 'yesterday') {
      const yesterday = startOfUtcDay(now);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      from = yesterday.toISOString();
      to = startOfUtcDay(now).toISOString();
      continue;
    }
    residualTokens.push(value);
  }

  if (states.length === 0 && !from && !to) {
    return null;
  }

  const normalizedTokens = [
    ...(states.length > 0 ? [`state:${states.join(',')}`] : []),
    ...(from ? [`since:${to ? 'yesterday' : 'today'}`] : []),
  ];
  const studentQuery = residualTokens.join(' ').trim();
  if (studentQuery) {
    normalizedTokens.push(`student:${studentQuery}`);
  }

  return {
    ...(states.length > 0 ? { states } : {}),
    ...(studentQuery ? { studentQuery } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    limit: 10,
    order: 'desc',
    normalizedTokens,
  };
}

function splitCommandArguments(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of input) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (/\s/.test(char) && !inQuotes) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (inQuotes) {
    return [`__PARSE_ERROR__:${input}`];
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function stripMatchingQuotes(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function isJobState(value: string): value is JobState {
  return ['queued', 'running', 'awaiting_approval', 'succeeded', 'failed'].includes(value);
}

function resolveDateFilter(value: string, kind: 'since' | 'before', now: Date): Date | null {
  if (value === 'today') {
    return startOfUtcDay(now);
  }
  if (value === 'yesterday') {
    const day = startOfUtcDay(now);
    day.setUTCDate(day.getUTCDate() - 1);
    return day;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  if (kind === 'before') {
    return parsed;
  }
  return parsed;
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function formatUtcDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function resolveTopicStatus(
  context: CommandContext,
  domain: BotDomain,
): {
  domain: BotDomain;
  threadId?: number;
  routing: 'topic' | 'default' | 'unresolved';
} {
  const threadId = context.topicRouter.resolveThreadId({ domain });
  if (typeof threadId !== 'number') {
    return { domain, routing: 'unresolved' };
  }
  if (context.config.defaultThreadId && threadId === context.config.defaultThreadId) {
    return { domain, threadId, routing: 'default' };
  }
  return { domain, threadId, routing: 'topic' };
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
  const studyTextLabeledUrl = extractLabeledMarkdownAudioUrl(
    markdown,
    'Audio recording: Study Text',
  );
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
  let pronunciationAudioSource: ResolvedSharePayload['telemetry']['pronunciationAudioSource'] =
    'missing';
  const pronunciationLabeledUrl = extractLabeledMarkdownAudioUrl(
    markdown,
    'Audio recording: Pronunciation Practice',
  );
  if (pronunciationLabeledUrl) {
    pronunciationAudioUrl = pronunciationLabeledUrl;
    pronunciationAudioSource = 'markdown_label';
  } else {
    const pronunciationFallbackUrl = extractAudioUrlByPathHints(markdown, [
      '/audio/pronunciation/',
    ]);
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
        const htmlPronunciationAudioUrl = extractAudioUrlByPathHints(html, [
          '/audio/pronunciation/',
        ]);
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
    studyAudioSource === 'html_path' ||
    pronunciationAudioSource === 'html_path' ||
    titleSource === 'html_title';

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
  return (
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    /^[A-Za-z]:[\\/]/.test(trimmed)
  );
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

function extractAudioUrlByPathHints(
  input: string | null | undefined,
  pathHints: readonly string[],
): string | null {
  for (const pathHint of pathHints) {
    const match = extractAudioUrlByPathHint(input, pathHint);
    if (match) {
      return match;
    }
  }

  return null;
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
  const includeShareHeader = context.command === 'share' || context.command === 'links';

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

  if (includeShareHeader) {
    if (context.command === 'links') {
      await sendDomainMessage(context, 'jobs', 'Use <code>/share</code> going forward.', {
        disableLinkPreview: true,
      });
    }
    await sendDomainMessage(
      context,
      'jobs',
      formatShareJobHeader(job, {
        assignmentTitle: sharePayload.assignmentTitle,
      }),
      {
        disableLinkPreview: true,
      },
    );
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

export async function executeBackupAction(context: CommandContext, label?: string): Promise<void> {
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

export function createCommandRegistry(args?: {
  replayStore?: ApprovalReplayStore;
}): CommandRegistry {
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
        await (isPrivateChatContext(context)
          ? sendDirectMessage(context, html)
          : sendDomainMessage(context, 'ops', html));
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
        await sendDomainMessage(context, 'ops', view.html, {
          replyMarkup: view.replyMarkup,
        });
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
        await sendDomainMessage(context, 'ops', view.html, {
          replyMarkup: view.replyMarkup,
        });
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
        await sendDomainMessage(context, 'jobs', view.html, {
          replyMarkup: view.replyMarkup,
        });
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
        await sendDomainMessage(context, 'jobs', view.html, {
          replyMarkup: view.replyMarkup,
        });
      },
    },
    {
      command: 'links',
      description: 'Compatibility alias for /share (/links <jobId>)',
      domain: 'jobs',
      async execute(context) {
        await sendShareableJobLinks(context, context.args[0]);
      },
    },
    {
      command: 'share',
      description: 'Send the student package (/share <jobId>)',
      domain: 'jobs',
      async execute(context) {
        await sendShareableJobLinks(context, context.args[0]);
      },
    },
    {
      command: 'students',
      description: 'Browse students by recent activity',
      domain: 'jobs',
      async execute(context) {
        const view = await loadStudentsView(context, 0);
        await sendDomainMessage(context, 'jobs', view.html, {
          replyMarkup: view.replyMarkup,
        });
      },
    },
    {
      command: 'student',
      description: 'Show one student summary (/student <name-or-id>)',
      domain: 'jobs',
      async execute(context) {
        const query = context.args.join(' ').trim();
        if (!query) {
          await sendDomainMessage(
            context,
            'jobs',
            formatCommandError(
              'Usage: /student <name-or-id>\nExamples: /student Margarita or /student 72444fdf',
            ),
          );
          return;
        }
        const resolved = await resolveStudentQuery(context, query);
        if (resolved.status === 'none') {
          await sendDomainMessage(context, 'jobs', formatStudentNotFound(query));
          return;
        }
        if (resolved.status === 'multiple') {
          await sendDomainMessage(
            context,
            'jobs',
            formatStudentDisambiguation({
              query,
              matches: resolved.matches.slice(0, 5),
              footer: 'Select the exact student below.',
            }),
            {
              replyMarkup: buildStudentDisambiguationKeyboard(resolved.matches),
            },
          );
          return;
        }
        const view = await loadStudentView(context, resolved.matches[0]!.id);
        await sendDomainMessage(context, 'jobs', view.html, {
          replyMarkup: view.replyMarkup,
        });
      },
    },
    {
      command: 'jobs',
      description: 'Browse jobs (/jobs [filters])',
      domain: 'jobs',
      async execute(context) {
        const raw = context.args.join(' ').trim();
        if (!raw) {
          const browseView = await loadJobsViewFromKey(context, 'gr');
          await sendDomainMessage(context, 'jobs', browseView.html, {
            replyMarkup: browseView.replyMarkup,
          });
          return;
        }
        const parsed = parseJobsFilterInput(raw);
        if ('error' in parsed) {
          await sendDomainMessage(context, 'jobs', formatCommandError(parsed.error));
          return;
        }
        const view = await loadJobsView(context, parsed, {
          title: 'Jobs',
          keyboardScope: 'global',
        });
        await sendDomainMessage(context, 'jobs', view.html, {
          replyMarkup: view.replyMarkup,
        });
      },
    },
    {
      command: 'today',
      description: 'Show today job dashboard in UTC',
      domain: 'jobs',
      async execute(context) {
        const view = await loadTodayView(context);
        await sendDomainMessage(context, 'jobs', view.html, {
          replyMarkup: view.replyMarkup,
        });
      },
    },
    {
      command: 'botstatus',
      description: 'Show bot runtime + backend diagnostics',
      domain: 'ops',
      async execute(context) {
        const view = await loadBotStatusView(context);
        await sendDomainMessage(context, 'ops', view.html);
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
