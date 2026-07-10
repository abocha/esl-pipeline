import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createManualTranscriptSource } from './api';
import apiClient, { buildApiProxyPath } from './api-client';

vi.mock('./api-client', () => ({
  __esModule: true,
  default: {
    post: vi.fn(),
  },
  buildApiProxyPath: vi.fn((path: string) => `/api${path}`),
  getApiAuthToken: vi.fn(() => null),
  handleApiError: vi.fn(() => 'HTTP error'),
  isAuthError: vi.fn(() => false),
}));

describe('utils/api manual transcript source', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts student-owned transcript text to the manual source route', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: {
        recordingId: 'recording-manual',
        transcriptId: 'transcript-manual',
        status: 'transcribed',
        error: null,
        source: 'manual_transcript',
        studentId: '11111111-1111-4111-8111-111111111111',
        displayName: 'Lesson on travel',
        durationSec: null,
        channels: null,
        bytes: 25,
        createdAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-10T00:00:00.000Z',
      },
    } as never);

    const result = await createManualTranscriptSource({
      studentId: '11111111-1111-4111-8111-111111111111',
      text: 'Tutor supplied transcript',
      displayName: 'Lesson on travel',
    });

    expect(buildApiProxyPath).toHaveBeenCalledWith('/recordings/transcript-source');
    expect(apiClient.post).toHaveBeenCalledWith('/api/recordings/transcript-source', {
      studentId: '11111111-1111-4111-8111-111111111111',
      text: 'Tutor supplied transcript',
      displayName: 'Lesson on travel',
    });
    expect(result.source).toBe('manual_transcript');
  });
});
