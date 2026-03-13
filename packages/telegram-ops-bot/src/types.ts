import type { Message, Update } from '@grammyjs/types';

import type {
  JobListResponse,
  JobStatusDto,
  OpsActionListResponse,
  OpsActionRequest,
  OpsActionStatus,
  OpsStatusResponse,
} from '@esl-pipeline/contracts';

export type BotDomain = 'ops' | 'jobs' | 'alerts';
export type BotMode = 'polling' | 'webhook';

export interface BotConfig {
  enabled: boolean;
  token: string;
  apiBaseUrl: string;
  mode: BotMode;
  webhookHost: string;
  webhookPort: number;
  webhookPath: string;
  webhookSecretToken?: string;
  chatId: string;
  backendBaseUrl: string;
  backendEmail: string;
  backendPassword: string;
  backendTimeoutMs: number;
  backendSharedSecret?: string;
  leaderElectionEnabled: boolean;
  allowedUserIds: Set<number>;
  pollIntervalMs: number;
  pollTimeoutSeconds: number;
  commandWindowMs: number;
  maxCommandsPerWindow: number;
  enableActionCommands: boolean;
  skipPendingUpdatesOnStartup: boolean;
  topicAutoCreate: boolean;
  defaultThreadId?: number;
  topicsStateFile: string;
  topicNames: Record<BotDomain, string>;
  appBaseUrl?: string;
}

export interface BotAuditEvent {
  level: 'info' | 'warn' | 'error';
  event: string;
  message: string;
  command?: string;
  commandArgs?: string[];
  userId?: number;
  chatId?: string;
  threadId?: number;
  operationId?: string;
  details?: Record<string, unknown>;
}

export interface AuditLogger {
  log: (entry: BotAuditEvent) => void;
}

export interface BackendClient {
  getOpsStatus: () => Promise<OpsStatusResponse>;
  enqueueOpsAction: (payload: OpsActionRequest) => Promise<OpsActionStatus>;
  getOpsActionStatus: (operationId: string) => Promise<OpsActionStatus>;
  listOpsActions: (limit: number, offset?: number) => Promise<OpsActionListResponse>;
  getFinishedJobs: (limit: number) => Promise<JobListResponse>;
  getJob: (jobId: string) => Promise<JobStatusDto>;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramMessenger {
  sendHtmlMessage: (args: {
    chatId: string;
    threadId?: number;
    domain?: BotDomain;
    html: string;
    disableLinkPreview?: boolean;
    replyMarkup?: TelegramInlineKeyboardMarkup;
  }) => Promise<Message.TextMessage>;
}

export interface TopicRouter {
  initialize: () => Promise<void>;
  resolveThreadId: (args: { domain: BotDomain; incomingThreadId?: number }) => number | undefined;
  healStaleThread: (args: { domain: BotDomain; staleThreadId: number }) => Promise<number | undefined>;
}

export interface PollLeaderElection {
  isLeader: () => Promise<boolean>;
  close: () => Promise<void>;
}

export interface CommandContext {
  config: BotConfig;
  backend: BackendClient;
  messenger: TelegramMessenger;
  topicRouter: TopicRouter;
  audit: AuditLogger;
  update: Update;
  message: Message.TextMessage;
  fromUserId: number;
  command: string;
  args: string[];
}

export interface CommandDefinition {
  command: string;
  description: string;
  domain: BotDomain;
  execute: (context: CommandContext) => Promise<void>;
}

export interface ParsedCommand {
  command: string;
  args: string[];
  mentionedBot: string | null;
}
