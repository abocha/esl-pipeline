import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { GlobalNotificationDrawer } from './GlobalNotificationDrawer';
import * as NotificationContext from '../../context/NotificationContext';
import { NotificationLogEntry } from '../../context/NotificationContext';

// Mock Icons
vi.mock('../shared/Icons', () => ({
    Icons: {
        Bell: () => <span data-testid="icon-bell" />,
        XMark: () => <span data-testid="icon-x" />,
    },
}));

vi.mock('../../context/NotificationContext', async (importOriginal) => {
    const actual = await importOriginal<typeof NotificationContext>();
    return {
        ...actual,
        useNotification: vi.fn(),
    };
});

describe('GlobalNotificationDrawer', () => {
    const mockClearLog = vi.fn();
    const defaultContextValue = {
        permission: 'granted' as const,
        requestPermission: vi.fn(),
        disableNotifications: vi.fn(),
        notifyBatchComplete: vi.fn(),
        notifyJobFailure: vi.fn(),
        logEntries: [] as NotificationLogEntry[],
        clearLog: mockClearLog,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(NotificationContext.useNotification).mockReturnValue(defaultContextValue);
    });

    afterEach(() => {
        cleanup();
    });

    it('renders bell icon with no badge when empty', () => {
        render(<GlobalNotificationDrawer />);
        expect(screen.getByTestId('icon-bell')).not.toBeNull();
        expect(screen.queryByText(/0/)).toBeNull();
    });

    it('renders badge count when there are notifications', () => {
        const entries: NotificationLogEntry[] = [
            { id: '1', type: 'success', message: 'Job done', createdAt: Date.now() },
            { id: '2', type: 'error', message: 'Job failed', createdAt: Date.now() },
        ];
        vi.mocked(NotificationContext.useNotification).mockReturnValue({
            ...defaultContextValue,
            logEntries: entries,
        });

        render(<GlobalNotificationDrawer />);
        expect(screen.getByText('2')).not.toBeNull();
    });

    it('opens drawer on bell click', async () => {
        render(<GlobalNotificationDrawer />);
        const trigger = screen.getByLabelText('Open notifications');
        fireEvent.click(trigger);

        await waitFor(() => {
            expect(screen.getByRole('dialog')).not.toBeNull();
            expect(screen.getByText('Notifications')).not.toBeNull();
        });
    });

    it('displays notifications in drawer', async () => {
        const timestamp = new Date('2023-01-01T12:00:00').getTime();
        const entries: NotificationLogEntry[] = [
            { id: '1', type: 'success', message: 'Job finished', createdAt: timestamp },
        ];
        vi.mocked(NotificationContext.useNotification).mockReturnValue({
            ...defaultContextValue,
            logEntries: entries,
        });

        render(<GlobalNotificationDrawer />);

        fireEvent.click(screen.getByLabelText('Open notifications'));

        await waitFor(() => {
            expect(screen.getByText('Job finished')).not.toBeNull();
        });
    });

    it('closes drawer on close button click', async () => {
        render(<GlobalNotificationDrawer />);
        fireEvent.click(screen.getByLabelText('Open notifications'));
        await waitFor(() => screen.getByRole('dialog'));

        fireEvent.click(screen.getByLabelText('Close notifications'));
        await waitFor(() => {
            expect(screen.queryByRole('dialog')).toBeNull();
        });
    });

    it('clears log when clear button clicked', async () => {
        const entries: NotificationLogEntry[] = [
            { id: '1', type: 'success', message: 'Msg', createdAt: Date.now() },
        ];
        vi.mocked(NotificationContext.useNotification).mockReturnValue({
            ...defaultContextValue,
            logEntries: entries,
        });

        render(<GlobalNotificationDrawer />);

        fireEvent.click(screen.getByLabelText('Open notifications'));
        await waitFor(() => screen.getByRole('dialog'));

        fireEvent.click(screen.getByText('Clear all'));
        expect(mockClearLog).toHaveBeenCalled();
    });
});
