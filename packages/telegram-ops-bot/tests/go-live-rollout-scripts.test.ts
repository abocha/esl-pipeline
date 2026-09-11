import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const preflightModulePath = '../../../scripts/release/telegram-ops-go-live-preflight.mjs';
const verifyModulePath = '../../../scripts/release/telegram-ops-go-live-verify.mjs';
const gatesModulePath = '../../../scripts/release/telegram-ops-go-live-gates.mjs';
const preflightModuleUrl = new URL(preflightModulePath, import.meta.url).href;
const verifyModuleUrl = new URL(verifyModulePath, import.meta.url).href;
const gatesModuleUrl = new URL(gatesModulePath, import.meta.url).href;

function basePreflightEnv(): Record<string, string> {
  return {
    TELEGRAM_OPS_BOT_ENABLED: 'true',
    TELEGRAM_OPS_BOT_MODE: 'polling',
    TELEGRAM_OPS_BOT_SKIP_PENDING_UPDATES_ON_STARTUP: 'true',
    TELEGRAM_OPS_BOT_BACKEND_URL: 'http://batch-backend:8080',
    TELEGRAM_OPS_BOT_BACKEND_EMAIL: 'ops-bot@example.com',
    TELEGRAM_OPS_BOT_BACKEND_PASSWORD: 'secret',
    TELEGRAM_OPS_BOT_ALLOWED_USER_IDS: '12345678',
    BATCH_BACKEND_ENABLE_OPS_CONTROL: 'true',
    BATCH_BACKEND_OPS_CONTROL_BOT_SECRET: 'shared-secret',
    TELEGRAM_OPS_BOT_BACKEND_SHARED_SECRET: 'shared-secret',
    TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS: 'false',
  };
}

