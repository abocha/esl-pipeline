import { WorkspaceContextError } from '../src/application/workspace-context.js';
import { describeHttpServerIntegrationSuite } from './transport.http-server.integration.harness.js';

const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

describeHttpServerIntegrationSuite(
  'transport/http-server - integration (in-process) [business-dashboard]',
  ({
    app,
    expect,
    it,
    mockGetBusinessScheduleSurface,
    mockGetBusinessSettings,
    mockGetBusinessStatsSurface,
    mockResolvePrimaryWorkspaceIdForUser,
    mockUpdateBusinessSettings,
  }) => {
    it('serves business settings', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/business/settings',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        defaultCurrency: 'USD',
        defaultLessonRateMinor: 4000,
        forecastHorizonDays: 45,
      });
      expect(mockResolvePrimaryWorkspaceIdForUser).toHaveBeenCalledWith('test-user-id');
      expect(mockGetBusinessSettings).toHaveBeenCalledWith(DEFAULT_WORKSPACE_ID);
    });

    it('updates business settings with the authenticated actor', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/business/settings',
        payload: {
          defaultCurrency: 'EUR',
          defaultLessonRateMinor: 4500,
          forecastHorizonDays: 60,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        defaultCurrency: 'EUR',
        defaultLessonRateMinor: 4500,
        forecastHorizonDays: 60,
      });
      expect(mockUpdateBusinessSettings).toHaveBeenCalledWith(
        DEFAULT_WORKSPACE_ID,
        {
          defaultCurrency: 'EUR',
          defaultLessonRateMinor: 4500,
          forecastHorizonDays: 60,
        },
        'test-user-id',
      );
    });

    it('serves business schedule with a bounded date range', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/business/schedule?from=2026-05-07&to=2026-05-14',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        from: '2026-05-07',
        to: '2026-05-14',
      });
      expect(mockGetBusinessScheduleSurface).toHaveBeenCalledWith(DEFAULT_WORKSPACE_ID, {
        from: '2026-05-07',
        to: '2026-05-14',
      });
    });

    it('serves business stats for a selected month', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/business/stats?month=2026-05',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        month: '2026-05',
        currency: 'USD',
        collectedMinor: 12000,
      });
      expect(mockGetBusinessStatsSurface).toHaveBeenCalledWith(DEFAULT_WORKSPACE_ID, {
        month: '2026-05',
      });
    });

    it('returns workspace_required when the authenticated tutor has no workspace membership', async () => {
      mockResolvePrimaryWorkspaceIdForUser.mockRejectedValueOnce(new WorkspaceContextError());

      const response = await app.inject({
        method: 'GET',
        url: '/business/settings',
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: 'workspace_required' });
    });

    it('rejects invalid business query parameters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/business/stats?month=2026',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'validation_failed' });
    });
  },
);
