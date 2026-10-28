import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { HttpBackendClient } from '../src/backend-client.js';
import { loadFinishedJobsView } from '../src/commands.js';
import { createBaseContext } from './telegram-test-fixtures.js';

describe('Telegram smoke backend fixture', () => {
  it('serves authenticated workspace settings used by the real job renderer', async () => {
    const script = fileURLToPath(
      new URL('../../../scripts/smoke/telegram-ops/fake-backend.mjs', import.meta.url),
    );
    const child = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        TELEGRAM_SMOKE_BACKEND_HOST: '127.0.0.1',
        TELEGRAM_SMOKE_BACKEND_PORT: '0',
        TELEGRAM_SMOKE_BACKEND_EMAIL: 'fixture-bot@example.com',
        TELEGRAM_SMOKE_BACKEND_PASSWORD: 'fixture-only-password',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const exited = once(child, 'exit');
    try {
      const baseUrl = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Fixture backend startup timed out')),
          5000,
        );
        child.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error(`Fixture backend exited: ${code}: ${stderr}`));
        });
        child.stdout.on('data', (chunk) => {
          const port = /listening on 127\.0\.0\.1:(\d+)/.exec(String(chunk))?.[1];
          if (port) {
            clearTimeout(timeout);
            resolve(`http://127.0.0.1:${port}`);
          }
        });
      });
      expect((await fetch(`${baseUrl}/business/settings`)).status).toBe(401);
      const backend = new HttpBackendClient({
        baseUrl,
        email: 'fixture-bot@example.com',
        password: 'fixture-only-password',
        timeoutMs: 1000,
      });
      expect(await backend.getBusinessSettings()).toMatchObject({
        workspaceId: 'b5304edc-202c-4c8c-ab24-28db670368be',
        timezone: 'Asia/Ho_Chi_Minh',
      });
      const view = await loadFinishedJobsView(createBaseContext({ backend }));
      expect(view.html).toContain('2026-03-13 12:10 Asia/Ho_Chi_Minh');
      expect(view.html).not.toContain('2026-03-13 05:10 UTC');
      const state = (await (await fetch(`${baseUrl}/_test/state`)).json()) as {
        requests: Array<{ method: string; path: string; authHeader: string | null }>;
      };
      expect(state.requests).toContainEqual(
        expect.objectContaining({
          method: 'GET',
          path: '/business/settings',
          authHeader: 'Bearer smoke-access-token',
        }),
      );
    } finally {
      child.kill();
      await exited;
    }
  });
});
