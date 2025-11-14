import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  const handlers = new Map<string, Array<(...args: any[]) => void>>();
  return {
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockResolvedValue(1),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      const arr = handlers.get(event) ?? [];
      arr.push(handler);
      handlers.set(event, arr);
    }),
    emit(event: string, ...args: any[]) {
      const arr = handlers.get(event) ?? [];
      arr.forEach(handler => handler(...args));
    },
  };
}

function makeJob(state: string) {
  const now = new Date('2024-01-01T00:00:00Z');
  return {
    id: 'job-1',
    state,
    md: 'fixtures/ok.md',
    preset: null,
    withTts: null,
    upload: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    error: null,
    manifestPath: null,
  };
}

describe('infrastructure/job-event-redis-bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    createRedisClientMock.mockReset();
  });

  it('relays local events through redis and delivers remote events back to subscribers', async () => {
    const publisher = createFakeRedisConnection();
    const subscriber = createFakeRedisConnection();
    const duplicateMock = vi
      .fn()
      .mockReturnValueOnce(publisher as any)
      .mockReturnValueOnce(subscriber as any);

    createRedisClientMock.mockReturnValue({
      duplicate: duplicateMock,
    } as any);

    const { enableRedisJobEventBridge } = await import(
      '../src/infrastructure/job-event-redis-bridge'
    );
    const jobEvents = await import('../src/domain/job-events');

    await enableRedisJobEventBridge();

    const received: Array<{ type: string; job: any }> = [];
    const dispose = jobEvents.subscribeJobEvents(event => received.push(event));

    const job = makeJob('queued');
    jobEvents.publishJobEvent({ type: 'job_created', job });

    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const payloadStr = publisher.publish.mock.calls[0][1];
    const payloadJson = JSON.parse(payloadStr);
    expect(payloadJson.type).toBe('job_created');
    expect(payloadJson.job.id).toBe(job.id);

    const remotePayload = JSON.stringify({
      sourceId: 'remote-instance',
      type: 'job_state_changed',
      job: {
        ...payloadJson.job,
        state: 'running',
        startedAt: '2024-01-01T00:01:00.000Z',
      },
    });

    subscriber.emit('message', 'batch_job_events', remotePayload);

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual({ type: 'job_created', job });
    expect(received[1].type).toBe('job_state_changed');
    expect(received[1].job.state).toBe('running');
    expect(received[1].job.startedAt).toEqual(new Date('2024-01-01T00:01:00.000Z'));

    dispose();
  });

  it('only initializes redis bridge once', async () => {
    const connection = createFakeRedisConnection();
    const duplicateMock = vi.fn().mockReturnValue(connection as any);
    createRedisClientMock.mockReturnValue({
      duplicate: duplicateMock,
    } as any);

    const { enableRedisJobEventBridge } = await import(
      '../src/infrastructure/job-event-redis-bridge'
    );

    await enableRedisJobEventBridge();
    await enableRedisJobEventBridge();

    expect(createRedisClientMock).toHaveBeenCalledTimes(1);
  });
});
