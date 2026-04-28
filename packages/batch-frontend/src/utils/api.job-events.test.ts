import { beforeEach, describe, expect, it, vi } from 'vitest';

import { subscribeToJobEvents } from './api';
import { buildApiProxyPath, getApiAuthToken } from './api-client';

vi.mock('./api-client', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
  },
  buildApiProxyPath: vi.fn((path: string) => `/api${path}`),
  getApiAuthToken: vi.fn(() => null),
  handleApiError: vi.fn(),
  isAuthError: vi.fn(),
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, EventListenerOrEventListenerObject[]>();

  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close = vi.fn();
}

describe('subscribeToJobEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  it('builds targeted job and recording subscriptions by default', () => {
    subscribeToJobEvents(vi.fn(), {
      jobIds: ['job-1', 'job-2', 'job-1'],
      recordingIds: ['recording-1'],
    });

    expect(buildApiProxyPath).toHaveBeenCalledWith('/jobs/events');
    expect(FakeEventSource.instances).toHaveLength(1);
    const url = new URL(FakeEventSource.instances[0]!.url, 'http://localhost');
    expect(url.pathname).toBe('/api/jobs/events');
    expect(url.searchParams.get('jobId')).toBe('job-1,job-2');
    expect(url.searchParams.get('recordingId')).toBe('recording-1');
  });

  it('requires all-jobs subscriptions to be explicit and keeps auth token query params', () => {
    vi.mocked(getApiAuthToken).mockReturnValueOnce('token-123');

    subscribeToJobEvents(vi.fn(), { allJobs: true });

    const url = new URL(FakeEventSource.instances[0]!.url, 'http://localhost');
    expect(url.searchParams.get('jobId')).toBe('*');
    expect(url.searchParams.get('access_token')).toBe('token-123');
  });

  it('aborts by closing the EventSource', () => {
    const controller = new AbortController();

    subscribeToJobEvents(vi.fn(), { jobIds: ['job-1'], signal: controller.signal });
    controller.abort();

    expect(FakeEventSource.instances[0]!.close).toHaveBeenCalledTimes(1);
  });
});
