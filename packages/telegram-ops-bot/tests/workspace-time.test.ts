import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createCommandRegistry,
  loadFinishedJobsView,
  loadJobsViewFromKey,
  loadTodayView,
} from '../src/commands.js';
import { formatLocalizedDateTime } from '../src/formatter.js';
import { decodeGuidedCallback, encodeGuidedCallback } from '../src/guided-callbacks.js';
import { workspaceDate, workspaceDayStart } from '../src/workspace-time.js';
import { createBaseContext, createJob } from './telegram-test-fixtures.js';

function configuredContext(timezone: string) {
  const context = createBaseContext({ command: 'jobs' });
  vi.mocked(context.backend.getBusinessSettings).mockResolvedValue({ timezone } as never);
  vi.mocked(context.backend.listJobs).mockResolvedValue({
    jobs: [],
    total: 0,
    offset: 0,
    limit: 10,
  });
  vi.mocked(context.backend.getAdminJobSummary).mockResolvedValue({
    total: 0,
    byState: {},
  } as never);
  return context;
}

afterEach(() => vi.useRealTimers());

describe('workspace tutor clock in Telegram', () => {
  it('formats the same instant in the configured clock without a device fallback', () => {
    expect(formatLocalizedDateTime('2026-10-28T03:00:00Z', 'Asia/Saigon')).toBe(
      '2026-10-28 10:00 Asia/Saigon',
    );
    expect(formatLocalizedDateTime('2026-10-28T03:00:00Z', 'Asia/Kathmandu')).toBe(
      '2026-10-28 08:45 Asia/Kathmandu',
    );
    expect(formatLocalizedDateTime('2026-10-28T03:00:00Z')).toBe('\u2014');
  });

  it('queries Today from workspace midnight when UTC is still on yesterday', async () => {
    const context = configuredContext('Asia/Kathmandu');
    const view = await loadTodayView(context, new Date('2026-10-27T20:00:00Z'));
    expect(context.backend.getAdminJobSummary).toHaveBeenCalledWith({
      from: '2026-10-27T18:15:00.000Z',
      to: '2026-10-27T20:00:00.000Z',
    });
    expect(view.html).toContain('Today \u00b7 2026-10-28 Asia/Kathmandu');
  });

  it('uses calendar boundaries across both short and long DST days', async () => {
    expect(workspaceDayStart('2026-03-29', 'Europe/London').toISOString()).toBe(
      '2026-03-29T00:00:00.000Z',
    );
    expect(workspaceDayStart('2026-03-30', 'Europe/London').toISOString()).toBe(
      '2026-03-29T23:00:00.000Z',
    );
    expect(workspaceDayStart('2026-10-25', 'Europe/London').toISOString()).toBe(
      '2026-10-24T23:00:00.000Z',
    );
    expect(workspaceDayStart('2026-10-26', 'Europe/London').toISOString()).toBe(
      '2026-10-26T00:00:00.000Z',
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T10:00:00Z'));
    const context = configuredContext('Europe/London');
    context.args = ['yesterday'];
    await createCommandRegistry().resolve('jobs')!.execute(context);
    expect(context.backend.listJobs).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-10-24T23:00:00.000Z', to: '2026-10-26T00:00:00.000Z' }),
    );
    expect(workspaceDate(new Date('2026-03-29T23:30:00Z'), 'Europe/London')).toBe('2026-03-30');
  });

  it('preserves both fractional-offset filter boundaries and full job UUID in return callbacks', async () => {
    const context = configuredContext('Asia/Kathmandu');
    const jobId = '72444fdf-4abe-43ce-9166-5a1529c2e6cb';
    vi.mocked(context.backend.listJobs).mockResolvedValue({
      jobs: [createJob({ jobId })],
      total: 1,
      offset: 0,
      limit: 10,
    });
    context.args = ['since:2026-10-28', 'before:2026-10-29'];
    await createCommandRegistry().resolve('jobs')!.execute(context);
    const message = vi.mocked(context.messenger.sendHtmlMessage).mock.calls[0]![0];
    const callback = message.replyMarkup!.inline_keyboard[0]![0]!.callback_data;
    expect(Buffer.byteLength(callback)).toBeLessThanOrEqual(64);
    const action = decodeGuidedCallback(callback);
    expect(action).toMatchObject({ kind: 'job', jobId });
    if (action?.kind !== 'job' || !action.backViewKey) throw new Error('Missing return filter');
    await loadJobsViewFromKey(context, action.backViewKey);
    expect(context.backend.listJobs).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: '2026-10-27T18:15:00.000Z', to: '2026-10-28T18:15:00.000Z' }),
    );
  });

  it('reads accepted legacy UTC-day filters and rejects malformed UUID encoding', async () => {
    const context = configuredContext('Asia/Saigon');
    // Version 1 / since 2026-10-28, absent until/student.
    const day = Math.floor(Date.parse('2026-10-28T00:00:00Z') / 86400000)
      .toString(36)
      .padStart(3, '0');
    await loadJobsViewFromKey(context, `q:10ad${day}zzz____________`);
    expect(context.backend.listJobs).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: '2026-10-28T00:00:00.000Z', to: null }),
    );
    const key = `q:20ad${'zzzzzz'.repeat(2)}____________` as const;
    expect(decodeGuidedCallback(`a4|j|~${'a'.repeat(21)}!|${key}`)).toBeNull();
    expect(decodeGuidedCallback(`a4|j|~${'a'.repeat(21)}B|${key}`)).toBeNull();
    expect(
      decodeGuidedCallback(
        encodeGuidedCallback({
          kind: 'job',
          jobId: '72444fdf-4abe-43ce-9166-5a1529c2e6cb',
          backViewKey: key,
        }),
      ),
    ).toMatchObject({ jobId: '72444fdf-4abe-43ce-9166-5a1529c2e6cb' });
  });

  it('fails closed when settings are unavailable and reloads settings for the next authenticated command', async () => {
    const first = configuredContext('Asia/Saigon');
    vi.mocked(first.backend.getBusinessSettings).mockRejectedValue(
      new Error('settings unavailable'),
    );
    await expect(loadTodayView(first)).rejects.toThrow('settings unavailable');
    expect(first.backend.listJobs).not.toHaveBeenCalled();
    const second = configuredContext('Europe/London');
    vi.mocked(second.backend.getFinishedJobs).mockResolvedValue({
      jobs: [
        createJob({
          createdAt: '2026-10-28T03:00:00Z',
          finishedAt: null,
          updatedAt: '2026-10-28T03:00:00Z',
        }),
      ],
      total: 1,
      limit: 10,
      offset: 0,
    });
    expect((await loadFinishedJobsView(second)).html).toContain('2026-10-28 03:00 Europe/London');
    const missing = configuredContext('UTC');
    vi.mocked(missing.backend.getBusinessSettings).mockResolvedValue({} as never);
    await expect(loadTodayView(missing)).rejects.toThrow('Workspace timezone unavailable');
  });
  it('observes a settings change on the next command sharing the authenticated backend', async () => {
    const first = configuredContext('Asia/Saigon');
    const job = createJob({
      createdAt: '2026-10-28T03:00:00Z',
      updatedAt: '2026-10-28T03:00:00Z',
      finishedAt: null,
    });
    vi.mocked(first.backend.getFinishedJobs).mockResolvedValue({
      jobs: [job],
      total: 1,
      offset: 0,
      limit: 10,
    });
    expect((await loadFinishedJobsView(first)).html).toContain('2026-10-28 10:00 Asia/Saigon');
    vi.mocked(first.backend.getBusinessSettings).mockResolvedValue({
      timezone: 'Europe/London',
    } as never);
    const second = createBaseContext({ backend: first.backend });
    expect((await loadFinishedJobsView(second)).html).toContain('2026-10-28 03:00 Europe/London');
    expect(first.backend.getBusinessSettings).toHaveBeenCalledTimes(2);
  });

  it('does not enqueue an action when its authoritative clock cannot be loaded', async () => {
    const context = configuredContext('UTC');
    vi.mocked(context.backend.getBusinessSettings).mockRejectedValue(
      new Error('settings unavailable'),
    );
    await expect(createCommandRegistry().resolve('backup')!.execute(context)).rejects.toThrow(
      'settings unavailable',
    );
    expect(context.backend.enqueueOpsAction).not.toHaveBeenCalled();
  });
});
