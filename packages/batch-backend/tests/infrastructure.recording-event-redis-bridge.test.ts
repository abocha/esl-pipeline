import { beforeEach, describe, expect, it, vi } from 'vitest';

const createRedisClientMock = vi.fn();

vi.mock('../src/infrastructure/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../src/infrastructure/redis', () => ({
  createRedisClient: createRedisClientMock,
}));

function createFakeRedisConnection() {
  const handlers = new Map<string, ((...args: any[]) => void)[]>();
  return {
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockResolvedValue(1),
    unsubscribe: vi.fn().mockResolvedValue(1),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      const listeners = handlers.get(event) ?? [];
      listeners.push(handler);
      handlers.set(event, listeners);
    }),
    emit(event: string, ...args: any[]) {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
  };
}

function makeRecording(audioTopology: 'mixed_recording' | 'trusted_split_channels') {
  const now = new Date('2026-09-09T10:00:00.000Z');
  return {
    id: 'recording-1',
    workspaceId: 'workspace-1',
    source: 'upload' as const,
    studentId: 'student-1',
    sourcePath: 'lesson.mp3',
    storageUri: 'memory://recordings/lesson.mp3',
    sha256: 'a'.repeat(64),
    bytes: 1024,
    durationSec: 300,
    channels: 1,
    audioTopology,
    audioLifecycle: 'retained' as const,
    status: 'transcribed' as const,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('infrastructure/recording-event-redis-bridge', () => {
  beforeEach(async () => {
    vi.resetModules();
    createRedisClientMock.mockReset();
    const bridgeModule = await import('../src/infrastructure/recording-event-redis-bridge.js');
    bridgeModule.resetRecordingEventBridgeForTests();
  }, 30_000);

  it('preserves audio topology across the worker-to-HTTP event boundary', async () => {
    const publisher = createFakeRedisConnection();
    const subscriber = createFakeRedisConnection();
    createRedisClientMock.mockReturnValue({
      duplicate: vi
        .fn()
        .mockReturnValueOnce(publisher as any)
        .mockReturnValueOnce(subscriber as any),
    } as any);

    const { enableRedisRecordingEventBridge } = await import(
      '../src/infrastructure/recording-event-redis-bridge.js'
    );
    const recordingEvents = await import('../src/domain/recording-events.js');
    await enableRedisRecordingEventBridge();

    const received: any[] = [];
    const dispose = recordingEvents.subscribeRecordingEvents((event) => received.push(event), {
      recordingIds: ['recording-1'],
    });
    await new Promise((resolve) => setImmediate(resolve));

    const localRecording = makeRecording('mixed_recording');
    recordingEvents.publishRecordingEvent({
      type: 'recording_state_changed',
      recording: localRecording,
      transcriptId: 'transcript-1',
      run: { state: 'succeeded', errorCode: null },
    });

    const publishedPayload = JSON.parse(publisher.publish.mock.calls[0]?.[1]);
    expect(publishedPayload.recording.audioTopology).toBe('mixed_recording');

    subscriber.emit(
      'message',
      'batch_recording_events:recording-1',
      JSON.stringify({
        ...publishedPayload,
        sourceId: 'remote-worker',
        recording: {
          ...publishedPayload.recording,
          audioTopology: 'trusted_split_channels',
        },
      }),
    );

    expect(received).toHaveLength(2);
    expect(received[1]?.recording.audioTopology).toBe('trusted_split_channels');
    dispose();
  });
});
