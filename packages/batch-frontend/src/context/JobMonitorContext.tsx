import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { JobEvent, JobState, JobStatus, SubmitJobRequest } from '../utils/api';
import { getJobStatus, subscribeToJobEvents } from '../utils/api';

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error' | 'reconnecting' | 'paused';

export type JobEntry = JobStatus & {
  fileName?: string;
  submittedAt?: string;
};

type JobMap = Record<string, JobEntry>;

interface RegisterJobOptions {
  jobId: string;
  fileName?: string;
  md?: string | null;
  preset?: string;
  notionDatabase?: string;
  withTts?: boolean;
  mode?: SubmitJobRequest['mode'];
}

interface JobMonitorContextValue {
  jobs: JobEntry[];
  jobMap: JobMap;
  registerJob: (options: RegisterJobOptions) => void;
  trackJob: (jobId: string) => Promise<JobEntry | undefined>;
  connectionState: ConnectionState;
  isPolling: boolean;
  lastError: string | null;
  liveUpdatesPaused: boolean;
  pauseLiveUpdates: () => void;
  resumeLiveUpdates: () => void;
}

const JobMonitorContext = createContext<JobMonitorContextValue | undefined>(undefined);

const isBrowser = typeof window !== 'undefined';
const ACTIVE_JOBS_STORAGE_KEY = 'esl-active-jobs';

const isTerminalState = (state: JobState): boolean => state === 'succeeded' || state === 'failed';

const createDefaultJob = (jobId: string): JobEntry => {
  const now = new Date().toISOString();
  return {
    jobId,
    md: '',
    preset: null,
    withTts: true,
    voiceId: null,
    upload: 's3',
    voiceAccent: null,
    forceTts: null,
    notionDatabase: null,
    mode: 'auto',
    notionUrl: null,
    state: 'queued',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    manifestPath: null,
    error: null,
  };
};

const buildJobMap = (entries: JobEntry[]): JobMap =>
  entries.reduce<JobMap>((acc, job) => {
    acc[job.jobId] = { ...createDefaultJob(job.jobId), ...job };
    return acc;
  }, {});

const loadPersistedActiveJobs = (): JobMap => {
  if (!isBrowser) return {};
  const serialized = window.localStorage.getItem(ACTIVE_JOBS_STORAGE_KEY);
  if (!serialized) return {};

  try {
    const parsed = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return {};
    const entries = parsed
      .map((item) => (item && typeof item.jobId === 'string' ? item : null))
      .filter((item): item is JobEntry => item !== null)
      .map((job) => ({ ...createDefaultJob(job.jobId), ...job }));
    return buildJobMap(entries);
  } catch (error) {
    console.warn('Failed to restore active jobs from storage', error);
    window.localStorage.removeItem(ACTIVE_JOBS_STORAGE_KEY);
    return {};
  }
};

const persistActiveJobs = (jobs: JobMap) => {
  if (!isBrowser) return;
  const activeJobs = Object.values(jobs).filter(
    (job) => job.jobId && !isTerminalState(job.state),
  );
  if (activeJobs.length === 0) {
    window.localStorage.removeItem(ACTIVE_JOBS_STORAGE_KEY);
    return;
  }
  try {
    window.localStorage.setItem(ACTIVE_JOBS_STORAGE_KEY, JSON.stringify(activeJobs));
  } catch (error) {
    console.warn('Failed to persist active jobs', error);
  }
};

