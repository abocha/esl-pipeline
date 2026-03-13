import { type ChildProcessByStdio, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

import type {
  OpsActionListResponse,
  OpsActionRequest,
  OpsActionStatus,
  OpsHealthState,
  OpsStatusResponse,
} from '@esl-pipeline/contracts';

import { loadConfig } from '../config/env.js';
import {
  claimQueuedOpsActionOwnership,
  finalizeOwnedOpsAction,
  getOpsActionStatusByOperationId,
  listOpsActions as listPersistedOpsActions,
  listResumableOpsActions,
  pruneOpsActionHistoryByFinishedAt,
  upsertOpsActionStatus,
  type ClaimOpsActionOwnershipParams,
  type FinalizeOwnedOpsActionParams,
} from '../domain/ops-action-repository.js';
import { logger } from '../infrastructure/logger.js';

const STDOUT_STDERR_MAX_BYTES = 256 * 1024;
const OUTPUT_TAIL_MAX_CHARS = 3000;
const TERM_TO_KILL_GRACE_MS = 2000;
const ACTION_OWNER_GRACE_MS = 60_000;
const ACTION_RETENTION_PRUNE_BATCH_SIZE = 100;
const ACTION_RETENTION_PRUNE_MAX_BATCHES_PER_PASS = 5;
const ACTION_RETENTION_PRUNE_INTERVAL_MS = 60_000;
const ACTION_RETENTION_MS_PER_DAY = 24 * 60 * 60 * 1000;
const ACTION_RESUME_SWEEP_INTERVAL_MS = 30_000;
const ACTION_FINALIZE_RETRY_ATTEMPTS = 3;
const ACTION_FINALIZE_RETRY_DELAY_MS = 250;
const ACTION_FALLBACK_UPSERT_RETRY_ATTEMPTS = 3;
const ACTION_FALLBACK_UPSERT_RETRY_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RunCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface OpsControlDependencies {
  now: () => Date;
  randomId: () => string;
  runCommand: (command: string, timeoutMs: number) => Promise<RunCommandResult>;
  ownerId: () => string;
  isPersistenceEnabled: () => boolean;
  upsertPersistedAction: (action: InternalActionStatus) => Promise<InternalActionStatus>;
  readPersistedAction: (operationId: string) => Promise<InternalActionStatus | null>;
  listPersistedActions: (args: { limit: number; offset: number }) => Promise<OpsActionListResponse>;
  claimPersistedActionOwnership: (
    params: ClaimOpsActionOwnershipParams,
  ) => Promise<InternalActionStatus | null>;
  listResumablePersistedActions: (args: {
    now: Date;
    limit: number;
  }) => Promise<InternalActionStatus[]>;
  finalizeOwnedPersistedAction: (
    params: FinalizeOwnedOpsActionParams,
  ) => Promise<InternalActionStatus | null>;
  prunePersistedActions: (before: Date, limit: number) => Promise<number>;
}

interface EnqueueOptions {
  requestedBy: string | null;
  requestedByUserId: string | null;
}

type InternalActionStatus = OpsActionStatus;

const ownerId = `ops-control:${process.pid}:${randomUUID()}`;

const dependencies: OpsControlDependencies = {
  now: () => new Date(),
  randomId: () => randomUUID(),
  runCommand: (command, timeoutMs) => runShellCommand(command, timeoutMs),
  ownerId: () => ownerId,
  isPersistenceEnabled: () => loadConfig().pg.enabled,
  upsertPersistedAction: async (action) => upsertOpsActionStatus(action),
  readPersistedAction: async (operationId) => getOpsActionStatusByOperationId(operationId),
  listPersistedActions: async ({ limit, offset }) => listPersistedOpsActions({ limit, offset }),
  claimPersistedActionOwnership: async (params) => claimQueuedOpsActionOwnership(params),
  listResumablePersistedActions: async ({ now, limit }) => listResumableOpsActions({ now, limit }),
  finalizeOwnedPersistedAction: async (params) => finalizeOwnedOpsAction(params),
  prunePersistedActions: async (before, limit) =>
    pruneOpsActionHistoryByFinishedAt({ before, limit }),
};

const actionStore = new Map<string, InternalActionStatus>();
const actionOrder: string[] = [];
let retentionPruneInFlight = false;
let lastRetentionPruneStartedAtMs = 0;
let persistedActionResumeInFlight = false;
let persistedActionResumeSweepTimer: ReturnType<typeof setInterval> | null = null;

export function setOpsControlDependenciesForTests(
  overrides: Partial<OpsControlDependencies>,
): void {
  Object.assign(dependencies, overrides);
}

export function resetOpsControlStateForTests(): void {
  actionStore.clear();
  actionOrder.length = 0;
  retentionPruneInFlight = false;
  lastRetentionPruneStartedAtMs = 0;
  persistedActionResumeInFlight = false;
  if (persistedActionResumeSweepTimer) {
    clearInterval(persistedActionResumeSweepTimer);
  }
  persistedActionResumeSweepTimer = null;
  dependencies.now = () => new Date();
  dependencies.randomId = () => randomUUID();
  dependencies.runCommand = (command, timeoutMs) => runShellCommand(command, timeoutMs);
  dependencies.ownerId = () => ownerId;
  dependencies.isPersistenceEnabled = () => loadConfig().pg.enabled;
  dependencies.upsertPersistedAction = async (action) => upsertOpsActionStatus(action);
  dependencies.readPersistedAction = async (operationId) => getOpsActionStatusByOperationId(operationId);
  dependencies.listPersistedActions = async ({ limit, offset }) =>
    listPersistedOpsActions({ limit, offset });
  dependencies.claimPersistedActionOwnership = async (params) =>
    claimQueuedOpsActionOwnership(params);
  dependencies.listResumablePersistedActions = async ({ now, limit }) =>
    listResumableOpsActions({ now, limit });
  dependencies.finalizeOwnedPersistedAction = async (params) => finalizeOwnedOpsAction(params);
  dependencies.prunePersistedActions = async (before, limit) =>
    pruneOpsActionHistoryByFinishedAt({ before, limit });
}

export function isOpsControlEnabled(): boolean {
  const config = loadConfig();
  return config.opsControl.enabled;
}

export function assertOpsControlEnabled(): void {
  if (!isOpsControlEnabled()) {
    throw new Error(
      'Ops control is disabled. Set BATCH_BACKEND_ENABLE_OPS_CONTROL=true to enable /ops endpoints.',
    );
  }
}

export function shouldRequireOpsBotSecret(): boolean {
  const config = loadConfig();
  return Boolean(config.opsControl.botSharedSecret?.trim());
}

export function isValidOpsBotSecret(secret: string | null | undefined): boolean {
  const config = loadConfig();
  const expected = config.opsControl.botSharedSecret?.trim();
  if (!expected) return true;
  return secret?.trim() === expected;
}

export async function getOpsStatus(): Promise<OpsStatusResponse> {
  assertOpsControlEnabled();
  const config = loadConfig();

  const statusCommand = config.opsControl.statusCommand;
  const result = await dependencies.runCommand(statusCommand, config.opsControl.actionTimeoutMs);
  if (result.exitCode !== 0) {
    return buildStatusFailureResponse(
      `Status command failed (${result.exitCode}). ${tailOutput(result.stderr) || tailOutput(result.stdout)}`,
      dependencies.now(),
    );
  }

  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    return normalizeOpsStatusResponse(parsed, dependencies.now());
  } catch {
    return buildStatusFailureResponse(
      `Status command returned invalid JSON. ${tailOutput(result.stdout) || 'no output'}`,
      dependencies.now(),
    );
  }
}

