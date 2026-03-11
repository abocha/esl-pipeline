import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type {
  OpsActionRequest,
  OpsActionStatus,
  OpsHealthState,
  OpsStatusResponse,
} from '@esl-pipeline/contracts';

import { loadConfig } from '../config/env.js';

const STDOUT_STDERR_MAX_BYTES = 256 * 1024;
const OUTPUT_TAIL_MAX_CHARS = 3000;

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
}

interface EnqueueOptions {
  requestedBy: string | null;
  requestedByUserId: string | null;
}

type InternalActionStatus = OpsActionStatus;

const dependencies: OpsControlDependencies = {
  now: () => new Date(),
  randomId: () => randomUUID(),
  runCommand: (command, timeoutMs) => runShellCommand(command, timeoutMs),
};

const actionStore = new Map<string, InternalActionStatus>();
const actionOrder: string[] = [];

export function setOpsControlDependenciesForTests(overrides: Partial<OpsControlDependencies>): void {
  Object.assign(dependencies, overrides);
}

export function resetOpsControlStateForTests(): void {
  actionStore.clear();
  actionOrder.length = 0;
  dependencies.now = () => new Date();
  dependencies.randomId = () => randomUUID();
  dependencies.runCommand = (command, timeoutMs) => runShellCommand(command, timeoutMs);
}

export function isOpsControlEnabled(): boolean {
  const config = loadConfig();
  return config.opsControl.enabled;
}

export function assertOpsControlEnabled(): void {
  if (!isOpsControlEnabled()) {
    throw new Error('Ops control is disabled. Set BATCH_BACKEND_ENABLE_OPS_CONTROL=true to enable /ops endpoints.');
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

  storeAction(initial, config.opsControl.actionHistoryLimit);

  setImmediate(() => {
    void runQueuedAction(operationId, command, config.opsControl.actionTimeoutMs);
  });

  return { ...initial };
}

export function getOpsActionStatus(operationId: string): OpsActionStatus | null {
  const found = actionStore.get(operationId);
  if (!found) return null;
  return { ...found };
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
      throw new Error(`Unsupported ops action: ${(request as { action?: unknown }).action as string}`);
    }
  }
}

function shellEscape(value: string): string {
  const escapedSingleQuote = String.raw`'\''`;
  return `'${value.replaceAll("'", escapedSingleQuote)}'`;
}

async function runQueuedAction(operationId: string, command: string, timeoutMs: number): Promise<void> {
  const queued = actionStore.get(operationId);
  if (!queued) return;

  updateAction(operationId, {
    state: 'running',
    startedAt: dependencies.now().toISOString(),
    message: 'Action started',
  });

  const result = await dependencies.runCommand(command, timeoutMs);

  const successful = result.exitCode === 0 && !result.timedOut;
  updateAction(operationId, {
    state: successful ? 'succeeded' : 'failed',
    finishedAt: dependencies.now().toISOString(),
    message: successful
      ? 'Action completed successfully'
      : result.timedOut
        ? `Action timed out after ${timeoutMs}ms`
        : `Action failed with exit code ${result.exitCode}`,
    exitCode: result.exitCode,
    stdoutTail: tailOutput(result.stdout),
    stderrTail: tailOutput(result.stderr),
  });
}

function updateAction(operationId: string, patch: Partial<InternalActionStatus>): void {
  const existing = actionStore.get(operationId);
  if (!existing) return;
  actionStore.set(operationId, {
    ...existing,
    ...patch,
  });
}

function storeAction(action: InternalActionStatus, maxActions: number): void {
  actionStore.set(action.operationId, action);
  actionOrder.push(action.operationId);

  while (actionOrder.length > maxActions) {
    const evicted = actionOrder.shift();
    if (!evicted) continue;
    actionStore.delete(evicted);
  }
}

function tailOutput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= OUTPUT_TAIL_MAX_CHARS) return trimmed;
  return trimmed.slice(-OUTPUT_TAIL_MAX_CHARS);
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
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn('bash', ['-lc', command], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 2000).unref();
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
      clearTimeout(timer);
      const errorMessage = error instanceof Error ? error.message : String(error);
      resolve({
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n${errorMessage}`.trim(),
        timedOut,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}
