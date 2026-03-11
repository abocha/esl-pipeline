import { beforeEach, describe, expect, it, vi } from 'vitest';

async function withEnv(env: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const oldEnv = { ...process.env };
  process.env = { ...process.env, ...env };
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

        const completed = ops.getOpsActionStatus('op-1');
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
});
