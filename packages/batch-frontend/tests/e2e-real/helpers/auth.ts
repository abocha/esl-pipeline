import { randomUUID } from 'node:crypto';

import type { APIRequestContext, Page } from '@playwright/test';

const DEFAULT_BACKEND_URL = 'http://localhost:8080';

export interface AuthSession {
  user: {
    id: string;
    email: string;
    role: string;
    isActive: boolean;
  };
  accessToken: string;
  refreshCookie: {
    name: string;
    value: string;
    domain: string;
    path: string;
  };
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
  };

  if (!data.accessToken || !data.user) {
    throw new Error('Login response missing auth fields');
  }

  const setCookieHeader = login.headers()['set-cookie'];
  if (!setCookieHeader) {
    throw new Error('Login response missing refresh cookie');
  }

  const cookie = parseCookie(setCookieHeader);
  const backendHost = new URL(backendUrl).hostname;

  return {
    user: data.user,
    accessToken: data.accessToken,
    refreshCookie: {
      name: cookie.name,
      value: cookie.value,
      domain: backendHost,
      path: '/',
    },
    credentials: {
      email,
      password,
    },
  };
}

export async function applyAuthSession(page: Page, session: AuthSession): Promise<void> {
  await page.context().addCookies([
    {
      name: session.refreshCookie.name,
      value: session.refreshCookie.value,
      domain: session.refreshCookie.domain,
      path: session.refreshCookie.path,
      httpOnly: true,
    },
  ]);
  await page.goto('/');
}

function parseCookie(header: string): { name: string; value: string } {
  const first = header.split('\n')[0] ?? header;
  const pair = first.split(';')[0] ?? '';
  const separatorIndex = pair.indexOf('=');
  if (separatorIndex === -1) {
    throw new Error('Refresh cookie header missing name/value');
  }
  const name = pair.slice(0, separatorIndex).trim();
  const value = pair.slice(separatorIndex + 1).trim();
  if (!name || !value) {
    throw new Error('Refresh cookie header missing name/value');
  }
  return { name, value };
}
