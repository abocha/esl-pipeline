import type { FastifyInstance } from 'fastify';

import * as opsControlModule from '../src/application/ops-control.js';
import { describeHttpServerIntegrationSuite } from './transport.http-server.integration.harness.js';

describeHttpServerIntegrationSuite(
  'transport/http-server - integration (in-process) [ops-control]',
  ({ createHttpServer, expect, it }) => {
    async function withOpsApp(
      env: Record<string, string | undefined>,
      run: (app: FastifyInstance) => Promise<void>,
    ) {
      const oldEnv = { ...process.env };
      process.env = {
        ...process.env,
        NODE_ENV: 'test',
        PG_ENABLED: 'false',
        BATCH_BACKEND_ENABLE_EXTENDED_API: 'true',
        BATCH_BACKEND_ENABLE_OPS_CONTROL: 'true',
        ...env,
      };

      opsControlModule.resetOpsControlStateForTests();
      const app = await createHttpServer();
      try {
        await run(app);
      } finally {
        await app.close();
        opsControlModule.resetOpsControlStateForTests();
        process.env = oldEnv;
      }
    }

    it('returns 404 when /ops routes are disabled', async () => {
      await withOpsApp(
        {
          BATCH_BACKEND_ENABLE_OPS_CONTROL: 'false',
        },
        async (app) => {
          const response = await app.inject({
            method: 'GET',
            url: '/ops/status',
          });

          expect(response.statusCode).toBe(404);
        },
      );
    });

    it('enforces x-ops-bot-secret when configured (missing/wrong/right)', async () => {
      await withOpsApp(
        {
          BATCH_BACKEND_OPS_CONTROL_BOT_SECRET: 'shared-secret',
        },
        async (app) => {
          opsControlModule.setOpsControlDependenciesForTests({
            runCommand: async () => ({
              exitCode: 0,
              stdout: JSON.stringify({
                checkedAtUtc: '2026-03-11T00:00:00.000Z',
                overall: { state: 'healthy', reasons: [] },
                thresholds: {
                  backupMaxAgeHours: null,
                  drillMaxAgeDays: null,
                  keyRotationMaxAgeDays: null,
                },
                backup: {
                  state: 'healthy',
                  reason: 'ok',
                  latestDumpKey: null,
                  lastModifiedUtc: null,
                  ageHours: null,
                },
                restoreDrill: {
                  state: 'healthy',
                  reason: 'ok',
                  lastReportUtc: null,
                  ageDays: null,
                  reportStatus: null,
                  reportMode: null,
                  latestRemoteDumpKey: null,
                  drillResult: null,
                },
                keyRotation: {
                  state: 'healthy',
                  reason: 'ok',
                  iamUser: null,
                  oldestAccessKeyId: null,
                  oldestCreatedUtc: null,
                  oldestAgeDays: null,
                  oldestLastUsedUtc: null,
                },
              }),
              stderr: '',
              timedOut: false,
            }),
          });

          const missing = await app.inject({
            method: 'GET',
            url: '/ops/status',
          });
          expect(missing.statusCode).toBe(403);
          expect(missing.json()).toEqual({
            error: 'forbidden',
            message: 'Missing or invalid x-ops-bot-secret header',
            code: 'ops_bot_secret_invalid',
          });

          const wrong = await app.inject({
            method: 'GET',
            url: '/ops/status',
            headers: {
              'x-ops-bot-secret': 'wrong-secret',
            },
          });
          expect(wrong.statusCode).toBe(403);
          expect(wrong.json()).toEqual({
            error: 'forbidden',
            message: 'Missing or invalid x-ops-bot-secret header',
            code: 'ops_bot_secret_invalid',
          });

          const right = await app.inject({
            method: 'GET',
            url: '/ops/status',
            headers: {
              'x-ops-bot-secret': 'shared-secret',
            },
          });
          expect(right.statusCode).toBe(200);
          expect(right.json()).toMatchObject({
            overall: {
              state: 'healthy',
            },
          });
        },
      );
    });

    it('returns stable 400 payload shape for invalid action payloads', async () => {
      await withOpsApp({}, async (app) => {
        const response = await app.inject({
          method: 'POST',
          url: '/ops/actions',
          payload: {
            action: 'backup_upload',
            label: '',
          },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({
          error: 'validation_failed',
          message: 'Invalid ops action payload',
          details: expect.any(Array),
        });
      });
    });

    it('returns 200 for /ops/status success path', async () => {
      await withOpsApp({}, async (app) => {
        opsControlModule.setOpsControlDependenciesForTests({
          runCommand: async () => ({
            exitCode: 0,
            stdout: JSON.stringify({
              checkedAtUtc: '2026-03-11T00:00:00.000Z',
              overall: { state: 'healthy', reasons: [] },
              thresholds: {
                backupMaxAgeHours: 24,
                drillMaxAgeDays: 30,
                keyRotationMaxAgeDays: 90,
              },
              backup: {
                state: 'healthy',
                reason: 'ok',
                latestDumpKey: 's3://bucket/backup.dump',
                lastModifiedUtc: '2026-03-10T23:00:00.000Z',
                ageHours: 1,
              },
              restoreDrill: {
                state: 'healthy',
                reason: 'ok',
                lastReportUtc: '2026-03-01T00:00:00.000Z',
                ageDays: 10,
                reportStatus: 'ok',
                reportMode: 'auto_download_only',
                latestRemoteDumpKey: 's3://bucket/backup.dump',
                drillResult: 'auto_download_only_ok',
              },
              keyRotation: {
                state: 'healthy',
                reason: 'ok',
                iamUser: 'ops-user',
                oldestAccessKeyId: 'AKIA123',
                oldestCreatedUtc: '2026-01-01T00:00:00.000Z',
                oldestAgeDays: 70,
                oldestLastUsedUtc: '2026-03-10T00:00:00.000Z',
              },
            }),
            stderr: '',
            timedOut: false,
          }),
        });

        const response = await app.inject({
          method: 'GET',
          url: '/ops/status',
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          checkedAtUtc: '2026-03-11T00:00:00.000Z',
          overall: {
            state: 'healthy',
          },
        });
      });
    });

    it('returns 202 when /ops/actions enqueue succeeds', async () => {
      await withOpsApp({}, async (app) => {
        opsControlModule.setOpsControlDependenciesForTests({
          randomId: () => 'op-202',
          now: () => new Date('2026-03-11T00:00:00.000Z'),
          runCommand: async () => ({
            exitCode: 0,
            stdout: 'ok',
            stderr: '',
            timedOut: false,
          }),
        });

        const response = await app.inject({
          method: 'POST',
          url: '/ops/actions',
          payload: {
            action: 'backup_upload',
            label: 'nightly',
          },
        });

        expect(response.statusCode).toBe(202);
        expect(response.json()).toMatchObject({
          operationId: 'op-202',
          action: 'backup_upload',
          state: 'queued',
          requestedBy: 'test@example.com',
          requestedByUserId: 'test-user-id',
        });
      });
    });

    it('returns 200 for /ops/actions/:operationId when action exists', async () => {
      await withOpsApp({}, async (app) => {
        opsControlModule.setOpsControlDependenciesForTests({
          randomId: () => 'op-lookup',
          now: () => new Date('2026-03-11T00:00:00.000Z'),
          runCommand: async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return {
              exitCode: 0,
              stdout: 'ok',
              stderr: '',
              timedOut: false,
            };
          },
        });

        const enqueue = await app.inject({
          method: 'POST',
          url: '/ops/actions',
          payload: {
            action: 'backup_upload',
          },
        });
        expect(enqueue.statusCode).toBe(202);

        const response = await app.inject({
          method: 'GET',
          url: '/ops/actions/op-lookup',
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          operationId: 'op-lookup',
          action: 'backup_upload',
          requestedBy: 'test@example.com',
          requestedByUserId: 'test-user-id',
          message: expect.any(String),
        });
        expect(['queued', 'running', 'succeeded', 'failed']).toContain(response.json().state);
      });
    });

    it('returns 404 for unknown ops action status', async () => {
      await withOpsApp({}, async (app) => {
        const response = await app.inject({
          method: 'GET',
          url: '/ops/actions/unknown-operation',
        });

        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({
          error: 'not_found',
          message: 'Ops action not found',
          code: 'ops_action_not_found',
        });
      });
    });

    it('maps internal status failures to a stable 500 shape', async () => {
      await withOpsApp({}, async (app) => {
        opsControlModule.setOpsControlDependenciesForTests({
          runCommand: async () => {
            throw new Error('status command exploded');
          },
        });

        const response = await app.inject({
          method: 'GET',
          url: '/ops/status',
        });

        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({
          error: 'internal_error',
          message: 'Failed to collect ops status',
        });
      });
    });

    it('maps internal enqueue failures to a stable 500 shape', async () => {
      await withOpsApp({}, async (app) => {
        opsControlModule.setOpsControlDependenciesForTests({
          randomId: () => {
            throw new Error('id generation failed');
          },
        });

        const response = await app.inject({
          method: 'POST',
          url: '/ops/actions',
          payload: {
            action: 'backup_upload',
          },
        });

        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({
          error: 'internal_error',
          message: 'Failed to enqueue ops action',
        });
      });
    });

    it('maps internal action-status failures to a stable 500 shape', async () => {
      await withOpsApp({}, async (app) => {
        opsControlModule.setOpsControlDependenciesForTests({
          isPersistenceEnabled: () => true,
          readPersistedAction: async () => {
            throw new Error('status lookup exploded');
          },
        });

        const response = await app.inject({
          method: 'GET',
          url: '/ops/actions/op-fail-lookup',
        });

        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({
          error: 'internal_error',
          message: 'Failed to fetch ops action status',
        });
      });
    });
  },
);
