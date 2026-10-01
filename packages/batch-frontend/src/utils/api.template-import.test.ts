import { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { importAndActivateShippedTemplate } from './api';
import apiClient, { handleApiError } from './api-client';

vi.mock('./api-client', () => ({
  default: { post: vi.fn() },
  buildApiProxyPath: (path: string) => `/api${path}`,
  getApiAuthToken: vi.fn(() => null),
  handleApiError: vi.fn(() => 'Imported, but activation failed. Retry activation.'),
  isAuthError: vi.fn(() => false),
}));

describe('shipped prompt import API', () => {
  beforeEach(() => vi.clearAllMocks());
  it('uses one encoded admin request without sending client prompt content', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { status: 'active' } });
    await importAndActivateShippedTemplate('nested/template.md');
    expect(apiClient.post).toHaveBeenCalledExactlyOnceWith(
      '/api/templates/nested%2Ftemplate.md/import-and-activate',
    );
  });
  it('propagates the actionable server failure', async () => {
    const failure = new AxiosError('Request failed');
    vi.mocked(apiClient.post).mockRejectedValueOnce(failure);
    await expect(importAndActivateShippedTemplate('template.md')).rejects.toThrow(
      'Imported, but activation failed. Retry activation.',
    );
    expect(handleApiError).toHaveBeenCalledWith(failure);
  });
});