export async function enqueueOpsAction(
  request: OpsActionRequest,
  options: EnqueueOptions,
): Promise<OpsActionStatus> {
  assertOpsControlEnabled();
  const config = loadConfig();

  const operationId = dependencies.randomId();
  const requestedAt = dependencies.now().toISOString();
  const command = resolveActionCommand(request);

  const initial: InternalActionStatus = {
    operationId,
    action: request.action,
    state: 'queued',
    requestedAt,
    startedAt: null,
    finishedAt: null,
    requestedBy: options.requestedBy,
    requestedByUserId: options.requestedByUserId,
    message: 'Action queued',
    command,
    exitCode: null,
    stdoutTail: null,
    stderrTail: null,
  };

  let queued = initial;
  if (dependencies.isPersistenceEnabled()) {
    queued = await dependencies.upsertPersistedAction(initial);
  }
  storeAction(queued, config.opsControl.actionHistoryLimit);
  void maybePrunePersistedActions(config.opsControl.actionRetentionDays);

  setImmediate(() => {
    void runQueuedAction(
      operationId,
      command,
      config.opsControl.actionTimeoutMs,
      config.opsControl.actionHistoryLimit,
      config.opsControl.actionRetentionDays,
    );
  });

  return { ...queued };
}

export async function resumePersistedOpsActionsOnStartup(): Promise<void> {
  const config = loadConfig();
  if (!config.opsControl.enabled || !dependencies.isPersistenceEnabled()) {
    return;
  }
  if (!persistedActionResumeSweepTimer) {
    persistedActionResumeSweepTimer = setInterval(() => {
      void resumePersistedOpsActionsOnStartup();
    }, ACTION_RESUME_SWEEP_INTERVAL_MS);
    persistedActionResumeSweepTimer.unref?.();
  }
  if (persistedActionResumeInFlight) {
    return;
  }

  persistedActionResumeInFlight = true;
  try {
    const resumable = await dependencies.listResumablePersistedActions({
      now: dependencies.now(),
      limit: config.opsControl.actionHistoryLimit,
    });
    for (const action of resumable) {
      const existing = actionStore.get(action.operationId);
      if (existing && isTerminalActionState(existing.state)) {
        logger.warn('Skipping resumable action because local state is already terminal', {
          event: 'ops_action_resume_skipped_terminal_cache',
          operationId: action.operationId,
          cachedState: existing.state,
          persistedState: action.state,
        });
        continue;
      }
      storeAction(action, config.opsControl.actionHistoryLimit);
      setImmediate(() => {
        void runQueuedAction(
          action.operationId,
          action.command,
          config.opsControl.actionTimeoutMs,
          config.opsControl.actionHistoryLimit,
          config.opsControl.actionRetentionDays,
        );
      });
    }

    if (resumable.length > 0) {
      logger.info('Resumed persisted ops actions on startup', {
        event: 'ops_action_resume_startup',
        resumedCount: resumable.length,
      });
    }
  } catch (error: unknown) {
    logger.error('Failed to resume persisted ops actions on startup', {
      event: 'ops_action_resume_startup_failed',
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    persistedActionResumeInFlight = false;
  }
}

export async function getOpsActionStatus(operationId: string): Promise<OpsActionStatus | null> {
  const cached = actionStore.get(operationId);
  if (!dependencies.isPersistenceEnabled()) {
    return cached ? { ...cached } : null;
  }

  const persisted = await dependencies.readPersistedAction(operationId);
  if (persisted) {
    const config = loadConfig();
    if (cached && isTerminalActionState(cached.state) && !isTerminalActionState(persisted.state)) {
      return { ...cached };
    }
    storeAction(persisted, config.opsControl.actionHistoryLimit);
    return { ...persisted };
  }

  return cached ? { ...cached } : null;
}

export async function listOpsActions(args?: {
  limit?: number;
  offset?: number;
}): Promise<OpsActionListResponse> {
  assertOpsControlEnabled();
  const config = loadConfig();
  const limit = normalizeActionListLimit(args?.limit);
  const offset = normalizeActionListOffset(args?.offset);

  if (dependencies.isPersistenceEnabled()) {
    const persisted = await dependencies.listPersistedActions({ limit, offset });
    for (const action of persisted.actions) {
      storeAction(action, config.opsControl.actionHistoryLimit);
    }
    return persisted;
  }

  const actions: InternalActionStatus[] = [];
  for (let index = actionOrder.length - 1; index >= 0; index -= 1) {
    const operationId = actionOrder[index];
    if (!operationId) {
      continue;
    }

    const action = actionStore.get(operationId);
    if (action) {
      actions.push(action);
    }
  }

  return {
    actions: actions.slice(offset, offset + limit).map((action) => ({ ...action })),
    total: actions.length,
    limit,
    offset,
  };
}

function resolveActionCommand(request: OpsActionRequest): string {
  const config = loadConfig();
  switch (request.action) {
    case 'backup_upload': {
      const label = request.label?.trim();
      if (!label) return config.opsControl.backupCommand;
      return `${config.opsControl.backupCommand} ${shellEscape(label)}`;
    }
    case 'restore_drill_download_only': {
      return config.opsControl.restoreDrillCommand;
    }
    default: {
      throw new Error(
        `Unsupported ops action: ${(request as { action?: unknown }).action as string}`,
      );
    }
  }
}

function shellEscape(value: string): string {
  const escapedSingleQuote = String.raw`'\''`;
  return `'${value.replaceAll("'", escapedSingleQuote)}'`;
}

async function runQueuedAction(
  operationId: string,
  command: string,
  timeoutMs: number,
  actionHistoryLimit: number,
  actionRetentionDays: number,
): Promise<void> {
  let queued = actionStore.get(operationId) ?? null;
  if (!queued && dependencies.isPersistenceEnabled()) {
    const persisted = await dependencies.readPersistedAction(operationId);
    if (persisted) {
      storeAction(persisted, actionHistoryLimit);
      queued = persisted;
    }
  }
  if (!queued) return;
  if (isTerminalActionState(queued.state)) return;

  let runningAction: InternalActionStatus | null = null;
  if (dependencies.isPersistenceEnabled()) {
    const startedAt = dependencies.now();
    const claimed = await dependencies.claimPersistedActionOwnership({
      operationId,
      ownerId: dependencies.ownerId(),
      startedAt,
      ownershipExpiresAt: new Date(startedAt.getTime() + timeoutMs + ACTION_OWNER_GRACE_MS),
      message: 'Action started',
    });
    if (!claimed) {
      const persisted = await dependencies.readPersistedAction(operationId);
      if (persisted) {
        storeAction(persisted, actionHistoryLimit);
      }
      return;
    }
    runningAction = claimed;
  } else {
    updateAction(operationId, {
      state: 'running',
      startedAt: dependencies.now().toISOString(),
      message: 'Action started',
    });
    runningAction = actionStore.get(operationId) ?? null;
  }
  if (!runningAction) return;

  storeAction(runningAction, actionHistoryLimit);

  const result = await dependencies.runCommand(command, timeoutMs);

  const successful = result.exitCode === 0 && !result.timedOut;
  const finishedAt = dependencies.now();
  const finishedMessage = successful
    ? 'Action completed successfully'
    : result.timedOut
      ? `Action timed out after ${timeoutMs}ms`
      : `Action failed with exit code ${result.exitCode}`;
  const finalizedState: Extract<InternalActionStatus['state'], 'succeeded' | 'failed'> = successful
    ? 'succeeded'
    : 'failed';

  const finishedPatch: Pick<
    InternalActionStatus,
    'state' | 'finishedAt' | 'message' | 'exitCode' | 'stdoutTail' | 'stderrTail'
  > = {
    state: finalizedState,
    finishedAt: finishedAt.toISOString(),
    message: finishedMessage,
    exitCode: result.exitCode,
    stdoutTail: tailOutput(result.stdout),
    stderrTail: tailOutput(result.stderr),
  };

  if (dependencies.isPersistenceEnabled()) {
    const finalizeParams: FinalizeOwnedOpsActionParams = {
      operationId,
      ownerId: dependencies.ownerId(),
      state: finalizedState,
      finishedAt,
      message: finishedMessage,
      exitCode: finishedPatch.exitCode,
      stdoutTail: finishedPatch.stdoutTail,
      stderrTail: finishedPatch.stderrTail,
    };
    try {
      const finalized = await finalizePersistedActionWithRetry(finalizeParams);
      if (finalized) {
        storeAction(finalized, actionHistoryLimit);
      } else {
        const persisted = await dependencies.readPersistedAction(operationId);
        if (persisted) {
          storeAction(persisted, actionHistoryLimit);
        }
      }
    } catch (error: unknown) {
      logger.error('Failed to finalize persisted ops action after retries; attempting terminal fallback upsert', {
        event: 'ops_action_finalize_retry_exhausted',
        operationId,
        error: error instanceof Error ? error.message : String(error),
      });

      const terminalSnapshot: InternalActionStatus = {
        ...runningAction,
        ...finishedPatch,
      };
      try {
        const fallbackPersisted = await upsertPersistedActionWithRetry(terminalSnapshot);
        logger.info('Persisted terminal ops action via fallback upsert after finalize failure', {
          event: 'ops_action_finalize_fallback_upsert_succeeded',
          operationId,
          state: fallbackPersisted.state,
        });
        storeAction(fallbackPersisted, actionHistoryLimit);
      } catch (fallbackError: unknown) {
        logger.error(
          'Failed to persist terminal ops action via fallback upsert; manual intervention required',
          {
            event: 'ops_action_finalize_fallback_upsert_failed',
            severity: 'critical',
            operationId,
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          },
        );
        storeAction(terminalSnapshot, actionHistoryLimit);
        return;
      }
    }
  } else {
    updateAction(operationId, finishedPatch, actionHistoryLimit);
  }
  void maybePrunePersistedActions(actionRetentionDays);
}

async function finalizePersistedActionWithRetry(
  params: FinalizeOwnedOpsActionParams,
): Promise<InternalActionStatus | null> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ACTION_FINALIZE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await dependencies.finalizeOwnedPersistedAction(params);
    } catch (error: unknown) {
      lastError = error;
      if (attempt < ACTION_FINALIZE_RETRY_ATTEMPTS) {
        await sleep(ACTION_FINALIZE_RETRY_DELAY_MS);
      }
    }
  }
  throw lastError;
}

