import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  activateProfileRevision,
  getProfileContent,
  getProfileRevision,
  listProfileRevisions,
  restoreProfileRevision,
  saveProfileDraftRevision,
  upsertProfileContent,
} from './api';
import apiClient, { buildApiProxyPath } from './api-client';

vi.mock('./api-client', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
  buildApiProxyPath: vi.fn((path: string) => `/api${path}`),
  getApiAuthToken: vi.fn(() => null),
  handleApiError: vi.fn(() => 'HTTP error'),
  isAuthError: vi.fn(() => false),
}));

const studentId = 'student/alex';
const profilePath = '/students/student%2Falex/profile';
const revisionId = '11111111-1111-4111-8111-111111111111';

describe('utils/api profile route encoding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encodes student ids when loading profile content', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { studentId } } as never);

    await getProfileContent(studentId);

    expect(buildApiProxyPath).toHaveBeenCalledWith(profilePath);
    expect(apiClient.get).toHaveBeenCalledWith(`/api${profilePath}`);
  });

  it('saves active content under the student without a standalone identity in the body', async () => {
    vi.mocked(apiClient.put).mockResolvedValueOnce({ data: { studentId } } as never);

    await upsertProfileContent(studentId, '# Updated learner profile');

    expect(apiClient.put).toHaveBeenCalledWith(`/api${profilePath}`, {
      content: '# Updated learner profile',
    });
  });

  it('sends encoded student ids in the route when listing profile revisions', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { items: [] } } as never);

    await listProfileRevisions(studentId, { limit: 25, offset: 0, order: 'desc' });

    expect(buildApiProxyPath).toHaveBeenCalledWith(`${profilePath}/revisions`);
    expect(apiClient.get).toHaveBeenCalledWith(`/api${profilePath}/revisions`, {
      params: { limit: 25, offset: 0, order: 'desc' },
    });
  });

  it('sends encoded student ids in the route when loading revision details', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { id: revisionId } } as never);

    await getProfileRevision(studentId, revisionId);

    expect(buildApiProxyPath).toHaveBeenCalledWith(`${profilePath}/revisions/${revisionId}`);
    expect(apiClient.get).toHaveBeenCalledWith(`/api${profilePath}/revisions/${revisionId}`);
  });

  it('saves drafts under the student and preserves inherited candidate links', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { id: revisionId } } as never);

    await saveProfileDraftRevision(studentId, {
      content: '# Profile',
      inheritCandidateLinksFromRevisionId: revisionId,
    });

    expect(buildApiProxyPath).toHaveBeenCalledWith(`${profilePath}/revisions`);
    expect(apiClient.post).toHaveBeenCalledWith(`/api${profilePath}/revisions`, {
      content: '# Profile',
      inheritCandidateLinksFromRevisionId: revisionId,
    });
  });

  it('sends encoded student ids in the route when restoring revisions', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { studentId } } as never);

    await restoreProfileRevision(studentId, revisionId);

    expect(buildApiProxyPath).toHaveBeenCalledWith(
      `${profilePath}/revisions/${revisionId}/restore`,
    );
    expect(apiClient.post).toHaveBeenCalledWith(
      `/api${profilePath}/revisions/${revisionId}/restore`,
      {},
    );
  });

  it('sends encoded student ids in the route when activating revisions', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { studentId } } as never);

    await activateProfileRevision(studentId, revisionId);

    expect(buildApiProxyPath).toHaveBeenCalledWith(
      `${profilePath}/revisions/${revisionId}/activate`,
    );
    expect(apiClient.post).toHaveBeenCalledWith(
      `/api${profilePath}/revisions/${revisionId}/activate`,
      {},
    );
  });
});
