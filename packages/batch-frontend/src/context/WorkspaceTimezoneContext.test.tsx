import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessSettings } from '../utils/api';
import { formatTutorTime } from '../utils/tutor-time';
import {
  useWorkspaceSettings,
  useWorkspaceTimezone,
  WorkspaceTimezoneProvider,
} from './WorkspaceTimezoneContext';

const getBusinessSettings = vi.hoisted(() => vi.fn());
vi.mock('../utils/api', () => ({ getBusinessSettings }));

const settings = (timezone: string) =>
  ({ workspaceId: 'workspace-1', timezone }) as BusinessSettings;
function Clock() {
  const timezone = useWorkspaceTimezone();
  const workspace = useWorkspaceSettings();
  return (
    <>
      <output>{formatTutorTime('2026-10-28T03:00:00Z', timezone)}</output>
      <button type="button" onClick={() => workspace.setSettings(settings('Asia/Kathmandu'))}>
        Change clock
      </button>
      <button type="button" onClick={() => void workspace.refreshSettings()}>
        Refresh clock
      </button>
    </>
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('authenticated workspace clock', () => {
  beforeEach(() => vi.clearAllMocks());
  it('shows no guessed clock during loading or failure and recovers through Retry', async () => {
    getBusinessSettings
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(settings('Asia/Saigon'));
    render(
      <WorkspaceTimezoneProvider onLogout={vi.fn()}>
        <Clock />
      </WorkspaceTimezoneProvider>,
    );
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect((await screen.findByRole('status')).textContent).toBe('Oct 28, 2026, 10:00 AM');
    expect(getBusinessSettings).toHaveBeenCalledTimes(2);
  });
  it('discards a previous auth scope and its late response before rendering another workspace', async () => {
    const old = deferred<BusinessSettings>();
    getBusinessSettings
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(settings('America/New_York'));
    const view = render(
      <WorkspaceTimezoneProvider key="old-user" onLogout={vi.fn()}>
        <Clock />
      </WorkspaceTimezoneProvider>,
    );
    view.rerender(
      <WorkspaceTimezoneProvider key="new-user" onLogout={vi.fn()}>
        <Clock />
      </WorkspaceTimezoneProvider>,
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect((await screen.findByRole('status')).textContent).toBe('Oct 27, 2026, 11:00 PM');
    await act(async () => old.resolve(settings('Asia/Saigon')));
    expect(screen.getByRole('status').textContent).toBe('Oct 27, 2026, 11:00 PM');
  });
  it('propagates a saved clock to consumers without a reload or browser-zone fallback', async () => {
    getBusinessSettings.mockResolvedValue(settings('Asia/Ho_Chi_Minh'));
    render(
      <WorkspaceTimezoneProvider onLogout={vi.fn()}>
        <Clock />
      </WorkspaceTimezoneProvider>,
    );
    expect((await screen.findByRole('status')).textContent).toContain('10:00 AM');
    fireEvent.click(screen.getByRole('button', { name: 'Change clock' }));
    expect(screen.getByRole('status').textContent).toBe('Oct 28, 2026, 8:45 AM');
    expect(getBusinessSettings).toHaveBeenCalledTimes(1);
  });
  it('does not let a late settings read overwrite a successful save or a newer read', async () => {
    const old = deferred<BusinessSettings>();
    const newer = deferred<BusinessSettings>();
    getBusinessSettings
      .mockResolvedValueOnce(settings('Asia/Ho_Chi_Minh'))
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(newer.promise);
    render(
      <WorkspaceTimezoneProvider onLogout={vi.fn()}>
        <Clock />
      </WorkspaceTimezoneProvider>,
    );
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh clock' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change clock' }));
    await act(async () => old.resolve(settings('America/Los_Angeles')));
    expect(screen.getByRole('status').textContent).toContain('8:45 AM');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh clock' }));
    await act(async () => newer.resolve(settings('Europe/London')));
    expect(screen.getByRole('status').textContent).toBe('Oct 28, 2026, 3:00 AM');
  });
});