async function upsertPersistedActionWithRetry(
  action: InternalActionStatus,
): Promise<InternalActionStatus> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ACTION_FALLBACK_UPSERT_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await dependencies.upsertPersistedAction(action);
    } catch (error: unknown) {
      lastError = error;
      if (attempt < ACTION_FALLBACK_UPSERT_RETRY_ATTEMPTS) {
        await sleep(ACTION_FALLBACK_UPSERT_RETRY_DELAY_MS);
      }
    }
  }
  throw lastError;
}

function updateAction(
  operationId: string,
  patch: Partial<InternalActionStatus>,
  actionHistoryLimit?: number,
): void {
  const existing = actionStore.get(operationId);
  if (!existing) return;
  actionStore.set(operationId, {
    ...existing,
    ...patch,
  });
  if (typeof actionHistoryLimit === 'number') {
    pruneActionHistory(actionHistoryLimit);
  }
}

function storeAction(action: InternalActionStatus, maxActions: number): void {
  if (!actionStore.has(action.operationId)) {
    actionOrder.push(action.operationId);
  }
  actionStore.set(action.operationId, action);
  pruneActionHistory(maxActions);
}

function isTerminalActionState(state: InternalActionStatus['state']): state is 'succeeded' | 'failed' {
  return state === 'succeeded' || state === 'failed';
}