describe('telegram go-live preflight script', () => {
  it('fails readonly_canary profile when action commands are enabled', async () => {
    const { runPreflight } = (await import(preflightModuleUrl)) as {
      runPreflight: (args: Record<string, unknown>) => Promise<{
        report: {
          checks: { id: string; passed: boolean }[];
        };
        exitCode: number;
      }>;
    };

    const result = await runPreflight({
      profile: 'readonly_canary',
      env: {
        ...basePreflightEnv(),
        TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS: 'true',
      },
      runCommand: async (args: { args: string[] }) => {
        if (args.args.includes('db:status')) {
          return {
            command: 'pnpm --filter @esl-pipeline/batch-backend db:status',
            exitCode: 0,
            stdout: 'Pending migrations: 0\n',
            stderr: '',
            failedToStart: null,
          };
        }
        return {
          command: 'pnpm --filter @esl-pipeline/batch-backend db:verify',
          exitCode: 0,
          stdout: 'Migration verification passed.\n',
          stderr: '',
          failedToStart: null,
        };
      },
      probeOpsActionsTable: async () => ({
        available: true,
        exists: true,
        warning: null,
      }),
      jsonOutPath: path.join(tmpdir(), `preflight-${Date.now()}.json`),
    });

    expect(result.exitCode).toBe(1);
    const readonlyCheck = result.report.checks.find(
      (check) => check.id === 'readonly_action_commands_disabled',
    );
    expect(readonlyCheck?.passed).toBe(false);
  });

  it('writes stable JSON artifact shape for successful preflight', async () => {
    const { runPreflight } = (await import(preflightModuleUrl)) as {
      runPreflight: (args: Record<string, unknown>) => Promise<{
        report: {
          artifactPath: string;
          summary: { passed: boolean };
        };
        exitCode: number;
      }>;
    };

    const dir = await mkdtemp(path.join(tmpdir(), 'telegram-preflight-artifact-'));
    const jsonOutPath = path.join(dir, 'preflight.json');

    const result = await runPreflight({
      profile: 'readonly_canary',
      env: basePreflightEnv(),
      runCommand: async (args: { args: string[] }) => {
        if (args.args.includes('db:status')) {
          return {
            command: 'pnpm --filter @esl-pipeline/batch-backend db:status',
            exitCode: 0,
            stdout: 'Pending migrations: 0\n',
            stderr: '',
            failedToStart: null,
          };
        }
        return {
          command: 'pnpm --filter @esl-pipeline/batch-backend db:verify',
          exitCode: 0,
          stdout: 'Migration verification passed.\n',
          stderr: '',
          failedToStart: null,
        };
      },
      probeOpsActionsTable: async () => ({
        available: true,
        exists: true,
        warning: null,
      }),
      jsonOutPath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.report.summary.passed).toBe(true);

    const artifact = JSON.parse(await readFile(result.report.artifactPath, 'utf8')) as {
      kind: string;
      version: number;
      summary: { passed: boolean };
      checks: { id: string }[];
      commands: Record<string, unknown>;
    };
    expect(artifact.kind).toBe('telegram_ops_go_live_preflight');
    expect(artifact.version).toBe(1);
    expect(artifact.summary.passed).toBe(true);
    expect(Array.isArray(artifact.checks)).toBe(true);
    expect(artifact.checks.some((check) => check.id === 'db_status_command')).toBe(true);
    expect(artifact.commands).toEqual(
      expect.objectContaining({
        dbStatus: expect.any(Object),
        dbVerify: expect.any(Object),
      }),
    );
  });

  it('requires strict leader-election DB config when leader election is enabled', async () => {
    const { evaluateLeaderElectionDbConfig, runPreflight, buildBackendPgClientConfig } =
      (await import(preflightModuleUrl)) as {
        evaluateLeaderElectionDbConfig: (env: Record<string, string>) => {
          passed: boolean;
          source: string | null;
          missingTupleKeys: string[];
        };
        buildBackendPgClientConfig: (env: Record<string, string>) => Record<string, unknown> | null;
        runPreflight: (args: Record<string, unknown>) => Promise<{
          report: {
            checks: { id: string; passed: boolean; details?: Record<string, unknown> }[];
          };
          exitCode: number;
        }>;
      };

    expect(
      evaluateLeaderElectionDbConfig({
        TELEGRAM_OPS_BOT_APPROVAL_REPLAY_DATABASE_URL: 'postgresql://replay-only',
      }).passed,
    ).toBe(false);
    expect(
      evaluateLeaderElectionDbConfig({
        PG_HOST: 'postgres',
        PG_USER: 'esl',
      }),
    ).toEqual(
      expect.objectContaining({
        passed: false,
        source: null,
        missingTupleKeys: expect.arrayContaining(['PG_PORT', 'PG_PASSWORD', 'PG_DATABASE']),
      }),
    );
    expect(
      evaluateLeaderElectionDbConfig({
        TELEGRAM_OPS_BOT_LEADER_ELECTION_DATABASE_URL: 'postgresql://leader',
      }).passed,
    ).toBe(true);
    expect(
      evaluateLeaderElectionDbConfig({
        PG_HOST: 'postgres',
        PG_PORT: '5432',
        PG_USER: 'esl',
        PG_PASSWORD: 'esl',
        PG_DATABASE: 'esl_batch',
      }),
    ).toEqual(
      expect.objectContaining({
        passed: true,
        source: 'pg_tuple',
      }),
    );

    expect(
      buildBackendPgClientConfig({
        TELEGRAM_OPS_BOT_LEADER_ELECTION_DATABASE_URL: 'postgresql://leader-only',
      }),
    ).toBeNull();
    expect(
      buildBackendPgClientConfig({
        TELEGRAM_OPS_BOT_LEADER_ELECTION_DATABASE_URL: 'postgresql://leader',
        PG_CONNECTION_STRING: 'postgresql://backend',
      }),
    ).toEqual(
      expect.objectContaining({
        connectionString: 'postgresql://backend',
      }),
    );

    const result = await runPreflight({
      profile: 'readonly_canary',
      env: {
        ...basePreflightEnv(),
        TELEGRAM_OPS_BOT_LEADER_ELECTION_ENABLED: 'true',
        TELEGRAM_OPS_BOT_APPROVAL_REPLAY_DATABASE_URL: 'postgresql://replay-only',
      },
      runCommand: async (args: { args: string[] }) => {
        if (args.args.includes('db:status')) {
          return {
            command: 'pnpm --filter @esl-pipeline/batch-backend db:status',
            exitCode: 0,
            stdout: 'Pending migrations: 0\n',
            stderr: '',
            failedToStart: null,
          };
        }
        return {
          command: 'pnpm --filter @esl-pipeline/batch-backend db:verify',
          exitCode: 0,
          stdout: 'Migration verification passed.\n',
          stderr: '',
          failedToStart: null,
        };
      },
      probeOpsActionsTable: async () => ({
        available: true,
        exists: true,
        warning: null,
      }),
      jsonOutPath: path.join(tmpdir(), `preflight-leader-${Date.now()}.json`),
    });

    expect(result.exitCode).toBe(1);
    const leaderCheck = result.report.checks.find(
      (check) => check.id === 'leader_election_db_config',
    );
    expect(leaderCheck?.passed).toBe(false);
    expect(leaderCheck?.details).toEqual(
      expect.objectContaining({
        approvalReplayDatabaseUrlConfigured: true,
      }),
    );
  });

  it('fails allowed-user validation when any token is non-numeric', async () => {
    const { runPreflight } = (await import(preflightModuleUrl)) as {
      runPreflight: (args: Record<string, unknown>) => Promise<{
        report: {
          checks: { id: string; passed: boolean; details?: Record<string, unknown> }[];
        };
        exitCode: number;
      }>;
    };

    const result = await runPreflight({
      profile: 'readonly_canary',
      env: {
        ...basePreflightEnv(),
        TELEGRAM_OPS_BOT_ALLOWED_USER_IDS: '12345678,abc,999',
      },
      runCommand: async (args: { args: string[] }) => {
        if (args.args.includes('db:status')) {
          return {
            command: 'pnpm --filter @esl-pipeline/batch-backend db:status',
            exitCode: 0,
            stdout: 'Pending migrations: 0\n',
            stderr: '',
            failedToStart: null,
          };
        }
        return {
          command: 'pnpm --filter @esl-pipeline/batch-backend db:verify',
          exitCode: 0,
          stdout: 'Migration verification passed.\n',
          stderr: '',
          failedToStart: null,
        };
      },
      probeOpsActionsTable: async () => ({
        available: true,
        exists: true,
        warning: null,
      }),
      jsonOutPath: path.join(tmpdir(), `preflight-users-${Date.now()}.json`),
    });

    expect(result.exitCode).toBe(1);
    const check = result.report.checks.find((item) => item.id === 'allowed_user_ids');
    expect(check?.passed).toBe(false);
    expect(check?.details).toEqual(
      expect.objectContaining({
        invalidTokens: ['abc'],
      }),
    );
  });
});

describe('telegram go-live verify script', () => {
  it('validates ops contract responses and secret enforcement', async () => {
    const { runVerification } = (await import(verifyModuleUrl)) as {
      runVerification: (args: Record<string, unknown>) => Promise<{
        report: {
          checks: { id: string; passed: boolean }[];
        };
        exitCode: number;
      }>;
    };

    const fetchFn = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = new Headers(init?.headers ?? {});

      if (method === 'POST' && url.endsWith('/auth/login')) {
        return Response.json({ accessToken: 'token-123' }, { status: 200 });
      }

      if (method === 'GET' && url.endsWith('/ops/status')) {
        const authHeader = headers.get('authorization');
        if (authHeader !== 'Bearer token-123') {
          return Response.json({ error: 'unauthorized' }, { status: 401 });
        }

        const secret = headers.get('x-ops-bot-secret');
        if (!secret || secret !== 'shared-secret') {
          return Response.json(
            {
              error: 'forbidden',
              code: 'ops_bot_secret_invalid',
            },
            { status: 403 },
          );
        }

        return Response.json(
          {
            checkedAtUtc: '2026-03-13T00:00:00.000Z',
            overall: {
              state: 'healthy',
              reasons: [],
            },
          },
          { status: 200 },
        );
      }

      if (method === 'GET' && url.includes('/ops/actions/verify-missing-')) {
        return Response.json(
          {
            error: 'not_found',
            code: 'ops_action_not_found',
          },
          { status: 404 },
        );
      }

      if (method === 'GET' && url.endsWith('/ops/actions/op-200')) {
        return Response.json(
          {
            operationId: 'op-200',
            state: 'running',
          },
          { status: 200 },
        );
      }

      return new Response('not found', { status: 404 });
    };

    const result = await runVerification({
      env: {},
      backendUrl: 'http://localhost:8080',
      email: 'ops-bot@example.com',
      password: 'secret',
      sharedSecret: 'shared-secret',
      operationId: 'op-200',
      fetchFn,
      jsonOutPath: path.join(tmpdir(), `verify-${Date.now()}.json`),
    });

    expect(result.exitCode).toBe(0);
    expect(
      result.report.checks.find((check) => check.id === 'ops_status_success_shape')?.passed,
    ).toBe(true);
    expect(
      result.report.checks.find((check) => check.id === 'ops_secret_enforcement_missing_header')
        ?.passed,
    ).toBe(true);
    expect(
      result.report.checks.find((check) => check.id === 'ops_secret_enforcement_wrong_header')
        ?.passed,
    ).toBe(true);
    expect(
      result.report.checks.find((check) => check.id === 'ops_action_not_found_semantics')?.passed,
    ).toBe(true);
    expect(
      result.report.checks.find((check) => check.id === 'operation_id_lookup_available')?.passed,
    ).toBe(true);
  });

  it('writes stable JSON artifact shape for verify reports', async () => {
    const { runVerification } = (await import(verifyModuleUrl)) as {
      runVerification: (args: Record<string, unknown>) => Promise<{
        report: {
          artifactPath: string;
          summary: { passed: boolean };
        };
        exitCode: number;
      }>;
    };

    const dir = await mkdtemp(path.join(tmpdir(), 'telegram-verify-artifact-'));
    const jsonOutPath = path.join(dir, 'verify.json');
    const fetchFn = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && url.endsWith('/auth/login')) {
        return Response.json({ accessToken: 'token-123' }, { status: 200 });
      }
      if (method === 'GET' && url.endsWith('/ops/status')) {
        return Response.json(
          {
            checkedAtUtc: '2026-03-13T00:00:00.000Z',
            overall: { state: 'healthy', reasons: [] },
          },
          { status: 200 },
        );
      }
      if (method === 'GET' && url.includes('/ops/actions/verify-missing-')) {
        return Response.json(
          {
            error: 'not_found',
            code: 'ops_action_not_found',
          },
          { status: 404 },
        );
      }
      return new Response('not found', { status: 404 });
    };

    const result = await runVerification({
      env: {},
      backendUrl: 'http://localhost:8080',
      email: 'ops-bot@example.com',
      password: 'secret',
      fetchFn,
      jsonOutPath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.report.summary.passed).toBe(true);

    const artifact = JSON.parse(await readFile(result.report.artifactPath, 'utf8')) as {
      kind: string;
      version: number;
      summary: { passed: boolean };
      checks: { id: string }[];
      traces: Record<string, unknown>;
    };
    expect(artifact.kind).toBe('telegram_ops_go_live_verify');
    expect(artifact.version).toBe(1);
    expect(artifact.summary.passed).toBe(true);
    expect(Array.isArray(artifact.checks)).toBe(true);
    expect(artifact.checks.some((check) => check.id === 'auth_login_success')).toBe(true);
    expect(artifact.traces).toEqual(expect.objectContaining({ login: expect.any(Object) }));
  });

  it('normalizes compose backend hostname for host-run verification calls', async () => {
    const { runVerification } = (await import(verifyModuleUrl)) as {
      runVerification: (args: Record<string, unknown>) => Promise<{
        exitCode: number;
      }>;
    };

    const calledUrls: string[] = [];
    const fetchFn = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      calledUrls.push(url);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && url.endsWith('/auth/login')) {
        return Response.json({ accessToken: 'token-123' }, { status: 200 });
      }
      if (method === 'GET' && url.endsWith('/ops/status')) {
        return Response.json(
          {
            checkedAtUtc: '2026-03-13T00:00:00.000Z',
            overall: { state: 'healthy', reasons: [] },
          },
          { status: 200 },
        );
      }
      if (method === 'GET' && url.includes('/ops/actions/verify-missing-')) {
        return Response.json({ error: 'not_found', code: 'ops_action_not_found' }, { status: 404 });
      }
      return new Response('not found', { status: 404 });
    };

    const result = await runVerification({
      env: {
        TELEGRAM_OPS_BOT_BACKEND_URL: 'http://batch-backend:8080',
        TELEGRAM_OPS_BOT_BACKEND_EMAIL: 'ops-bot@example.com',
        TELEGRAM_OPS_BOT_BACKEND_PASSWORD: 'secret',
      },
      fetchFn,
      jsonOutPath: path.join(tmpdir(), `verify-host-${Date.now()}.json`),
    });

    expect(result.exitCode).toBe(0);
    expect(calledUrls[0]).toContain('http://127.0.0.1:8080/auth/login');
  });

  it('does not double-read malformed JSON responses', async () => {
    const { runVerification } = (await import(verifyModuleUrl)) as {
      runVerification: (args: Record<string, unknown>) => Promise<{
        report: {
          checks: { id: string; passed: boolean }[];
          traces: { opsStatus?: { body?: string } };
        };
        exitCode: number;
      }>;
    };

    const fetchFn = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && url.endsWith('/auth/login')) {
        return Response.json({ accessToken: 'token-123' }, { status: 200 });
      }
      if (method === 'GET' && url.endsWith('/ops/status')) {
        return new Response('{invalid json', {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        });
      }
      if (method === 'GET' && url.includes('/ops/actions/verify-missing-')) {
        return Response.json({ error: 'not_found', code: 'ops_action_not_found' }, { status: 404 });
      }
      return new Response('not found', { status: 404 });
    };

    const result = await runVerification({
      env: {
        TELEGRAM_OPS_BOT_BACKEND_URL: 'http://localhost:8080',
        TELEGRAM_OPS_BOT_BACKEND_EMAIL: 'ops-bot@example.com',
        TELEGRAM_OPS_BOT_BACKEND_PASSWORD: 'secret',
      },
      fetchFn,
      jsonOutPath: path.join(tmpdir(), `verify-malformed-${Date.now()}.json`),
    });

    expect(result.exitCode).toBe(1);
    expect(
      result.report.checks.find((check) => check.id === 'ops_status_success_shape')?.passed,
    ).toBe(false);
    expect(result.report.traces.opsStatus?.body).toContain('{invalid json');
  });
});

