import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useJobMonitor } from './JobMonitorContext';
import toast from 'react-hot-toast';

type NotificationPermissionState = 'default' | 'granted' | 'denied';

interface NotificationContextValue {
  permission: NotificationPermissionState;
  requestPermission: () => Promise<NotificationPermissionState>;
  notifyBatchComplete: (jobIds: string[]) => Promise<void>;
  notifyJobFailure: (jobId: string, error?: string | null) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

const isBrowser = typeof window !== 'undefined' && typeof Notification !== 'undefined';

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [permission, setPermission] = useState<NotificationPermissionState>(() => {
    if (!isBrowser) return 'denied';
    return Notification.permission;
  });

  const { jobs } = useJobMonitor();
  const lastNotifiedBatchRef = useRef<number>(0);
  const failedJobsRef = useRef<Set<string>>(new Set());

  const requestPermission = useCallback(async () => {
    if (!isBrowser) {
      toast.error('Browser notifications are not supported in this environment.');
      return 'denied';
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    } catch (error: any) {
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
    [permission]
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
    [permission]
  );

  const hadActiveJobsRef = useRef(false);
  const currentBatchStartedRef = useRef(false);
  const currentBatchHasFailureRef = useRef(false);

  useEffect(() => {
    if (!isBrowser || permission !== 'granted') return;

    const hasActiveJobs = jobs.some(job => job.state === 'queued' || job.state === 'running');
    if (hasActiveJobs && !hadActiveJobsRef.current) {
      currentBatchStartedRef.current = true;
      currentBatchHasFailureRef.current = false;
    }
    hadActiveJobsRef.current = hasActiveJobs;

    const failedJobs = jobs.filter(job => job.state === 'failed');
    failedJobs.forEach(job => {
      if (!failedJobsRef.current.has(job.jobId)) {
        void notifyJobFailure(job.jobId, job.error);
        failedJobsRef.current.add(job.jobId);
        currentBatchHasFailureRef.current = true;
      }
    });

    const succeededJobs = jobs.filter(job => job.state === 'succeeded');
    if (
      !hasActiveJobs &&
      currentBatchStartedRef.current &&
      !currentBatchHasFailureRef.current &&
      succeededJobs.length > 0
    ) {
      if (succeededJobs.length !== lastNotifiedBatchRef.current) {
        lastNotifiedBatchRef.current = succeededJobs.length;
        void notifyBatchComplete(succeededJobs.map(job => job.jobId));
      }
      currentBatchStartedRef.current = false;
    }

    if (!hasActiveJobs && currentBatchHasFailureRef.current) {
      currentBatchStartedRef.current = false;
    }
  }, [jobs, permission, notifyBatchComplete, notifyJobFailure]);

  const value = useMemo(
    () => ({
      permission,
      requestPermission,
      notifyBatchComplete,
      notifyJobFailure,
    }),
    [permission, requestPermission, notifyBatchComplete, notifyJobFailure]
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