async function maybePrunePersistedActions(retentionDays: number): Promise<void> {
  if (!dependencies.isPersistenceEnabled()) return;
  if (retentionDays <= 0) return;
  if (retentionPruneInFlight) return;

  const now = dependencies.now();
  const nowMs = now.getTime();
  if (nowMs - lastRetentionPruneStartedAtMs < ACTION_RETENTION_PRUNE_INTERVAL_MS) {
    return;
  }

  retentionPruneInFlight = true;
  lastRetentionPruneStartedAtMs = nowMs;
  const cutoff = new Date(nowMs - retentionDays * ACTION_RETENTION_MS_PER_DAY);

  try {
    for (let batchIndex = 0; batchIndex < ACTION_RETENTION_PRUNE_MAX_BATCHES_PER_PASS; batchIndex++) {
      const deleted = await dependencies.prunePersistedActions(
        cutoff,
        ACTION_RETENTION_PRUNE_BATCH_SIZE,
      );
      if (deleted < ACTION_RETENTION_PRUNE_BATCH_SIZE) {
        break;
      }
    }
  } catch (error: unknown) {
    logger.warn('Failed to prune ops action history', {
      event: 'ops_action_retention_prune_failed',
      error: error instanceof Error ? error.message : String(error),
      retentionDays,
    });
  } finally {
    retentionPruneInFlight = false;
  }
}

