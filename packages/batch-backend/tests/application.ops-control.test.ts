import { beforeEach, describe, expect, it, vi } from 'vitest';

async function withEnv(env: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const oldEnv = { ...process.env };
  process.env = { ...process.env, PG_ENABLED: 'false', ...env };
  try {
    await fn();
  } finally {
    process.env = oldEnv;
  }
}

async function loadOpsControlFresh() {
  const module = await import('../src/application/ops-control.js');
  module.resetOpsControlStateForTests();
  return module;
}

async function waitForTerminalActionStatus(
  ops: Awaited<ReturnType<typeof loadOpsControlFresh>>,
  operationId: string,
  timeoutMs = 12_000,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const current = await ops.getOpsActionStatus(operationId);
    if (current && (current.state === 'succeeded' || current.state === 'failed')) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for terminal state for operation ${operationId}`);
}

describe('application/ops-control', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('normalizes status JSON from command output', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        BATCH_BACKEND_ENABLE_OPS_CONTROL: 'true',
        BATCH_BACKEND_OPS_CONTROL_STATUS_COMMAND: 'echo status',
      },
      async () => {
        const ops = await loadOpsControlFresh();
        ops.setOpsControlDependenciesForTests({
          now: () => new Date('2026-03-11T00:00:00.000Z'),
          runCommand: async () => ({
            exitCode: 0,
            stdout: JSON.stringify({
              checkedAtUtc: '2026-03-11T00:00:00Z',
              overall: {
                state: 'healthy',
                reasons: [],
              },
              thresholds: {
                backupMaxAgeHours: 26,
                drillMaxAgeDays: 35,
                keyRotationMaxAgeDays: 80,
              },
              backup: {
                state: 'healthy',
                reason: 'ok',
                latestDumpKey: 's3://x.dump',
                lastModifiedUtc: '2026-03-10T23:00:00Z',
                ageHours: 1,
              },
              restoreDrill: {
                state: 'healthy',
                reason: 'ok',
                lastReportUtc: '2026-03-01T00:00:00Z',
                ageDays: 10,
                reportStatus: 'ok',
                reportMode: 'auto_download_only',
                latestRemoteDumpKey: 'key.dump',
                drillResult: 'auto_download_only_ok',
              },
              keyRotation: {
                state: 'healthy',
                reason: 'ok',
                iamUser: 'ops-user',
                oldestAccessKeyId: 'AKIA...',
                oldestCreatedUtc: '2026-01-01T00:00:00Z',
                oldestAgeDays: 30,
                oldestLastUsedUtc: '2026-03-10T00:00:00Z',
              },
            }),
            stderr: '',
            timedOut: false,
          }),
        });

        const status = await ops.getOpsStatus();
        expect(status.overall.state).toBe('healthy');
        expect(status.backup.latestDumpKey).toBe('s3://x.dump');
        expect(status.restoreDrill.drillResult).toBe('auto_download_only_ok');
      },
    );
  });

  it('returns failure payload when status command fails', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        BATCH_BACKEND_ENABLE_OPS_CONTROL: 'true',
      },
      async () => {
        const ops = await loadOpsControlFresh();
        ops.setOpsControlDependenciesForTests({
          now: () => new Date('2026-03-11T00:00:00.000Z'),
          runCommand: async () => ({
            exitCode: 1,
            stdout: '',
            stderr: 'boom',
            timedOut: false,
          }),
        });

        const status = await ops.getOpsStatus();
        expect(status.overall.state).toBe('critical');
        expect(status.overall.reasons[0]).toContain('Status command failed');
      },
    );
  });

  it('queues and executes backup action with label', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        BATCH_BACKEND_ENABLE_OPS_CONTROL: 'true',
        BATCH_BACKEND_OPS_CONTROL_BACKUP_COMMAND: 'echo backup',
      },
      async () => {
        const commands: string[] = [];
        const ops = await loadOpsControlFresh();
        ops.setOpsControlDependenciesForTests({
          randomId: () => 'op-1',
          now: () => new Date('2026-03-11T00:00:00.000Z'),
          runCommand: async (command) => {
            commands.push(command);
            return {
              exitCode: 0,
              stdout: 'done',
              stderr: '',
              timedOut: false,
            };
          },
        });

        const queued = await ops.enqueueOpsAction(
          { action: 'backup_upload', label: 'nightly smoke' },
          { requestedBy: 'telegram:42', requestedByUserId: 'user-1' },
        );

        expect(queued.state).toBe('queued');
        expect(commands).toHaveLength(0);

        await new Promise((resolve) => setTimeout(resolve, 0));

        const completed = await ops.getOpsActionStatus('op-1');
        expect(completed?.state).toBe('succeeded');
        expect(completed?.stdoutTail).toBe('done');
        expect(commands[0]).toBe("echo backup 'nightly smoke'");
      },
    );
  });

  it('enforces optional bot secret', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        BATCH_BACKEND_ENABLE_OPS_CONTROL: 'true',
        BATCH_BACKEND_OPS_CONTROL_BOT_SECRET: 'shared-secret',
      },
      async () => {
        const ops = await loadOpsControlFresh();
        expect(ops.shouldRequireOpsBotSecret()).toBe(true);
        expect(ops.isValidOpsBotSecret('shared-secret')).toBe(true);
        expect(ops.isValidOpsBotSecret('nope')).toBe(false);
      },
    );
  });

  it('surfaces actionable failure details when shell runner cannot launch', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        BATCH_BACKEND_ENABLE_OPS_CONTROL: 'true',
        BATCH_BACKEND_OPS_CONTROL_STATUS_COMMAND: 'echo "{}"',
        PATH: '/__missing_path__',
      },
      async () => {
        const ops = await loadOpsControlFresh();
        const status = await ops.getOpsStatus();
        expect(status.overall.state).toBe('critical');
        expect(status.overall.reasons[0]).toContain('Failed to launch command runner');
        expect(status.overall.reasons[0]).toContain('Ensure bash is installed');
      },
    );
  });

  it('escalates timed out commands from TERM to KILL and marks action failed', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        BATCH_BACKEND_ENABLE_OPS_CONTROL: 'true',
        BATCH_BACKEND_OPS_CONTROL_ACTION_TIMEOUT_MS: '1000',
        BATCH_BACKEND_OPS_CONTROL_RESTORE_DRILL_COMMAND: "trap '' TERM; sleep 30",
      },
      async () => {
        const ops = await loadOpsControlFresh();
        ops.setOpsControlDependenciesForTests({
          randomId: () => 'timeout-op',
        });

        const startedAt = Date.now();
        await ops.enqueueOpsAction(
          { action: 'restore_drill_download_only' },
          { requestedBy: 'telegram:42', requestedByUserId: 'user-1' },
        );

        const completed = await waitForTerminalActionStatus(ops, 'timeout-op', 10_000);
        const elapsedMs = Date.now() - startedAt;

        expect(completed.state).toBe('failed');
        expect(completed.message).toContain('timed out after 1000ms');
        expect(completed.exitCode).toBe(124);
        expect(elapsedMs).toBeLessThan(10_000);
      },
    );
  });

  it('does not evict queued/running actions when history limit is exceeded', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        BATCH_BACKEND_ENABLE_OPS_CONTROL: 'true',
        BATCH_BACKEND_OPS_CONTROL_BACKUP_COMMAND: 'echo backup',
        BATCH_BACKEND_OPS_CONTROL_ACTION_HISTORY_LIMIT: '1',
      },
      async () => {
        const commands: string[] = [];
        const pendingResolves: ((value: {
          exitCode: number;
          stdout: string;
          stderr: string;
          timedOut: boolean;
        }) => void)[] = [];
        const ids = ['op-1', 'op-2'];

        const ops = await loadOpsControlFresh();
        ops.setOpsControlDependenciesForTests({
          randomId: () => ids.shift() ?? 'op-fallback',
          runCommand: async (command) => {
            commands.push(command);
            return new Promise((resolve) => {
              pendingResolves.push(resolve);
            });
          },
        });

        await ops.enqueueOpsAction(
          { action: 'backup_upload', label: 'one' },
          { requestedBy: 'telegram:42', requestedByUserId: 'user-1' },
        );
        await ops.enqueueOpsAction(
          { action: 'backup_upload', label: 'two' },
          { requestedBy: 'telegram:42', requestedByUserId: 'user-1' },
        );

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(await ops.getOpsActionStatus('op-1')).not.toBeNull();
        expect(await ops.getOpsActionStatus('op-2')).not.toBeNull();

        for (const resolve of pendingResolves) {
          resolve({
            exitCode: 0,
            stdout: 'done',
            stderr: '',
            timedOut: false,
          });
        }

        await waitForTerminalActionStatus(ops, 'op-2');

        expect(commands).toContain("echo backup 'one'");
        expect(commands).toContain("echo backup 'two'");
      },
    );
  });

  it('refreshes action status from persisted storage before serving cached copy', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        BATCH_BACKEND_ENABLE_OPS_CONTROL: 'true',
      },
      async () => {
        const ops = await loadOpsControlFresh();
        let readCount = 0;
        const persistedStatus = {
          operationId: 'persisted-op',
          action: 'backup_upload' as const,
          state: 'succeeded' as const,
          requestedAt: '2026-03-11T00:00:00.000Z',
          startedAt: '2026-03-11T00:00:05.000Z',
          finishedAt: '2026-03-11T00:00:10.000Z',
          requestedBy: 'telegram:42',
          requestedByUserId: 'user-1',
          message: 'Action completed successfully',
          command: 'echo backup',
          exitCode: 0,
          stdoutTail: 'done',
          stderrTail: null,
        };

        ops.setOpsControlDependenciesForTests({
          isPersistenceEnabled: () => true,
          readPersistedAction: async () => {
            readCount += 1;
            return persistedStatus;
          },
        });

        const first = await ops.getOpsActionStatus('persisted-op');
        const second = await ops.getOpsActionStatus('persisted-op');

        expect(first).toEqual(persistedStatus);
        expect(second).toEqual(persistedStatus);
        expect(readCount).toBe(2);
      },
    );
  });

  it('persists terminal snapshot via fallback upsert after finalize retries and avoids replay after restart', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        BATCH_BACKEND_ENABLE_OPS_CONTROL: 'true',
        BATCH_BACKEND_OPS_CONTROL_ACTION_TIMEOUT_MS: '1000',
        BATCH_BACKEND_OPS_CONTROL_BACKUP_COMMAND: 'echo backup',
      },
      async () => {
        const commands: string[] = [];
        let finalizeAttempts = 0;
        let upsertCalls = 0;
        const queuedAction = {
          operationId: 'op-finalize-failure',
          action: 'backup_upload' as const,
          state: 'queued' as const,
          requestedAt: '2026-03-11T00:00:00.000Z',
          startedAt: null,
          finishedAt: null,
          requestedBy: 'telegram:42',
          requestedByUserId: 'user-1',
          message: 'Action queued',
          command: "echo backup 'finalize-failure'",
          exitCode: null,
          stdoutTail: null,
          stderrTail: null,
        };
        const runningAction = {
          ...queuedAction,
          state: 'running' as const,
          startedAt: '2026-03-11T00:00:01.000Z',
          message: 'Action started',
        };
        let persistedAction: any = { ...queuedAction };

        const ops = await loadOpsControlFresh();
        ops.setOpsControlDependenciesForTests({
          randomId: () => 'op-finalize-failure',
          isPersistenceEnabled: () => true,
          upsertPersistedAction: async (action) => {
            upsertCalls += 1;
            persistedAction = { ...action };
            return persistedAction;
          },
          claimPersistedActionOwnership: async () => {
            persistedAction = { ...runningAction };
            return persistedAction;
          },
          listResumablePersistedActions: async () =>
            persistedAction.state === 'queued' || persistedAction.state === 'running'
              ? [persistedAction]
              : [],
          finalizeOwnedPersistedAction: async () => {
            finalizeAttempts += 1;
            throw new Error('transient pg failure during finalize');
          },
          readPersistedAction: async () => persistedAction,
          runCommand: async (command) => {
            commands.push(command);
            return {
              exitCode: 0,
              stdout: 'done',
              stderr: '',
              timedOut: false,
            };
          },
        });

        await ops.enqueueOpsAction(
          { action: 'backup_upload', label: 'finalize-failure' },
          { requestedBy: 'telegram:42', requestedByUserId: 'user-1' },
        );
        const terminal = await waitForTerminalActionStatus(ops, 'op-finalize-failure');
        expect(terminal.state).toBe('succeeded');
        expect(finalizeAttempts).toBe(3);
        expect(upsertCalls).toBeGreaterThanOrEqual(2);
        expect(persistedAction.state).toBe('succeeded');
        expect(persistedAction.finishedAt).not.toBeNull();

        vi.resetModules();
        const restartedOps = await loadOpsControlFresh();
        restartedOps.setOpsControlDependenciesForTests({
          isPersistenceEnabled: () => true,
          listResumablePersistedActions: async () =>
            persistedAction.state === 'queued' || persistedAction.state === 'running'
              ? [persistedAction]
              : [],
          claimPersistedActionOwnership: async () => null,
          readPersistedAction: async () => persistedAction,
          runCommand: async (command) => {
            commands.push(command);
            return {
              exitCode: 0,
              stdout: 'done',
              stderr: '',
              timedOut: false,
            };
          },
        });
        await restartedOps.resumePersistedOpsActionsOnStartup();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(commands).toEqual(["echo backup 'finalize-failure'"]);
      },
    );
  });

  it('keeps terminal snapshot in memory when finalize and fallback upsert both fail', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        BATCH_BACKEND_ENABLE_OPS_CONTROL: 'true',
        BATCH_BACKEND_OPS_CONTROL_ACTION_TIMEOUT_MS: '1000',
        BATCH_BACKEND_OPS_CONTROL_BACKUP_COMMAND: 'echo backup',
      },
      async () => {
        const commands: string[] = [];
        let persistedAction: any = {
          operationId: 'op-fallback-failure',
          action: 'backup_upload' as const,
          state: 'queued' as const,
          requestedAt: '2026-03-11T00:00:00.000Z',
          startedAt: null,
          finishedAt: null,
          requestedBy: 'telegram:42',
          requestedByUserId: 'user-1',
          message: 'Action queued',
          command: "echo backup 'fallback-failure'",
          exitCode: null,
          stdoutTail: null,
          stderrTail: null,
        };
        const runningAction = {
          ...persistedAction,
          state: 'running' as const,
          startedAt: '2026-03-11T00:00:01.000Z',
          message: 'Action started',
        };

        const ops = await loadOpsControlFresh();
        ops.setOpsControlDependenciesForTests({
          randomId: () => 'op-fallback-failure',
          isPersistenceEnabled: () => true,
          upsertPersistedAction: async (action) => {
            if (action.state === 'queued') {
              persistedAction = { ...action };
              return persistedAction;
            }
            throw new Error('upsert unavailable');
          },
          claimPersistedActionOwnership: async () => {
            persistedAction = { ...runningAction };
            return persistedAction;
          },
          listResumablePersistedActions: async () => [persistedAction],
          finalizeOwnedPersistedAction: async () => {
            throw new Error('finalize unavailable');
          },
          readPersistedAction: async () => persistedAction,
          runCommand: async (command) => {
            commands.push(command);
            return {
              exitCode: 0,
              stdout: 'done',
              stderr: '',
              timedOut: false,
            };
          },
        });

        await ops.enqueueOpsAction(
          { action: 'backup_upload', label: 'fallback-failure' },
          { requestedBy: 'telegram:42', requestedByUserId: 'user-1' },
        );
        const terminal = await waitForTerminalActionStatus(ops, 'op-fallback-failure');
        expect(terminal.state).toBe('succeeded');

        await ops.resumePersistedOpsActionsOnStartup();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(commands).toEqual(["echo backup 'fallback-failure'"]);
      },
    );
  });

  it('does not execute queued action when ownership claim is denied', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        BATCH_BACKEND_ENABLE_OPS_CONTROL: 'true',
        BATCH_BACKEND_OPS_CONTROL_BACKUP_COMMAND: 'echo backup',
      },
      async () => {
        const commands: string[] = [];
        const queuedStatus = {
          operationId: 'claim-op',
          action: 'backup_upload' as const,
          state: 'queued' as const,
          requestedAt: '2026-03-11T00:00:00.000Z',
          startedAt: null,
          finishedAt: null,
          requestedBy: 'telegram:42',
          requestedByUserId: 'user-1',
          message: 'Action queued',
          command: "echo backup 'nightly'",
          exitCode: null,
          stdoutTail: null,
          stderrTail: null,
        };

        const ops = await loadOpsControlFresh();
        ops.setOpsControlDependenciesForTests({
          randomId: () => 'claim-op',
          isPersistenceEnabled: () => true,
          upsertPersistedAction: async () => queuedStatus,
          claimPersistedActionOwnership: async () => null,
          readPersistedAction: async () => queuedStatus,
          runCommand: async (command) => {
            commands.push(command);
            return {
              exitCode: 0,
              stdout: 'done',
              stderr: '',
              timedOut: false,
            };
          },
        });

        const queued = await ops.enqueueOpsAction(
          { action: 'backup_upload', label: 'nightly' },
          { requestedBy: 'telegram:42', requestedByUserId: 'user-1' },
        );
        expect(queued.state).toBe('queued');

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(commands).toHaveLength(0);
        const status = await ops.getOpsActionStatus('claim-op');
        expect(status?.state).toBe('queued');
      },
    );
  });

  it('resumes persisted queued actions on startup and drives them to terminal state', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        BATCH_BACKEND_ENABLE_OPS_CONTROL: 'true',
        BATCH_BACKEND_OPS_CONTROL_ACTION_TIMEOUT_MS: '1000',
      },
      async () => {
        const commands: string[] = [];
        const resumableAction = {
          operationId: 'resume-op-1',
          action: 'backup_upload' as const,
          state: 'queued' as const,
          requestedAt: '2026-03-11T00:00:00.000Z',
          startedAt: null,
          finishedAt: null,
          requestedBy: 'telegram:42',
          requestedByUserId: 'user-1',
          message: 'Action queued',
          command: "echo backup 'resume'",
          exitCode: null,
          stdoutTail: null,
          stderrTail: null,
        };
        const claimedAction = {
          ...resumableAction,
          state: 'running' as const,
          startedAt: '2026-03-11T00:00:01.000Z',
          message: 'Action started',
        };
        const finalizedAction = {
          ...claimedAction,
          state: 'succeeded' as const,
          finishedAt: '2026-03-11T00:00:02.000Z',
          message: 'Action completed successfully',
          exitCode: 0,
          stdoutTail: 'done',
        };

        const ops = await loadOpsControlFresh();
        ops.setOpsControlDependenciesForTests({
          isPersistenceEnabled: () => true,
          listResumablePersistedActions: async () => [resumableAction],
          claimPersistedActionOwnership: async () => claimedAction,
          finalizeOwnedPersistedAction: async () => finalizedAction,
          readPersistedAction: async () => null,
          runCommand: async (command) => {
            commands.push(command);
            return {
              exitCode: 0,
              stdout: 'done',
              stderr: '',
              timedOut: false,
            };
          },
        });

        await ops.resumePersistedOpsActionsOnStartup();
        const terminal = await waitForTerminalActionStatus(ops, 'resume-op-1');

        expect(commands).toEqual(["echo backup 'resume'"]);
        expect(terminal.state).toBe('succeeded');
        expect(terminal.stdoutTail).toBe('done');
      },
    );
  });
});
