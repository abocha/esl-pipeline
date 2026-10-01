import Fastify, { type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthenticatedRequest } from '../src/transport/auth-middleware.js';
import { registerConfigRoutes } from '../src/transport/extended-routes/config-routes.js';
import type { ExtendedRoutesContext } from '../src/transport/extended-routes/context.js';
import { registerTemplateRoutes } from '../src/transport/extended-routes/templates-routes.js';

const templateMocks = vi.hoisted(() => ({
  listTemplateContents: vi.fn(),
  getTemplateContent: vi.fn(),
  upsertTemplateContent: vi.fn(),
  setDefaultTemplateContent: vi.fn(),
  deleteTemplateContent: vi.fn(),
  listTemplateRevisionsForTemplate: vi.fn(),
  getTemplateRevisionForTemplate: vi.fn(),
  restoreTemplateRevision: vi.fn(),
  activateTemplateRevisionForTemplate: vi.fn(),
}));

const controlPlaneMock = vi.hoisted(() => vi.fn());
vi.mock('../src/application/template-control-plane.js', () => ({
  listTemplateControlPlane: controlPlaneMock,
}));

const promptOptionsMock = vi.hoisted(() => vi.fn());

vi.mock('../src/application/template-content.js', () => ({
  ...templateMocks,
  TemplateContentError: class TemplateContentError extends Error {
    status = 500;
    code = 'template_content_error';
  },
}));

vi.mock('../src/application/get-prompt-options.js', () => ({
  getPromptOptions: promptOptionsMock,
}));

vi.mock('../src/infrastructure/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const REVISION_ID = '11111111-1111-4111-8111-111111111111';

function createContext(): ExtendedRoutesContext {
  return {
    authenticate: async (request: FastifyRequest) => {
      const roleHeader = request.headers['x-test-user-role'];
      const role = roleHeader === 'admin' || roleHeader === 'viewer' ? roleHeader : 'user';
      (request as AuthenticatedRequest).user = {
        id: role === 'admin' ? 'admin-user' : 'tutor-user',
        email: `${role}@example.com`,
        role,
      };
    },
  } as unknown as ExtendedRoutesContext;
}

async function createApp() {
  const app = Fastify();
  const context = createContext();
  registerTemplateRoutes(app, context);
  registerConfigRoutes(app, context);
  await app.ready();
  return app;
}

const managementRoutes = [
  { method: 'GET', url: '/templates' },
  { method: 'GET', url: '/templates/control-plane' },
  { method: 'GET', url: '/templates/template.md' },
  { method: 'PUT', url: '/templates/template.md', payload: { content: 'updated' } },
  { method: 'DELETE', url: '/templates/template.md' },
  { method: 'GET', url: '/templates/template.md/revisions' },
  { method: 'GET', url: `/templates/template.md/revisions/${REVISION_ID}` },
  { method: 'POST', url: '/templates/template.md/default' },
  {
    method: 'POST',
    url: `/templates/template.md/revisions/${REVISION_ID}/restore`,
  },
  {
    method: 'POST',
    url: `/templates/template.md/revisions/${REVISION_ID}/activate`,
  },
] as const;

describe('Assignment Template authorization', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(() => {
    vi.clearAllMocks();
    templateMocks.listTemplateContents.mockResolvedValue([]);
    controlPlaneMock.mockResolvedValue({ items: [], defaultTemplateId: null });
    templateMocks.upsertTemplateContent.mockResolvedValue({ id: 'template.md' });
    promptOptionsMock.mockResolvedValue({
      templates: [{ id: 'template.md', label: 'Template' }],
      defaults: { templateId: 'template.md' },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('denies every template management route to ordinary authenticated roles', async () => {
    app = await createApp();

    for (const role of ['user', 'viewer'] as const) {
      for (const route of managementRoutes) {
        const response = await app.inject({
          method: route.method,
          url: route.url,
          payload: 'payload' in route ? route.payload : undefined,
          headers: { 'x-test-user-role': role },
        });

        expect(response.statusCode, `${role} ${route.method} ${route.url}`).toBe(403);
        expect(response.json()).toMatchObject({
          error: 'forbidden',
          requiredRoles: ['admin'],
        });
      }
    }
  });

  it('allows an admin to list and save templates through the management API', async () => {
    app = await createApp();

    const listResponse = await app.inject({
      method: 'GET',
      url: '/templates',
      headers: { 'x-test-user-role': 'admin' },
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual([]);

    const stateResponse = await app.inject({
      method: 'GET',
      url: '/templates/control-plane',
      headers: { 'x-test-user-role': 'admin' },
    });
    expect(stateResponse.statusCode).toBe(200);
    expect(stateResponse.json()).toEqual({ items: [], defaultTemplateId: null });

    const saveResponse = await app.inject({
      method: 'PUT',
      url: '/templates/template.md',
      payload: { content: 'updated' },
      headers: { 'x-test-user-role': 'admin' },
    });
    expect(saveResponse.statusCode).toBe(200);
    expect(templateMocks.upsertTemplateContent).toHaveBeenCalledWith('template.md', 'updated', {
      createdBy: 'admin-user',
    });
  });

  it('keeps prompt options available to an ordinary tutor for assignment consumption', async () => {
    app = await createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/config/prompts',
      headers: { 'x-test-user-role': 'user' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      templates: [{ id: 'template.md', label: 'Template' }],
      defaults: { templateId: 'template.md' },
    });
  });
});
