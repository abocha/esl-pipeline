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

import type {
  JobEvent,
  JobState,
  JobStatus,
  RecordingListItem,
  RecordingStatus,
  SubmitJobRequest,
} from '../utils/api';
import { getJobStatus, listRecordings, subscribeToJobEvents } from '../utils/api';

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error' | 'reconnecting' | 'paused';

export type JobEntry = JobStatus & {
  fileName?: string;
  submittedAt?: string;
};

type JobMap = Record<string, JobEntry>;

export interface RecordingEntry {
  recordingId: string;
  status: RecordingStatus;
  transcriptId: string | null;
  error: string | null;
  source?: RecordingListItem['source'];
  studentId?: string | null;
  durationSec?: number | null;
  channels?: number | null;
  bytes?: number;
  createdAt: string;
  updatedAt: string;
}

type RecordingMap = Record<string, RecordingEntry>;

interface RegisterJobOptions {
  jobId: string;
  fileName?: string;
  md?: string | null;
  preset?: string;
  notionDatabase?: string;
  withTts?: boolean;
  ttsStrategy?: SubmitJobRequest['ttsStrategy'];
}

interface JobMonitorContextValue {
  jobs: JobEntry[];
  jobMap: JobMap;
  recordings: RecordingEntry[];
  recordingMap: RecordingMap;
  registerJob: (options: RegisterJobOptions) => void;
  registerRecording: (recordingId: string) => void;
  trackJob: (jobId: string) => Promise<JobEntry | undefined>;
  connectionState: ConnectionState;
  isPolling: boolean;
  lastError: string | null;
  liveUpdatesPaused: boolean;
  pauseLiveUpdates: () => void;
  resumeLiveUpdates: () => void;
}

const JobMonitorContext = createContext<JobMonitorContextValue | undefined>(undefined);

const isBrowser = globalThis.window !== undefined && globalThis.localStorage !== undefined;
const ACTIVE_JOBS_STORAGE_KEY = 'esl-active-jobs';

const isTerminalState = (state: JobState): boolean => state === 'succeeded' || state === 'failed';