export function JobMonitorProvider({ children }: { children: ReactNode }) {
  const persistedJobsRef = useRef<JobMap>(loadPersistedActiveJobs());
  const [jobs, setJobs] = useState<JobMap>(persistedJobsRef.current);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const jobsRef = useRef<JobMap>(jobs);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingInFlightRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const eventSourceAbortRef = useRef<AbortController | null>(null);
  const [liveUpdatesPaused, setLiveUpdatesPaused] = useState(false);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    persistActiveJobs(jobs);
  }, [jobs]);

  const updateJob = useCallback((jobId: string, mutator: (prev: JobEntry) => JobEntry) => {
    setJobs((prev) => {
      const previous = prev[jobId] ?? createDefaultJob(jobId);
      const next = mutator(previous);
      return {
        ...prev,
        [jobId]: next,
      };
    });
  }, []);

  const registerJob = useCallback(
    ({ jobId, fileName, md, preset, notionDatabase, withTts, mode }: RegisterJobOptions) => {
      const now = new Date().toISOString();
      updateJob(jobId, (prev) => ({
        ...prev,
        jobId,
        fileName: fileName ?? prev.fileName,
        md: md ?? prev.md,
        preset: preset ?? prev.preset,
        notionDatabase: notionDatabase ?? prev.notionDatabase,
        withTts: withTts ?? prev.withTts,
        submittedAt: prev.submittedAt ?? now,
        updatedAt: now,
        createdAt: prev.createdAt ?? now,
        error: null,
        finishedAt: null,
        state: prev.state,
        mode: mode ?? prev.mode ?? 'auto',
      }));
    },
    [updateJob],
  );

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const runPolling = useCallback(async () => {
    if (pollingInFlightRef.current) return;
    const activeJobIds = Object.values(jobsRef.current)
      .filter((job) => !isTerminalState(job.state))
      .map((job) => job.jobId);

    if (activeJobIds.length === 0) {
      stopPolling();
      return;
    }

    pollingInFlightRef.current = true;
    try {
      const results = await Promise.allSettled(
        activeJobIds.map((jobId) => getJobStatus(jobId).then((status) => ({ jobId, status }))),
      );
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { jobId, status } = result.value;
          updateJob(jobId, (prev) => ({
            ...prev,
            ...status,
            fileName: prev.fileName,
            md: status.md ?? prev.md,
            updatedAt: status.updatedAt ?? prev.updatedAt,
          }));
        }
      }
    } finally {
      pollingInFlightRef.current = false;
    }
  }, [stopPolling, updateJob]);

  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) return;
    setIsPolling(true);
    pollingIntervalRef.current = setInterval(runPolling, 5000);
    void runPolling();
  }, [runPolling]);

  const handleJobEvent = useCallback(
    (event: JobEvent) => {
      if (event.type !== 'job_state_changed') return;
      updateJob(event.jobId, (prev) => ({
        ...prev,
        state: event.state,
        manifestPath: event.payload?.manifestPath ?? prev.manifestPath,
        error: event.payload?.error ?? prev.error,
        finishedAt: event.payload?.finishedAt ?? prev.finishedAt,
        mode: event.payload?.mode ?? prev.mode,
        md: event.payload?.md ?? prev.md,
        notionUrl: event.payload?.notionUrl ?? prev.notionUrl,
        updatedAt: new Date().toISOString(),
      }));
    },
    [updateJob],
  );

  const connectEventSource = useCallback(() => {
    if (liveUpdatesPaused) {
      return;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    eventSourceAbortRef.current?.abort();
    const abortController = new AbortController();
    eventSourceAbortRef.current = abortController;
    setConnectionState((prev) =>
      prev === 'connected'
        ? 'connected'
        : reconnectAttemptRef.current
          ? 'reconnecting'
          : 'connecting',
    );
    setLastError(null);

    subscribeToJobEvents(handleJobEvent, {
      signal: abortController.signal,
      onOpen: () => {
        reconnectAttemptRef.current = 0;
        setConnectionState('connected');
        setLastError(null);
        stopPolling();
      },
      onError: (_event) => {
        if (abortController.signal.aborted) {
          return;
        }
        reconnectAttemptRef.current += 1;
        setConnectionState('error');
        setLastError('Live updates disconnected. Retrying…');
        startPolling();
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        const delay = Math.min(30_000, 1000 * 2 ** reconnectAttemptRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          connectEventSource();
        }, delay);
      },
    });
  }, [handleJobEvent, startPolling, stopPolling, liveUpdatesPaused]);

  useEffect(() => {
    if (liveUpdatesPaused) {
      eventSourceAbortRef.current?.abort();
      startPolling();
      return;
    }
    connectEventSource();
    return () => {
      eventSourceAbortRef.current?.abort();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      stopPolling();
    };
  }, [connectEventSource, stopPolling, liveUpdatesPaused, startPolling]);

  const pauseLiveUpdates = useCallback(() => {
    if (liveUpdatesPaused) return;
    setConnectionState('paused');
    setLiveUpdatesPaused(true);
    eventSourceAbortRef.current?.abort();
    startPolling();
  }, [liveUpdatesPaused, startPolling]);

  const resumeLiveUpdates = useCallback(() => {
    if (!liveUpdatesPaused) return;
    setConnectionState('connecting');
    setLiveUpdatesPaused(false);
    reconnectAttemptRef.current = 0;
    connectEventSource();
  }, [liveUpdatesPaused, connectEventSource]);

  const trackJob = useCallback(
    async (jobId: string) => {
      const trimmed = jobId.trim();
      if (!trimmed) return undefined;
      updateJob(trimmed, (prev) => ({ ...prev, jobId: trimmed }));

      try {
        const status = await getJobStatus(trimmed);
        let nextSnapshot: JobEntry | undefined;
        updateJob(trimmed, (prev) => {
          const next = {
            ...prev,
            ...status,
            fileName: prev.fileName,
            md: status.md ?? prev.md,
          };
          nextSnapshot = next;
          return next;
        });
        return nextSnapshot;
      } catch (error: unknown) {
        updateJob(trimmed, (prev) => ({
          ...prev,
          jobId: trimmed,
          state: 'failed',
          error: error instanceof Error ? error.message : 'Unable to fetch job status.',
          updatedAt: new Date().toISOString(),
        }));
        throw error;
      }
    },
    [updateJob],
  );

  const hydratedFromStorageRef = useRef(false);
  useEffect(() => {
    if (hydratedFromStorageRef.current) return;
    hydratedFromStorageRef.current = true;
    const entries = Object.values(persistedJobsRef.current);
    if (entries.length === 0) return;
    for (const job of entries) {
      void trackJob(job.jobId);
    }
  }, [trackJob]);

  const jobsArray = useMemo(() => {
    return Object.values(jobs).sort((a, b) => {
      const aTime = a.updatedAt ?? '';
      const bTime = b.updatedAt ?? '';
      return bTime.localeCompare(aTime);
    });
  }, [jobs]);

  const value = useMemo<JobMonitorContextValue>(
    () => ({
      jobs: jobsArray,
      jobMap: jobs,
      registerJob,
      trackJob,
      connectionState,
      isPolling,
      lastError,
      liveUpdatesPaused,
      pauseLiveUpdates,
      resumeLiveUpdates,
    }),
    [
      jobs,
      jobsArray,
      registerJob,
      trackJob,
      connectionState,
      isPolling,
      lastError,
      liveUpdatesPaused,
      pauseLiveUpdates,
      resumeLiveUpdates,
    ],
  );

  return <JobMonitorContext.Provider value={value}>{children}</JobMonitorContext.Provider>;
}

export function useJobMonitor(): JobMonitorContextValue {
  const context = useContext(JobMonitorContext);
  if (!context) {
    throw new Error('useJobMonitor must be used within a JobMonitorProvider');
  }
  return context;
}
