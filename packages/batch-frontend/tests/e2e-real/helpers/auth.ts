import { randomUUID } from 'node:crypto';

import type { APIRequestContext, Page } from '@playwright/test';

const SESSION_STORAGE_KEY = 'esl-batch-session';
const DEFAULT_BACKEND_URL = 'http://localhost:8080';

export interface AuthSession {
  user: {
    id: string;
    email: string;
    role: string;
    isActive: boolean;
  };
  accessToken: string;
  refreshToken: string;
  credentials: {
    email: string;
    password: string;
  };
}

function resolveBackendUrl(): string {
  return process.env.BATCH_BACKEND_URL || DEFAULT_BACKEND_URL;
}

export async function createAuthSession(
  request: APIRequestContext,
  options: { email?: string; password?: string; role?: string } = {},
): Promise<AuthSession> {
  const email = options.email ?? `e2e-${randomUUID()}@example.com`;
  const password = options.password ?? `P@ssw0rd-${randomUUID()}`;
  const role = options.role ?? 'user';
  const backendUrl = resolveBackendUrl();

  const register = await request.post(`${backendUrl}/auth/register`, {
    data: { email, password, role },
  });
  if (![201, 409].includes(register.status())) {
    const payload = await register.text();
    throw new Error(`Failed to register user: ${register.status()} ${payload}`);
  }

  const login = await request.post(`${backendUrl}/auth/login`, {
    data: { email, password },
  });
  if (login.status() !== 200) {
    const payload = await login.text();
    throw new Error(`Failed to login user: ${login.status()} ${payload}`);
  }
  const data = (await login.json()) as {
    user: AuthSession['user'];
    accessToken: string;
    refreshToken: string;
  };

  if (!data.accessToken || !data.refreshToken || !data.user) {
    throw new Error('Login response missing auth fields');
  }

  return {
    user: data.user,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    credentials: {
      email,
      password,
    },
  };
}

export async function applyAuthSession(page: Page, session: AuthSession): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ({ key, value }) => {
      localStorage.setItem(key, value);
    },
    { key: SESSION_STORAGE_KEY, value: JSON.stringify(session) },
  );
  await page.reload();
}
