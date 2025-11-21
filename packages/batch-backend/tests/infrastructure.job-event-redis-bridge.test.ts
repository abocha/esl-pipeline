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
    unsubscribe: vi.fn().mockResolvedValue(1),
    psubscribe: vi.fn().mockResolvedValue(1),
    punsubscribe: vi.fn().mockResolvedValue(1),
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
  beforeEach(async () => {
    vi.resetModules();
    createRedisClientMock.mockReset();
    const bridgeModule = await import('../src/infrastructure/job-event-redis-bridge');
    bridgeModule.resetJobEventBridgeForTests();
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
    const dispose = jobEvents.subscribeJobEvents(event => received.push(event), {
      jobIds: ['job-1'],
    });

    await new Promise(resolve => setImmediate(resolve));

    const job = makeJob('queued');
    jobEvents.publishJobEvent({ type: 'job_created', job });

    expect(subscriber.subscribe).toHaveBeenCalledWith('batch_job_events:job-1');

    // Publishes to targeted channel and legacy broadcast
    expect(publisher.publish).toHaveBeenCalledTimes(2);
    expect(publisher.publish.mock.calls[0][0]).toBe('batch_job_events:job-1');
    expect(publisher.publish.mock.calls[1][0]).toBe('batch_job_events');

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

    // Targeted channel delivery
    subscriber.emit('message', 'batch_job_events:job-1', remotePayload);

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual({ type: 'job_created', job });
    expect(received[1].type).toBe('job_state_changed');
    expect(received[1].job.state).toBe('running');
    expect(received[1].job.startedAt).toEqual(new Date('2024-01-01T00:01:00.000Z'));

    dispose();
  });

  it('avoids duplicate delivery when wildcard and targeted subscribers coexist', async () => {
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

    const received: string[] = [];
    const disposeAll = jobEvents.subscribeJobEvents(event => received.push(event.type), {
      allJobs: true,
    });
    const disposeTargeted = jobEvents.subscribeJobEvents(event => received.push(event.type), {
      jobIds: ['job-1'],
    });

    await new Promise(resolve => setImmediate(resolve));

    const job = makeJob('queued');
    const payload = JSON.stringify({
      sourceId: 'remote-instance',
      type: 'job_state_changed',
      job: {
        ...job,
        state: 'running',
        startedAt: '2024-01-01T00:02:00.000Z',
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        finishedAt: null,
        error: null,
        manifestPath: null,
      },
    });

    subscriber.emit('message', 'batch_job_events', payload);

    // Should deliver once per local listener, not multiplied by channel overlap
    expect(received).toEqual(['job_state_changed', 'job_state_changed']);

    disposeAll();
    disposeTargeted();
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
