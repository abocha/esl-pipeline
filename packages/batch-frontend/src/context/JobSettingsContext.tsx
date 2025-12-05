import { useQuery } from '@tanstack/react-query';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import type { JobOptionsResponse, SubmitJobRequest } from '../utils/api';
import { fetchJobOptions } from '../utils/api';

export interface JobSettings {
  preset: string;
  notionDatabase: string;
  withTts: boolean;
  forceTts: boolean;
  mode: NonNullable<SubmitJobRequest['mode']>;
  applyToPending: boolean;
}

export type AppliedJobSettings = Omit<JobSettings, 'applyToPending'>;

interface JobSettingsContextValue {
  settings: JobSettings;
  updateSettings: (updates: Partial<JobSettings>) => void;
  resetSettings: () => void;
  options: JobOptionsResponse;
  isLoading: boolean;
  errorMessage: string | null;
  isUsingFallback: boolean;
}

const DEFAULT_JOB_OPTIONS: JobOptionsResponse = {
  presets: ['b1-default', 'b2-general', 'c1-science'],
  voiceAccents: ['american_female', 'british_male', 'australian_female'],
  voices: [],
  notionDatabases: [
    { id: 'default-b1', name: 'B1 Lessons' },
    { id: 'default-b2', name: 'B2 Lessons' },
  ],
  modes: ['auto', 'dialogue', 'monologue'],
};

const DEFAULT_SETTINGS: JobSettings = {
  preset: DEFAULT_JOB_OPTIONS.presets[0] ?? 'b1-default',
  notionDatabase: DEFAULT_JOB_OPTIONS.notionDatabases[0]?.id ?? 'default-b1',
  withTts: true,
  forceTts: false,
  mode: 'auto',
  applyToPending: false,
};

const JobSettingsContext = createContext<JobSettingsContextValue | undefined>(undefined);

export function JobSettingsProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['job-options'],
    queryFn: fetchJobOptions,
    staleTime: 5 * 60 * 1000,
  });

  const isUsingFallback = !data;
  const options = data ?? DEFAULT_JOB_OPTIONS;

  const [settings, setSettings] = useState<JobSettings>(() => ({
    ...DEFAULT_SETTINGS,
    preset: options.presets[0] ?? DEFAULT_SETTINGS.preset,
    notionDatabase: options.notionDatabases[0]?.id ?? DEFAULT_SETTINGS.notionDatabase,
    mode: options.modes[0] ?? DEFAULT_SETTINGS.mode,
  }));

  useEffect(() => {
    setSettings((prev) => {
      const preset =
        ensureOption(prev.preset, options.presets) ?? options.presets[0] ?? DEFAULT_SETTINGS.preset;
      const notionDatabase =
        ensureOption(
          prev.notionDatabase,
          options.notionDatabases.map((db) => db.id),
        ) ??
        options.notionDatabases[0]?.id ??
        DEFAULT_SETTINGS.notionDatabase;
      const mode =
        (ensureOption(prev.mode, options.modes) as JobSettings['mode']) ??
        options.modes[0] ??
        DEFAULT_SETTINGS.mode;

      return {
        ...prev,
        preset,
        notionDatabase,
        mode,
      };
    });
  }, [options]);

  const updateSettings = useCallback((updates: Partial<JobSettings>) => {
    setSettings((prev) => ({ ...prev, ...updates }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings({
      ...DEFAULT_SETTINGS,
      preset: options.presets[0] ?? DEFAULT_SETTINGS.preset,
      notionDatabase: options.notionDatabases[0]?.id ?? DEFAULT_SETTINGS.notionDatabase,
      mode: options.modes[0] ?? DEFAULT_SETTINGS.mode,
    });
  }, [options]);

  const contextValue: JobSettingsContextValue = useMemo(
    () => ({
      settings,
      updateSettings,
      resetSettings,
      options,
      isLoading,
      errorMessage: error ? (error as Error).message : null,
      isUsingFallback,
    }),
    [settings, updateSettings, resetSettings, options, isLoading, error, isUsingFallback],
  );

  return <JobSettingsContext.Provider value={contextValue}>{children}</JobSettingsContext.Provider>;
}

export function useJobSettings(): JobSettingsContextValue {
  const context = useContext(JobSettingsContext);
  if (!context) {
    throw new Error('useJobSettings must be used within a JobSettingsProvider');
  }
  return context;
}

function ensureOption<T extends string>(value: T | undefined | null, list: T[]): T | undefined {
  if (!value) return undefined;
  return list.includes(value) ? value : undefined;
}
