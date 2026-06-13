import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  activateProfileRevision,
  getProfileContent,
  getProfileRevision,
  listProfileRevisions,
  restoreProfileRevision,
  saveProfileDraftRevision,
} from './api';
import apiClient, { buildApiProxyPath } from './api-client';

vi.mock('./api-client', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
  buildApiProxyPath: vi.fn((path: string) => `/api${path}`),
  getApiAuthToken: vi.fn(() => null),
  handleApiError: vi.fn(() => 'HTTP error'),
  isAuthError: vi.fn(() => false),
}));

const profileId = 'profiles/students/alex.md';
const encodedProfileId = 'profiles%2Fstudents%2Falex.md';
const revisionId = '11111111-1111-4111-8111-111111111111';

describe('utils/api profile route encoding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encodes path-like profile ids when loading profile content', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { id: profileId } } as never);

    await getProfileContent(profileId);

    expect(buildApiProxyPath).toHaveBeenCalledWith(`/profiles/${encodedProfileId}`);
    expect(apiClient.get).toHaveBeenCalledWith(`/api/profiles/${encodedProfileId}`);
  });

  it('sends path-like profile ids as query params when listing profile revisions', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { items: [] } } as never);

    await listProfileRevisions(profileId, { limit: 25, offset: 0, order: 'desc' });

    expect(buildApiProxyPath).toHaveBeenCalledWith('/profiles/revisions');
    expect(apiClient.get).toHaveBeenCalledWith('/api/profiles/revisions', {
      params: { limit: 25, offset: 0, order: 'desc', profileId },
    });
  });

  it('sends path-like profile ids as query params when loading revision details', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { id: revisionId } } as never);

    await getProfileRevision(profileId, revisionId);

    expect(buildApiProxyPath).toHaveBeenCalledWith(`/profiles/revisions/${revisionId}`);
    expect(apiClient.get).toHaveBeenCalledWith(`/api/profiles/revisions/${revisionId}`, {
      params: { profileId },
    });
  });

  it('sends path-like profile ids in the body when saving draft revisions', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { id: revisionId } } as never);

    await saveProfileDraftRevision(profileId, { content: '# Profile' });

    expect(buildApiProxyPath).toHaveBeenCalledWith('/profiles/revisions');
    expect(apiClient.post).toHaveBeenCalledWith('/api/profiles/revisions', {
      content: '# Profile',
      profileId,
    });
  });

  it('sends path-like profile ids in the body when restoring revisions', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { id: profileId } } as never);

    await restoreProfileRevision(profileId, revisionId);

    expect(buildApiProxyPath).toHaveBeenCalledWith(`/profiles/revisions/${revisionId}/restore`);
    expect(apiClient.post).toHaveBeenCalledWith(`/api/profiles/revisions/${revisionId}/restore`, {
      profileId,
    });
  });

  it('sends path-like profile ids in the body when activating revisions', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { id: profileId } } as never);

    await activateProfileRevision(profileId, revisionId);

    expect(buildApiProxyPath).toHaveBeenCalledWith(`/profiles/revisions/${revisionId}/activate`);
    expect(apiClient.post).toHaveBeenCalledWith(`/api/profiles/revisions/${revisionId}/activate`, {
      profileId,
    });
  });
});
