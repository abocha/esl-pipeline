import type { Page, Route, TestInfo } from '@playwright/test';

type ApiHandler = (path: string, route: Route) => Promise<boolean> | boolean;

const toApiPath = (rawPath: string): string =>
  rawPath.startsWith('/api/') ? rawPath : `/api${rawPath}`;

const shouldIntercept = (pathname: string, includeAuth: boolean): boolean => {
  if (!includeAuth && pathname.includes('/auth/')) return false;
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/config') ||
    pathname.startsWith('/jobs') ||
    pathname.startsWith('/recordings') ||
    pathname.startsWith('/students') ||
    pathname.startsWith('/user') ||
    pathname.startsWith('/validation')
  );
};

export async function setupApiMocks(
  page: Page,
  handler: ApiHandler,
  options: { includeAuth?: boolean; testInfo?: TestInfo } = {},
): Promise<void> {
  if (options.testInfo?.project.name === 'firefox') {
    options.testInfo.setTimeout(options.testInfo.timeout + 60_000);
  }

  await page.route('**/jobs/events*', route => route.abort('blockedbyclient'));

  await page.route(
    url => shouldIntercept(url.pathname, options.includeAuth ?? true),
    async (route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      if (resourceType !== 'xhr' && resourceType !== 'fetch') {
        await route.continue();
        return;
      }

      if (request.method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
            'access-control-allow-headers': 'content-type,authorization',
          },
          body: '',
        });
        return;
      }

      const reqUrl = new URL(request.url());
      const path = toApiPath(reqUrl.pathname);
      const handled = await handler(path, route);
      if (!handled) {
        await route.abort();
        throw new Error(`Unhandled API route in e2e: ${path}`);
      }
    },
  );
}