describe('telegram go-live gates script', () => {
  it('runs canonical gate sequence with temp env normalization', async () => {
    const { runGates, GATE_STEPS } = (await import(gatesModuleUrl)) as {
      GATE_STEPS: { id: string }[];
      runGates: (args: Record<string, unknown>) => Promise<{
        report: {
          summary: { passed: boolean; executed: number };
        };
        exitCode: number;
      }>;
    };

    const seenCommands: string[] = [];
    let seenTmpDir = '';
    let seenTmp = '';
    let seenTemp = '';
    const result = await runGates({
      env: {},
      jsonOutPath: path.join(tmpdir(), `gates-${Date.now()}.json`),
      runStep: (
        step: { id: string; command: string; args: string[] },
        env: Record<string, string>,
      ) => {
        seenCommands.push(step.id);
        seenTmpDir = env.TMPDIR || '';
        seenTmp = env.TMP || '';
        seenTemp = env.TEMP || '';
        return {
          id: step.id,
          command: `${step.command} ${step.args.join(' ')}`,
          exitCode: 0,
          stdout: '',
          stderr: '',
          failedToStart: null,
        };
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.report.summary.passed).toBe(true);
    expect(result.report.summary.executed).toBe(GATE_STEPS.length);
    expect(GATE_STEPS.map((step) => step.id)).toEqual([
      'telegram_ops_bot_tests',
      'integration_tests',
      'compose_smoke',
      'preflight_readonly_canary',
    ]);
    expect(GATE_STEPS.some((step) => step.id === 'check_fast')).toBe(false);
    expect(seenCommands).toEqual(GATE_STEPS.map((step) => step.id));
    const expectedTmpRoot = process.platform === 'linux' ? '/tmp' : seenTmpDir;
    const expectedTmp = process.platform === 'linux' ? '/tmp' : seenTmp;
    const expectedTemp = process.platform === 'linux' ? '/tmp' : seenTemp;
    expect(seenTmpDir).toBe(expectedTmpRoot);
    expect(seenTmp).toBe(expectedTmp);
    expect(seenTemp).toBe(expectedTemp);
  });
});
