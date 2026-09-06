import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecordingUploadPreDispatchError, uploadRecording } from './api';
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
      headers: expect.objectContaining({
        'Content-Type': 'multipart/form-data',
        'x-upload-operation-id': '3a4e8b44-4967-4d3e-b8b5-1b4c434873f7',
      }),
      onUploadProgress: expect.any(Function),
      signal: undefined,
    }),
  );
}

describe('utils/api recording upload request', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects an oversized File before starting a recording upload request', async () => {
    const file = new File(['small sentinel'], 'oversized.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(file, 'size', { value: 2_147_483_649 });

    await expect(uploadRecording(file, { studentId: 'student-1' })).rejects.toBeInstanceOf(
      RecordingUploadPreDispatchError,
    );
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('omits audioTopology for ordinary recordings while preserving a provider override', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: recording } as never);

    await uploadRecording(new File(['audio'], 'lesson.mp3', { type: 'audio/mpeg' }), {
      studentId: 'student-1',
      sttProvider: 'elevenlabs',
      uploadOperationId: '3a4e8b44-4967-4d3e-b8b5-1b4c434873f7',
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
      uploadOperationId: '3a4e8b44-4967-4d3e-b8b5-1b4c434873f7',
    });

    expectRecordingUploadRequest({
      studentId: 'student-1',
      sttProvider: 'deepgram',
      audioTopology: 'trusted_split_channels',
    });
  });

  it('preserves a supplied transport operation identity for an ambiguous retry', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: recording } as never);

    await uploadRecording(new File(['audio'], 'lesson.mp3', { type: 'audio/mpeg' }), {
      studentId: 'student-1',
      uploadOperationId: '3a4e8b44-4967-4d3e-b8b5-1b4c434873f7',
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/recordings/upload',
      expect.any(FormData),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-upload-operation-id': '3a4e8b44-4967-4d3e-b8b5-1b4c434873f7',
        }),
      }),
    );
  });
});
