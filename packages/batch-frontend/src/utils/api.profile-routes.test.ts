import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  activateProfileRevision,
  getProfileContent,
  getProfileRevision,
  initializeStudentProfileDraft,
  listProfileChanges,
  listProfileRevisions,
  promoteStudentProfileCandidates,
  refreshProfileDraftFromApprovedCandidates,
  restoreProfileRevision,
  saveProfileDraftRevision,
  undoProfileChange,
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
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.post).mockReset();
    vi.mocked(apiClient.put).mockReset();
  });

  it('encodes student ids when loading profile content', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { studentId } } as never);

    await getProfileContent(studentId);

    expect(buildApiProxyPath).toHaveBeenCalledWith(profilePath);
    expect(apiClient.get).toHaveBeenCalledWith(`/api${profilePath}`);
  });

  it('saves active content under the student without a standalone identity in the body', async () => {
    vi.mocked(apiClient.put).mockResolvedValueOnce({ data: { studentId } } as never);

    await upsertProfileContent(studentId, '# Updated learner profile', undefined, {
      expectedActiveRevisionId: revisionId,
    });

    expect(apiClient.put).toHaveBeenCalledWith(`/api${profilePath}`, {
      content: '# Updated learner profile',
      expectedActiveRevisionId: revisionId,
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
      expectedActiveRevisionId: revisionId,
      content: '# Profile',
      inheritCandidateLinksFromRevisionId: revisionId,
    });

    expect(buildApiProxyPath).toHaveBeenCalledWith(`${profilePath}/revisions`);
    expect(apiClient.post).toHaveBeenCalledWith(`/api${profilePath}/revisions`, {
      expectedActiveRevisionId: revisionId,
      content: '# Profile',
      inheritCandidateLinksFromRevisionId: revisionId,
    });
  });

  it('sends encoded student ids in the route when restoring revisions', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { studentId } } as never);

    await restoreProfileRevision(studentId, revisionId, {
      expectedActiveRevisionId: 'active-head',
    });

    expect(buildApiProxyPath).toHaveBeenCalledWith(
      `${profilePath}/revisions/${revisionId}/restore`,
    );
    expect(apiClient.post).toHaveBeenCalledWith(
      `/api${profilePath}/revisions/${revisionId}/restore`,
      { expectedActiveRevisionId: 'active-head' },
    );
  });

  it('sends encoded student ids in the route when activating revisions', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { studentId } } as never);

    await activateProfileRevision(studentId, revisionId, {
      expectedActiveRevisionId: 'active-head',
    });

    expect(buildApiProxyPath).toHaveBeenCalledWith(
      `${profilePath}/revisions/${revisionId}/activate`,
    );
    expect(apiClient.post).toHaveBeenCalledWith(
      `/api${profilePath}/revisions/${revisionId}/activate`,
      { expectedActiveRevisionId: 'active-head' },
    );
  });

  it('loads cursor-based profile updates and sends the reviewed active head when undoing one item', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: { studentId, items: [], nextCursor: null, activeRevisionId: revisionId },
    } as never);
    await listProfileChanges(studentId, 'older-change');
    expect(apiClient.get).toHaveBeenLastCalledWith(`/api${profilePath}/changes`, {
      params: { cursor: 'older-change' },
    });
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: {} } as never);
    await undoProfileChange(studentId, 'change/one', { expectedActiveRevisionId: revisionId });
    expect(apiClient.post).toHaveBeenLastCalledWith(
      `/api${profilePath}/changes/change%2Fone/undo`,
      { expectedActiveRevisionId: revisionId },
    );
  });

  it('sends an explicit empty-head precondition through initialization and both candidate draft APIs', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: {} } as never);
    await initializeStudentProfileDraft(studentId, { expectedActiveRevisionId: null });
    expect(apiClient.post).toHaveBeenLastCalledWith(
      '/api/students/student%2Falex/profile-drafts/initialize',
      { expectedActiveRevisionId: null },
    );
    const request = {
      candidateIds: ['candidate-1'],
      baseRevisionId: 'selected-draft',
      expectedActiveRevisionId: revisionId,
    };
    await promoteStudentProfileCandidates(studentId, request);
    expect(apiClient.post).toHaveBeenLastCalledWith(
      '/api/students/student%2Falex/profile-candidates/promote',
      request,
    );
    await refreshProfileDraftFromApprovedCandidates(studentId, request);
    expect(apiClient.post).toHaveBeenLastCalledWith(
      '/api/students/student%2Falex/profile-drafts/refresh-from-approved-candidates',
      request,
    );
  });

  it.each([
    [
      'save',
      () =>
        upsertProfileContent(studentId, '# local', undefined, {
          expectedActiveRevisionId: revisionId,
        }),
    ],
    [
      'draft',
      () =>
        saveProfileDraftRevision(studentId, {
          content: '# local',
          expectedActiveRevisionId: revisionId,
        }),
    ],
    [
      'activate',
      () =>
        activateProfileRevision(studentId, 'selected-draft', {
          expectedActiveRevisionId: revisionId,
        }),
    ],
    [
      'restore',
      () =>
        restoreProfileRevision(studentId, 'historical-revision', {
          expectedActiveRevisionId: revisionId,
        }),
    ],
    [
      'initialize',
      () => initializeStudentProfileDraft(studentId, { expectedActiveRevisionId: null }),
    ],
    [
      'promote',
      () =>
        promoteStudentProfileCandidates(studentId, {
          candidateIds: [],
          expectedActiveRevisionId: revisionId,
        }),
    ],
    [
      'refresh',
      () =>
        refreshProfileDraftFromApprovedCandidates(studentId, {
          candidateIds: [],
          expectedActiveRevisionId: revisionId,
        }),
    ],
    [
      'undo',
      () => undoProfileChange(studentId, 'change-1', { expectedActiveRevisionId: revisionId }),
    ],
  ])('preserves the authoritative conflict for %s', async (_name, call) => {
    const conflict = {
      isAxiosError: true,
      response: {
        status: 409,
        data: { code: 'profile_revision_conflict', activeRevisionId: 'new-head' },
      },
    };
    vi.mocked(apiClient.post).mockRejectedValueOnce(conflict);
    vi.mocked(apiClient.put).mockRejectedValueOnce(conflict);
    await expect(call()).rejects.toMatchObject({
      name: 'ProfileRevisionConflictApiError',
      code: 'profile_revision_conflict',
      activeRevisionId: 'new-head',
    });
  });
});
