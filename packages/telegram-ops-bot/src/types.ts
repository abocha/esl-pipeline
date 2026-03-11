import type {
  JobListResponse,
  JobStatusDto,
  OpsActionRequest,
  OpsActionStatus,
  OpsStatusResponse,
} from '@esl-pipeline/contracts';
import type { Message, Update } from '@grammyjs/types';

export type BotDomain = 'ops' | 'jobs' | 'alerts';

export interface BotConfig {
  enabled: boolean;
  token: string;
  chatId: string;
  backendBaseUrl: string;
  backendEmail: string;
  backendPassword: string;
  backendTimeoutMs: number;
  backendSharedSecret?: string;
  allowedUserIds: Set<number>;
  pollIntervalMs: number;
  pollTimeoutSeconds: number;
  commandWindowMs: number;
  maxCommandsPerWindow: number;
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
  getFinishedJobs: (limit: number) => Promise<JobListResponse>;
  getJob: (jobId: string) => Promise<JobStatusDto>;
}

export interface TelegramMessenger {
  sendHtmlMessage: (args: { chatId: string; threadId?: number; html: string }) => Promise<void>;
}

export interface TopicRouter {
  initialize: () => Promise<void>;
  resolveThreadId: (args: { domain: BotDomain; incomingThreadId?: number }) => number | undefined;
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
