import {
  executeBackupAction,
  executeDrillAction,
  loadFinishedJobsView,
  loadJobDetailsView,
  loadOperationDetailsView,
  loadOpsStatusView,
  loadRecentOpsView,
  renderGuidedActionConfirmation,
  renderGuidedActionSubmitted,
  renderGuidedHome,
  sendShareableJobLinks,
} from './commands.js';
import { decodeGuidedCallback } from './guided-callbacks.js';
import type {
  BotDomain,
  CommandContext,
  CommandDefinition,
  TelegramInlineKeyboardMarkup,
} from './types.js';

const CONFIRM_GUARD_TTL_MS = 30_000;
const guidedConfirmGuards = new Map<string, number>();

export function resetGuidedConfirmGuardsForTests(): void {
  guidedConfirmGuards.clear();
}

export type GuidedCallbackHandleResult =
    | {
      kind: 'render';
      domain: BotDomain;
      html: string;
      replyMarkup?: TelegramInlineKeyboardMarkup;
      disableLinkPreview?: boolean;
    }
  | {
      kind: 'noop';
    };

export async function handleGuidedCallback(args: {
  data: string;
  context: CommandContext;
  commands: CommandDefinition[];
}): Promise<GuidedCallbackHandleResult | null> {
  const action = decodeGuidedCallback(args.data);
  if (!action) {
    return null;
  }

  switch (action.kind) {
    case 'home': {
      const view = await renderGuidedHome(withCommand(args.context, 'help'), args.commands);
      return {
        kind: 'render',
        domain: 'ops',
        html: view.html,
        replyMarkup: view.replyMarkup,
      };
    }
    case 'status': {
      const view = await loadOpsStatusView(withCommand(args.context, 'status'));
      return {
        kind: 'render',
        domain: 'ops',
        html: view.html,
        replyMarkup: view.replyMarkup,
      };
    }
    case 'finished': {
      const view = await loadFinishedJobsView(withCommand(args.context, 'finished'));
      return {
        kind: 'render',
        domain: 'jobs',
        html: view.html,
        replyMarkup: view.replyMarkup,
      };
    }
    case 'recent_ops': {
      const view = await loadRecentOpsView(withCommand(args.context, 'help'));
      return {
        kind: 'render',
        domain: 'ops',
        html: view.html,
        replyMarkup: view.replyMarkup,
      };
    }
    case 'job': {
      const view = await loadJobDetailsView(withCommand(args.context, 'job', [action.jobId]), action.jobId);
      return {
        kind: 'render',
        domain: 'jobs',
        html: view.html,
        replyMarkup: view.replyMarkup,
      };
    }
    case 'op': {
      const view = await loadOperationDetailsView(
        withCommand(args.context, 'op', [action.operationId]),
        action.operationId,
      );
      return {
        kind: 'render',
        domain: 'ops',
        html: view.html,
        replyMarkup: view.replyMarkup,
      };
    }
    case 'job_links': {
      await sendShareableJobLinks(
        withCommand(args.context, 'links', [action.jobId], { clearThread: true }),
        action.jobId,
      );
      return { kind: 'noop' };
    }
    case 'job_share': {
      await sendShareableJobLinks(
        withCommand(args.context, 'share', [action.jobId], { clearThread: true }),
        action.jobId,
      );
      return { kind: 'noop' };
    }
    case 'action': {
      const view = renderGuidedActionConfirmation(
        withCommand(args.context, action.action),
        action.action,
      );
      return {
        kind: 'render',
        domain: 'ops',
        html: view.html,
        replyMarkup: view.replyMarkup,
      };
    }
    case 'confirm': {
      const actionContext = withCommand(args.context, action.action);
      const confirmKey = buildConfirmGuardKey(actionContext, action.action);
      const nowMs = Date.now();
      pruneExpiredConfirmGuards(nowMs);
      if (!guidedConfirmGuards.has(confirmKey)) {
        guidedConfirmGuards.set(confirmKey, nowMs + CONFIRM_GUARD_TTL_MS);
        try {
          await (action.action === 'backup' ? executeBackupAction(actionContext) : executeDrillAction(actionContext));
        } catch (error: unknown) {
          guidedConfirmGuards.delete(confirmKey);
          throw error;
        }
      }
      const view = renderGuidedActionSubmitted(actionContext, action.action);
      return {
        kind: 'render',
        domain: 'ops',
        html: view.html,
        replyMarkup: view.replyMarkup,
      };
    }
  }
}

function withCommand(
  context: CommandContext,
  command: string,
  args: string[] = [],
  options?: {
    clearThread?: boolean;
  },
): CommandContext {
  const message = options?.clearThread
    ? ({
        ...context.message,
        message_thread_id: undefined,
      } as CommandContext['message'])
    : context.message;
  return {
    ...context,
    message,
    command,
    args,
  };
}

function buildConfirmGuardKey(context: CommandContext, action: 'backup' | 'drill'): string {
  return `${context.message.chat.id}:${context.message.message_id}:${action}`;
}

function pruneExpiredConfirmGuards(nowMs: number): void {
  for (const [key, expiresAtMs] of guidedConfirmGuards.entries()) {
    if (expiresAtMs <= nowMs) {
      guidedConfirmGuards.delete(key);
    }
  }
}