const createDefaultJob = (jobId: string): JobEntry => {
  const now = new Date().toISOString();
  return {
    jobId,
    md: null,
    transcribeWorkdir: null,
    transcriptPath: null,
    promptPayload: null,
    promptNotes: null,
    profilePath: null,
    recordingId: null,
    transcriptId: null,
    promptPackageId: null,
    draftId: null,
    preset: null,
    withTts: true,
    voiceId: null,
    upload: 's3',
    voiceAccent: null,
    forceTts: null,
    notionDatabase: null,
    ttsStrategy: 'auto',
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

const createDefaultRecording = (recordingId: string): RecordingEntry => {
  const now = new Date().toISOString();
  return {
    recordingId,
    status: 'queued',
    transcriptId: null,
    error: null,
    source: 'scan',
    studentId: null,
    durationSec: null,
    channels: null,
    bytes: 0,
    createdAt: now,
    updatedAt: now,
  };
};

const buildJobMap = (entries: JobEntry[]): JobMap => {
  const map: JobMap = {};
  for (const job of entries) {
    map[job.jobId] = { ...createDefaultJob(job.jobId), ...job };
  }
  return map;
};

const loadPersistedActiveJobs = (): JobMap => {
  if (!isBrowser) return {};
  const serialized = globalThis.localStorage.getItem(ACTIVE_JOBS_STORAGE_KEY);
  if (!serialized) return {};

  try {
    const parsed = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return {};
    const entries = parsed
      .map((item) => (item && typeof item.jobId === 'string' ? item : null))
      .filter(
        (item): item is Partial<JobEntry> & { jobId: string; mode?: unknown } => item !== null,
      )
      .map((job) => ({
        ...createDefaultJob(job.jobId),
        ...job,
        ttsStrategy:
          job.ttsStrategy ??
          (typeof job.mode === 'string' ? (job.mode as JobEntry['ttsStrategy']) : undefined) ??
          'auto',
      }));
    return buildJobMap(entries);
  } catch (error) {
    console.warn('Failed to restore active jobs from storage', error);
    globalThis.localStorage.removeItem(ACTIVE_JOBS_STORAGE_KEY);
    return {};
  }
};

const persistActiveJobs = (jobs: JobMap) => {
  if (!isBrowser) return;
  const activeJobs = Object.values(jobs).filter((job) => job.jobId && !isTerminalState(job.state));
  if (activeJobs.length === 0) {
    globalThis.localStorage.removeItem(ACTIVE_JOBS_STORAGE_KEY);
    return;
  }
  try {
    globalThis.localStorage.setItem(ACTIVE_JOBS_STORAGE_KEY, JSON.stringify(activeJobs));
  } catch (error) {
    console.warn('Failed to persist active jobs', error);
  }
};

export function JobMonitorProvider({ children }: { children: ReactNode }) {
  const persistedJobsRef = useRef<JobMap>(loadPersistedActiveJobs());
  const [jobs, setJobs] = useState<JobMap>(persistedJobsRef.current);
  const [recordings, setRecordings] = useState<RecordingMap>({});
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

  const updateRecording = useCallback(
    (recordingId: string, mutator: (prev: RecordingEntry) => RecordingEntry) => {
      setRecordings((prev) => {
        const previous = prev[recordingId] ?? createDefaultRecording(recordingId);
        const next = mutator(previous);
        return {
          ...prev,
          [recordingId]: next,
        };
      });
    },
    [],
  );

  const registerJob = useCallback(
    ({ jobId, fileName, md, preset, notionDatabase, withTts, ttsStrategy }: RegisterJobOptions) => {
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
        ttsStrategy: ttsStrategy ?? prev.ttsStrategy ?? 'auto',
      }));
    },
    [updateJob],
  );

  const registerRecording = useCallback(
    (recordingId: string) => {
      const trimmed = recordingId.trim();
      if (!trimmed) return;
      updateRecording(trimmed, (prev) => ({
        ...prev,
        recordingId: trimmed,
        createdAt: prev.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    },
    [updateRecording],
  );

  const mergeRecordingList = useCallback((items: RecordingListItem[]) => {
    setRecordings((prev) => {
      const next = { ...prev };
      for (const item of items) {
        const existing = next[item.recordingId] ?? createDefaultRecording(item.recordingId);
        next[item.recordingId] = {
          ...existing,
          recordingId: item.recordingId,
          status: item.status,
          transcriptId: item.transcriptId ?? null,
          error: item.error ?? null,
          source: item.source,
          studentId: item.studentId ?? null,
          durationSec: item.durationSec ?? null,
          channels: item.channels ?? null,
          bytes: item.bytes ?? existing.bytes,
          createdAt: item.createdAt ?? existing.createdAt,
          updatedAt: item.updatedAt ?? existing.updatedAt,
        };
      }
      return next;
    });
  }, []);

  const recordingsHydratedRef = useRef(false);
  useEffect(() => {
    if (recordingsHydratedRef.current) return;
    recordingsHydratedRef.current = true;

    const loadRecordings = async () => {
      try {
        const response = await listRecordings();
        mergeRecordingList(response.items);
      } catch (error: unknown) {
        console.warn('Failed to load recordings list', error);
      }
    };

    void loadRecordings();
  }, [mergeRecordingList]);

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
      if (event.type === 'job_state_changed') {
        updateJob(event.jobId, (prev) => ({
          ...prev,
          state: event.state,
          manifestPath: event.payload?.manifestPath ?? prev.manifestPath,
          error: event.payload?.error ?? prev.error,
          finishedAt: event.payload?.finishedAt ?? prev.finishedAt,
          ttsStrategy: event.payload?.ttsStrategy ?? prev.ttsStrategy,
          md: event.payload?.md ?? prev.md,
          notionUrl: event.payload?.notionUrl ?? prev.notionUrl,
          updatedAt: new Date().toISOString(),
        }));
        return;
      }

      if (event.type === 'recording_state_changed') {
        updateRecording(event.recordingId, (prev) => ({
          ...prev,
          recordingId: event.recordingId,
          status: event.status,
          transcriptId: event.transcriptId ?? prev.transcriptId,
          error: event.error ?? null,
          createdAt: prev.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));
      }
    },
    [updateJob, updateRecording],
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
      if (!trimmed) return;
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

  const recordingsArray = useMemo(() => {
    return Object.values(recordings).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [recordings]);

  const value = useMemo<JobMonitorContextValue>(
    () => ({
      jobs: jobsArray,
      jobMap: jobs,
      recordings: recordingsArray,
      recordingMap: recordings,
      registerJob,
      registerRecording,
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
      recordings,
      recordingsArray,
      registerJob,
      registerRecording,
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
