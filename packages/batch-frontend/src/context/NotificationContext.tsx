import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type React from 'react';
import toast, { resolveValue, useToasterStore } from 'react-hot-toast';

import { useJobMonitor } from './JobMonitorContext';

type NotificationPermissionState = 'default' | 'granted' | 'denied';
type NotificationToastType = 'success' | 'error' | 'loading' | 'blank' | 'custom';

export interface NotificationLogEntry {
  id: string;
  type: NotificationToastType;
  message: string;
  createdAt: number;
}

interface NotificationContextValue {
  permission: NotificationPermissionState;
  requestPermission: () => Promise<NotificationPermissionState>;
  disableNotifications: () => void;
  notifyBatchComplete: (jobIds: string[]) => Promise<void>;
  notifyJobFailure: (jobId: string, error?: string | null) => Promise<void>;
  logEntries: NotificationLogEntry[];
  clearLog: () => void;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

const isBrowser = globalThis.window !== undefined && typeof Notification !== 'undefined';

// Key for localStorage to persist user's notification preference across navigation
const NOTIFICATIONS_DISABLED_KEY = 'esl-notifications-disabled';
const MAX_LOG_ENTRIES = 50;

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Track if user has explicitly disabled notifications (separate from browser permission)
  const [_userDisabled, setUserDisabled] = useState<boolean>(() => {
    if (!isBrowser) return false;
    return globalThis.localStorage?.getItem(NOTIFICATIONS_DISABLED_KEY) === 'true';
  });

  const [permission, setPermission] = useState<NotificationPermissionState>(() => {
    if (!isBrowser) return 'denied';
    // If user has explicitly disabled, report as denied
    if (globalThis.localStorage?.getItem(NOTIFICATIONS_DISABLED_KEY) === 'true') return 'denied';
    return Notification.permission;
  });

  const { jobs } = useJobMonitor();
  const { toasts } = useToasterStore();
  const lastNotifiedBatchRef = useRef<number>(0);
  const failedJobsRef = useRef<Set<string>>(new Set());
  const seenToastRef = useRef<Map<string, string>>(new Map());
  const [logEntries, setLogEntries] = useState<NotificationLogEntry[]>([]);

  const requestPermission = useCallback(async () => {
    if (!isBrowser) {
      toast.error('Browser notifications are not supported in this environment.');
      return 'denied';
    }
    try {
      // Clear the user-disabled flag when requesting permission
      globalThis.localStorage?.removeItem(NOTIFICATIONS_DISABLED_KEY);
      setUserDisabled(false);

      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    } catch (error: unknown) {
      console.error('Failed to request notification permission', error);
      toast.error('Unable to request notification permission.');
      return 'denied';
    }
  }, []);

  const notifyBatchComplete = useCallback(
    async (jobIds: string[]) => {
      if (!isBrowser || permission !== 'granted') return;
      const text =
        jobIds.length === 1
          ? `Job ${jobIds[0]} finished successfully.`
          : `All ${jobIds.length} jobs in this batch finished successfully.`;
      new Notification('ESL Pipeline – Batch Complete', {
        body: text,
        icon: '/favicon.ico',
      });
    },
    [permission],
  );

  const notifyJobFailure = useCallback(
    async (jobId: string, error?: string | null) => {
      if (!isBrowser || permission !== 'granted') return;
      const body = error ? `Job ${jobId} failed: ${error}` : `Job ${jobId} failed.`;
      new Notification('ESL Pipeline – Job Failed', {
        body,
        icon: '/favicon.ico',
      });
    },
    [permission],
  );

  const disableNotifications = useCallback(() => {
    // Persist the user's preference to localStorage
    globalThis.localStorage?.setItem(NOTIFICATIONS_DISABLED_KEY, 'true');
    setUserDisabled(true);
    setPermission('denied');
  }, []);

  const hadActiveJobsRef = useRef(false);
  const currentBatchStartedRef = useRef(false);
  const currentBatchHasFailureRef = useRef(false);

  useEffect(() => {
    if (!isBrowser || permission !== 'granted') return;

    const hasActiveJobs = jobs.some(
      (job) =>
        job.state === 'queued' || job.state === 'running' || job.state === 'awaiting_approval',
    );
    if (hasActiveJobs && !hadActiveJobsRef.current) {
      currentBatchStartedRef.current = true;
      currentBatchHasFailureRef.current = false;
    }
    hadActiveJobsRef.current = hasActiveJobs;

    const failedJobs = jobs.filter((job) => job.state === 'failed');
    for (const job of failedJobs) {
      if (!failedJobsRef.current.has(job.jobId)) {
        void notifyJobFailure(job.jobId, job.error);
        failedJobsRef.current.add(job.jobId);
        currentBatchHasFailureRef.current = true;
      }
    }

    const succeededJobs = jobs.filter((job) => job.state === 'succeeded');
    if (
      !hasActiveJobs &&
      currentBatchStartedRef.current &&
      !currentBatchHasFailureRef.current &&
      succeededJobs.length > 0
    ) {
      if (succeededJobs.length !== lastNotifiedBatchRef.current) {
        lastNotifiedBatchRef.current = succeededJobs.length;
        void notifyBatchComplete(succeededJobs.map((job) => job.jobId));
      }
      currentBatchStartedRef.current = false;
    }

    if (!hasActiveJobs && currentBatchHasFailureRef.current) {
      currentBatchStartedRef.current = false;
    }
  }, [jobs, permission, notifyBatchComplete, notifyJobFailure]);

  useEffect(() => {
    const currentIds = new Set(toasts.map((toastItem) => toastItem.id));
    for (const id of seenToastRef.current.keys()) {
      if (!currentIds.has(id)) {
        seenToastRef.current.delete(id);
      }
    }

    if (toasts.length === 0) return;

    setLogEntries((prev) => {
      let next = prev;
      for (const toastItem of toasts) {
        const resolved = resolveValue(toastItem.message, toastItem);
        const message =
          typeof resolved === 'string'
            ? resolved
            : typeof resolved === 'number'
              ? String(resolved)
              : 'Notification';
        const signature = `${toastItem.type}|${message}`;
        if (seenToastRef.current.get(toastItem.id) === signature) {
          continue;
        }
        seenToastRef.current.set(toastItem.id, signature);

        const entry: NotificationLogEntry = {
          id: toastItem.id,
          type: toastItem.type,
          message,
          createdAt: toastItem.createdAt,
        };

        const existingIndex = next.findIndex((item) => item.id === toastItem.id);
        if (existingIndex === -1) {
          next = [entry, ...next];
        } else {
          const copy = [...next];
          copy[existingIndex] = entry;
          next = copy;
        }
      }

      if (next.length > MAX_LOG_ENTRIES) {
        next = next.slice(0, MAX_LOG_ENTRIES);
      }

      return next;
    });
  }, [toasts]);

  const clearLog = useCallback(() => {
    setLogEntries([]);
    seenToastRef.current.clear();
  }, []);

  const value = useMemo(
    () => ({
      permission,
      requestPermission,
      disableNotifications,
      notifyBatchComplete,
      notifyJobFailure,
      logEntries,
      clearLog,
    }),
    [
      permission,
      requestPermission,
      disableNotifications,
      notifyBatchComplete,
      notifyJobFailure,
      logEntries,
      clearLog,
    ],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
};

export const useNotification = (): NotificationContextValue => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};