function isTerminalAction(action: InternalActionStatus): boolean {
  return action.state === 'succeeded' || action.state === 'failed';
}

function pruneActionHistory(maxActions: number): void {
  while (actionOrder.length > maxActions) {
    let evictIndex = -1;
    for (const [index, operationId] of actionOrder.entries()) {
      if (!operationId) continue;
      const action = actionStore.get(operationId);
      if (!action) {
        evictIndex = index;
        break;
      }
      if (isTerminalAction(action)) {
        evictIndex = index;
        break;
      }
    }

    // Keep non-terminal actions even when over limit; prune once actions become terminal.
    if (evictIndex < 0) {
      break;
    }

    const [evictedOperationId] = actionOrder.splice(evictIndex, 1);
    if (!evictedOperationId) continue;
    actionStore.delete(evictedOperationId);
  }
}

function tailOutput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= OUTPUT_TAIL_MAX_CHARS) return trimmed;
  return trimmed.slice(-OUTPUT_TAIL_MAX_CHARS);
}

function normalizeActionListLimit(value: number | undefined): number {
  if (!Number.isInteger(value)) {
    return 10;
  }
  const safeValue = value as number;
  return Math.max(1, Math.min(20, safeValue));
}

function normalizeActionListOffset(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return 0;
  }
  return value;
}

