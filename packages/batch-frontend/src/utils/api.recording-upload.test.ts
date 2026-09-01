import { beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadRecording } from './api';
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

const recording = {
  recordingId: 'recording-1',
  status: 'queued',
  transcriptId: null,
  error: null,
  source: 'upload',
  studentId: 'student-1',
  displayName: 'lesson.mp3',
  durationSec: null,
  channels: null,
  audioTopology: 'mixed_recording',
  bytes: 5,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
} as const;

function expectRecordingUploadRequest(params: Record<string, string> | undefined): void {
  expect(buildApiProxyPath).toHaveBeenCalledWith('/recordings/upload');
  expect(apiClient.post).toHaveBeenCalledWith(
    '/api/recordings/upload',
    expect.any(FormData),
    expect.objectContaining({
      params,
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: expect.any(Function),
      signal: undefined,
    }),
  );
}

describe('utils/api recording upload request', () => {
  beforeEach(() => vi.clearAllMocks());

  it('omits audioTopology for ordinary recordings while preserving a provider override', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: recording } as never);

    await uploadRecording(new File(['audio'], 'lesson.mp3', { type: 'audio/mpeg' }), {
      studentId: 'student-1',
      sttProvider: 'elevenlabs',
    });

    expectRecordingUploadRequest({
      studentId: 'student-1',
      sttProvider: 'elevenlabs',
    });
  });

  it('serializes trusted split topology alongside a provider override', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: recording } as never);

    await uploadRecording(new File(['audio'], 'lesson.mp3', { type: 'audio/mpeg' }), {
      studentId: 'student-1',
      sttProvider: 'deepgram',
      audioTopology: 'trusted_split_channels',
    });

    expectRecordingUploadRequest({
      studentId: 'student-1',
      sttProvider: 'deepgram',
      audioTopology: 'trusted_split_channels',
    });
  });
});
