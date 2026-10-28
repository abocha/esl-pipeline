import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { type BusinessSettings, getBusinessSettings } from '../utils/api';
import { normalizeTimezone } from '../utils/timezones';

interface WorkspaceTimezoneState {
  settings: BusinessSettings | null;
  setSettings: (settings: BusinessSettings) => void;
  refreshSettings: () => Promise<BusinessSettings | null>;
  reconcileTimezone: (timezone?: string) => Promise<void>;
}

const WorkspaceTimezoneContext = createContext<WorkspaceTimezoneState>({
  settings: null,
  setSettings: () => undefined,
  refreshSettings: async () => null,
  reconcileTimezone: async () => undefined,
});

// Mount with an authenticated-scope key. No pending result can outlive its scope
// or overwrite a later successful save/refresh.
export function WorkspaceTimezoneProvider({
  children,
  onLogout,
}: {
  children: ReactNode;
  onLogout: () => void;
}) {
  const [settings, updateSettings] = useState<BusinessSettings | null>(null);
  const current = useRef<BusinessSettings | null>(null);
  const generation = useRef(0);
  const active = useRef(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const setSettings = useCallback((next: BusinessSettings) => {
    generation.current += 1;
    if (!active.current) return;
    current.current = next;
    updateSettings(next);
  }, []);
  const refreshSettings = useCallback(async () => {
    const request = ++generation.current;
    const next = await getBusinessSettings();
    if (!active.current) return null;
    if (request !== generation.current) return current.current;
    current.current = next;
    updateSettings(next);
    return next;
  }, []);
  const reconcileTimezone = useCallback(
    async (responseTimezone?: string) => {
      if (
        !current.current ||
        !responseTimezone ||
        normalizeTimezone(current.current.timezone) === normalizeTimezone(responseTimezone)
      )
        return;
      const next = await refreshSettings();
      if (!next || normalizeTimezone(next.timezone) !== normalizeTimezone(responseTimezone)) {
        throw new Error('Tutor timezone changed. Refresh this page to load the current dates.');
      }
    },
    [refreshSettings],
  );
  useEffect(() => {
    active.current = true;
    setError(false);
    void refreshSettings().catch(() => {
      if (active.current) setError(true);
    });
    return () => {
      active.current = false;
      generation.current += 1;
    };
  }, [attempt, refreshSettings]);

  if (!settings)
    return (
      <section className="route-loading-panel" aria-live="polite">
        <p>{error ? 'Workspace settings unavailable.' : 'Preparing the teaching workspace…'}</p>
        {error ? (
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </button>
        ) : null}
        <button type="button" onClick={onLogout}>
          Logout
        </button>
      </section>
    );
  return (
    <WorkspaceTimezoneContext.Provider
      value={{ settings, setSettings, refreshSettings, reconcileTimezone }}
    >
      {children}
    </WorkspaceTimezoneContext.Provider>
  );
}

export function useWorkspaceTimezone() {
  const { settings } = useContext(WorkspaceTimezoneContext);
  return settings ? normalizeTimezone(settings.timezone) : null;
}

export function useWorkspaceSettings() {
  return useContext(WorkspaceTimezoneContext);
}