function normalizeHealthState(value: unknown): OpsHealthState {
  if (value === 'healthy' || value === 'degraded' || value === 'critical') {
    return value;
  }
  return 'degraded';
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function normalizeOpsStatusResponse(value: unknown, now: Date): OpsStatusResponse {
  const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const overall =
    obj.overall && typeof obj.overall === 'object' ? (obj.overall as Record<string, unknown>) : {};
  const thresholds =
    obj.thresholds && typeof obj.thresholds === 'object'
      ? (obj.thresholds as Record<string, unknown>)
      : {};
  const backup =
    obj.backup && typeof obj.backup === 'object' ? (obj.backup as Record<string, unknown>) : {};
  const restoreDrill =
    obj.restoreDrill && typeof obj.restoreDrill === 'object'
      ? (obj.restoreDrill as Record<string, unknown>)
      : {};
  const keyRotation =
    obj.keyRotation && typeof obj.keyRotation === 'object'
      ? (obj.keyRotation as Record<string, unknown>)
      : {};

  return {
    checkedAtUtc: asStringOrNull(obj.checkedAtUtc) ?? now.toISOString(),
    overall: {
      state: normalizeHealthState(overall.state),
      reasons: Array.isArray(overall.reasons)
        ? overall.reasons.filter((reason): reason is string => typeof reason === 'string')
        : [],
    },
    thresholds: {
      backupMaxAgeHours: asNumberOrNull(thresholds.backupMaxAgeHours),
      drillMaxAgeDays: asNumberOrNull(thresholds.drillMaxAgeDays),
      keyRotationMaxAgeDays: asNumberOrNull(thresholds.keyRotationMaxAgeDays),
    },
    backup: {
      state: normalizeHealthState(backup.state),
      reason: asStringOrNull(backup.reason) ?? 'unknown',
      latestDumpKey: asStringOrNull(backup.latestDumpKey),
      lastModifiedUtc: asStringOrNull(backup.lastModifiedUtc),
      ageHours: asNumberOrNull(backup.ageHours),
    },
    restoreDrill: {
      state: normalizeHealthState(restoreDrill.state),
      reason: asStringOrNull(restoreDrill.reason) ?? 'unknown',
      lastReportUtc: asStringOrNull(restoreDrill.lastReportUtc),
      ageDays: asNumberOrNull(restoreDrill.ageDays),
      reportStatus: asStringOrNull(restoreDrill.reportStatus),
      reportMode: asStringOrNull(restoreDrill.reportMode),
      latestRemoteDumpKey: asStringOrNull(restoreDrill.latestRemoteDumpKey),
      drillResult: asStringOrNull(restoreDrill.drillResult),
    },
    keyRotation: {
      state: normalizeHealthState(keyRotation.state),
      reason: asStringOrNull(keyRotation.reason) ?? 'unknown',
      iamUser: asStringOrNull(keyRotation.iamUser),
      oldestAccessKeyId: asStringOrNull(keyRotation.oldestAccessKeyId),
      oldestCreatedUtc: asStringOrNull(keyRotation.oldestCreatedUtc),
      oldestAgeDays: asNumberOrNull(keyRotation.oldestAgeDays),
      oldestLastUsedUtc: asStringOrNull(keyRotation.oldestLastUsedUtc),
    },
  };
}

function buildStatusFailureResponse(reason: string, now: Date): OpsStatusResponse {
  return {
    checkedAtUtc: now.toISOString(),
    overall: {
      state: 'critical',
      reasons: [reason],
    },
    thresholds: {
      backupMaxAgeHours: null,
      drillMaxAgeDays: null,
      keyRotationMaxAgeDays: null,
    },
    backup: {
      state: 'degraded',
      reason,
      latestDumpKey: null,
      lastModifiedUtc: null,
      ageHours: null,
    },
    restoreDrill: {
      state: 'degraded',
      reason,
      lastReportUtc: null,
      ageDays: null,
      reportStatus: null,
      reportMode: null,
      latestRemoteDumpKey: null,
      drillResult: null,
    },
    keyRotation: {
      state: 'degraded',
      reason,
      iamUser: null,
      oldestAccessKeyId: null,
      oldestCreatedUtc: null,
      oldestAgeDays: null,
      oldestLastUsedUtc: null,
    },
  };
}

function runShellCommand(command: string, timeoutMs: number): Promise<RunCommandResult> {
  return new Promise((resolve) => {
    const runnerCwd = process.env.PIPELINE_CWD?.trim() || process.cwd();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let hasExited = false;
    let settled = false;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let killEscalationTimer: NodeJS.Timeout | null = null;

    const finish = (result: RunCommandResult): void => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (killEscalationTimer) {
        clearTimeout(killEscalationTimer);
      }
      resolve(result);
    };

    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn('bash', ['-lc', command], {
        env: process.env,
        cwd: runnerCwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      finish({
        exitCode: 1,
        stdout,
        stderr: [
          stderr,
          errorMessage,
          'Failed to launch command runner. Ensure bash is installed and command exists.',
        ]
          .filter(Boolean)
          .join('\n')
          .trim(),
        timedOut,
      });
      return;
    }

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killEscalationTimer = setTimeout(() => {
        if (!hasExited) {
          child.kill('SIGKILL');
        }
      }, TERM_TO_KILL_GRACE_MS);
      killEscalationTimer.unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
      if (stdout.length > STDOUT_STDERR_MAX_BYTES) {
        stdout = stdout.slice(-STDOUT_STDERR_MAX_BYTES);
      }
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
      if (stderr.length > STDOUT_STDERR_MAX_BYTES) {
        stderr = stderr.slice(-STDOUT_STDERR_MAX_BYTES);
      }
    });

    child.on('error', (error) => {
      hasExited = true;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const launchHint =
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'Failed to launch command runner. Ensure bash is installed and command exists.'
          : 'Failed to launch command runner.';
      finish({
        exitCode: 1,
        stdout,
        stderr: [stderr, errorMessage, launchHint].filter(Boolean).join('\n').trim(),
        timedOut,
      });
    });

    child.on('close', (code, signal) => {
      hasExited = true;
      finish({
        exitCode: code ?? (timedOut ? 124 : 1),
        stdout,
        stderr: [stderr, signal ? `Process terminated by signal ${signal}.` : '']
          .filter(Boolean)
          .join('\n')
          .trim(),
        timedOut,
      });
    });
  });
}
