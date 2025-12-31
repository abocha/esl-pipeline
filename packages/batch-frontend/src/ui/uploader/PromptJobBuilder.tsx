import { useQuery } from '@tanstack/react-query';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import { useJobMonitor } from '../../context/JobMonitorContext';
import { useJobSettings } from '../../context/JobSettingsContext';
import { createJob, fetchRecordingsIndex } from '../../utils/api';

const SparkIcon = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 3v4" />
    <path d="M3 5h4" />
    <path d="M19 3v4" />
    <path d="M17 5h4" />
    <path d="M12 12l3 3-3 3-3-3z" />
  </svg>
);

type PathMode = 'smart' | 'full';

const STORAGE_KEYS = {
  baseDir: 'ttdg.baseDir',
  mode: 'ttdg.pathMode',
  recent: 'ttdg.recentWorkdirs',
};

const DEFAULT_RECORDINGS_ROOT = '/recordings';

const isBrowser = globalThis.window !== undefined && globalThis.localStorage !== undefined;

function readTextStorage(key: string, fallback: string): string {
  if (!isBrowser) return fallback;
  const value = globalThis.localStorage.getItem(key);
  return value ?? fallback;
}

function readListStorage(key: string): string[] {
  if (!isBrowser) return [];
  const value = globalThis.localStorage.getItem(key);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function writeStorage(key: string, value: string): void {
  if (!isBrowser) return;
  globalThis.localStorage.setItem(key, value);
}

function writeListStorage(key: string, value: string[]): void {
  if (!isBrowser) return;
  globalThis.localStorage.setItem(key, JSON.stringify(value));
}

function readOptionalStorage(key: string): string | null {
  if (!isBrowser) return null;
  return globalThis.localStorage.getItem(key);
}

function deriveLabelFromPath(value: string): string {
  const trimmed = value.trim().replaceAll(/[\\/]+$/g, '');
  if (!trimmed) return 'lesson';
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? 'lesson';
}

function isAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\');
}

function normalizeForCompare(value: string): string {
  return value.trim().replaceAll('\\', '/').replaceAll(/\/+$/g, '');
}

function joinWorkdir(base: string, leaf: string): string {
  const trimmedBase = base.trim().replaceAll(/[\\/]+$/g, '');
  const trimmedLeaf = leaf.trim();
  if (!trimmedBase) return trimmedLeaf;
  if (!trimmedLeaf) return '';
  if (isAbsolutePath(trimmedLeaf)) return trimmedLeaf;

  const usesBackslash = /\\/.test(trimmedBase) || /\\/.test(trimmedLeaf);
  const sep = usesBackslash ? '\\' : '/';
  const normalizedBase = usesBackslash
    ? trimmedBase.replaceAll('/', '\\')
    : trimmedBase.replaceAll('\\', '/');
  const normalizedLeaf = usesBackslash
    ? trimmedLeaf.replaceAll('/', '\\').replaceAll(/^[\\]+/g, '')
    : trimmedLeaf.replaceAll('\\', '/').replaceAll(/^\/+/g, '');

  return `${normalizedBase}${sep}${normalizedLeaf}`;
}

function deriveRelativePath(base: string, fullPath: string): string | null {
  const normalizedBase = normalizeForCompare(base);
  const normalizedFull = normalizeForCompare(fullPath);
  if (!normalizedBase || !normalizedFull) return null;
  const prefix = `${normalizedBase}/`;
  if (normalizedFull.startsWith(prefix)) {
    return normalizedFull.slice(prefix.length);
  }
  return null;
}

export const PromptJobBuilder: React.FC = () => {
  const { settings } = useJobSettings();
  const { registerJob } = useJobMonitor();
  const storedBaseDir = readOptionalStorage(STORAGE_KEYS.baseDir);
  const [pathMode, setPathMode] = useState<PathMode>(() => {
    const stored = readTextStorage(STORAGE_KEYS.mode, 'smart');
    return stored === 'full' ? 'full' : 'smart';
  });
  const [baseDir, setBaseDir] = useState(() =>
    readTextStorage(STORAGE_KEYS.baseDir, DEFAULT_RECORDINGS_ROOT),
  );
  const [lessonFolder, setLessonFolder] = useState('');
  const [lessonSearch, setLessonSearch] = useState('');
  const [studentFilter, setStudentFilter] = useState('all');
  const [runAll, setRunAll] = useState(false);
  const [workdir, setWorkdir] = useState('');
  const [recentWorkdirs, setRecentWorkdirs] = useState<string[]>(() =>
    readListStorage(STORAGE_KEYS.recent),
  );
  const [notes, setNotes] = useState('');
  const [profilePath, setProfilePath] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    data: recordingsIndex,
    isLoading: isRecordingsLoading,
    error: recordingsError,
  } = useQuery({
    queryKey: ['recordings-index'],
    queryFn: () => fetchRecordingsIndex(300),
    staleTime: 60_000,
  });

  const recordingsRoot = recordingsIndex?.root || DEFAULT_RECORDINGS_ROOT;
  const recordings = recordingsIndex?.items ?? [];

  const resolvedWorkdir = useMemo(() => {
    if (pathMode === 'smart') {
      if (runAll) {
        return baseDir.trim();
      }
      return joinWorkdir(baseDir, lessonFolder);
    }
    return workdir.trim();
  }, [baseDir, lessonFolder, pathMode, runAll, workdir]);

  const hasRequiredPath =
    pathMode === 'smart'
      ? baseDir.trim().length > 0 && (runAll || lessonFolder.trim().length > 0)
      : workdir.trim().length > 0;

  const canSubmit = useMemo(
    () => hasRequiredPath && !isSubmitting,
    [hasRequiredPath, isSubmitting],
  );

  const studentOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const entry of recordings) {
      unique.add(entry.student);
    }
    return [...unique].sort();
  }, [recordings]);

  const filteredRecordings = useMemo(() => {
    const query = lessonSearch.trim().toLowerCase();
    return recordings.filter((entry) => {
      if (studentFilter !== 'all' && entry.student !== studentFilter) return false;
      if (!query) return true;
      return (
        entry.relativePath.toLowerCase().includes(query) ||
        entry.student.toLowerCase().includes(query) ||
        entry.name.toLowerCase().includes(query)
      );
    });
  }, [lessonSearch, recordings, studentFilter]);

  const recentSuggestions = useMemo(() => filteredRecordings.slice(0, 8), [filteredRecordings]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.baseDir, baseDir.trim());
  }, [baseDir]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.mode, pathMode);
  }, [pathMode]);

  useEffect(() => {
    writeListStorage(STORAGE_KEYS.recent, recentWorkdirs);
  }, [recentWorkdirs]);

  useEffect(() => {
    if (pathMode === 'full' && runAll) {
      setRunAll(false);
    }
  }, [pathMode, runAll]);

  useEffect(() => {
    if (!recordingsIndex?.root) return;
    if (storedBaseDir) return;
    if (!baseDir.trim() || baseDir === DEFAULT_RECORDINGS_ROOT) {
      setBaseDir(recordingsIndex.root);
    }
  }, [baseDir, recordingsIndex?.root, storedBaseDir]);

  const pushRecent = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setRecentWorkdirs((prev) => {
      const next = [trimmed, ...prev.filter((entry) => entry !== trimmed)];
      return next.slice(0, 6);
    });
  }, []);

  const applyRecent = useCallback(
    (value: string) => {
      const relative = deriveRelativePath(baseDir, value);
      if (relative) {
        setPathMode('smart');
        setLessonFolder(relative);
        setRunAll(false);
        return;
      }
      setPathMode('full');
      setWorkdir(value);
    },
    [baseDir],
  );

  const applyLessonFolder = useCallback((value: string) => {
    setLessonFolder(value);
    setRunAll(false);
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!hasRequiredPath) {
      if (pathMode === 'smart') {
        toast.error(runAll ? 'Set recordings root' : 'Set both root and lesson folder');
      } else {
        toast.error('Lesson path is required');
      }
      return;
    }
    const trimmedWorkdir = resolvedWorkdir.trim();

    setIsSubmitting(true);
    try {
      const trimmedNotes = notes.trim();
      const trimmedProfile = profilePath.trim();

      const response = await createJob({
        transcribeWorkdir: trimmedWorkdir,
        promptNotes: trimmedNotes || undefined,
        profilePath: trimmedProfile || undefined,
        preset: settings.preset,
        withTts: settings.withTts,
        forceTts: settings.forceTts,
        notionDatabase: settings.notionDatabase,
        ttsStrategy: settings.ttsStrategy,
        upload: 'auto',
      });

      registerJob({
        jobId: response.jobId,
        fileName: deriveLabelFromPath(trimmedWorkdir),
        preset: settings.preset,
        notionDatabase: settings.notionDatabase ?? undefined,
        withTts: settings.withTts,
        ttsStrategy: settings.ttsStrategy,
      });

      pushRecent(trimmedWorkdir);
      toast.success('Prompt job queued');
      setNotes('');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to create prompt job';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="prompt-builder card animate-fade-in-up">
      <header className="prompt-header">
        <div className="prompt-title">
          <div className="prompt-icon">
            <SparkIcon />
          </div>
          <div>
            <span className="eyebrow">Prompt</span>
            <h2>Assemble LLM Prompt</h2>
          </div>
        </div>
        <p className="prompt-subtitle">
          Runs ttdg, stitches template + profile + notes + transcript, then waits for manual LLM
          approval.
        </p>
      </header>

      <form className="prompt-form" onSubmit={handleSubmit}>
        <div className="path-panel">
          <div className="path-toggle">
            <button
              type="button"
              className={`toggle-btn ${pathMode === 'smart' ? 'active' : ''}`}
              onClick={() => setPathMode('smart')}
            >
              Smart path
            </button>
            <button
              type="button"
              className={`toggle-btn ${pathMode === 'full' ? 'active' : ''}`}
              onClick={() => setPathMode('full')}
            >
              Full path
            </button>
          </div>
          <p className="path-hint">
            Smart mode stitches a saved container root with a lesson folder. Full path mode accepts
            the exact workdir.
          </p>
          <div className="path-meta">
            <label className="runall-toggle">
              <input
                type="checkbox"
                checked={runAll}
                onChange={(event) => setRunAll(event.target.checked)}
                disabled={pathMode !== 'smart'}
              />
              <span>Run all new recordings in root</span>
            </label>
            <span className="path-status">
              Root: {recordingsRoot}
              {recordingsIndex?.exists === false && ' (missing)'}
            </span>
          </div>

          {pathMode === 'smart' ? (
            <div className="form-grid">
              <label className="field">
                <span>Recordings root (container path)</span>
                <input
                  type="text"
                  value={baseDir}
                  onChange={(event) => setBaseDir(event.target.value)}
                  placeholder={recordingsRoot}
                />
                <em className="field-note">Saved locally in this browser.</em>
              </label>

              <label className="field">
                <span>Lesson folder</span>
                <input
                  type="text"
                  value={lessonFolder}
                  onChange={(event) => applyLessonFolder(event.target.value)}
                  list="lesson-options"
                  disabled={runAll}
                  placeholder="Student/2025-01-15_09-30-00"
                />
                <datalist id="lesson-options">
                  {filteredRecordings.map((entry) => (
                    <option
                      key={entry.relativePath}
                      value={entry.relativePath}
                      label={`${entry.student} • ${entry.name}`}
                    />
                  ))}
                </datalist>
              </label>

              <label className="field">
                <span>Filter lessons</span>
                <input
                  type="text"
                  value={lessonSearch}
                  onChange={(event) => setLessonSearch(event.target.value)}
                  placeholder="Type student or date..."
                />
              </label>

              <label className="field">
                <span>Student filter</span>
                <select
                  value={studentFilter}
                  onChange={(event) => setStudentFilter(event.target.value)}
                  className="field-select"
                >
                  <option value="all">All students</option>
                  {studentOptions.map((student) => (
                    <option key={student} value={student}>
                      {student}
                    </option>
                  ))}
                </select>
              </label>

              <div className="field full">
                <span>Resolved workdir</span>
                <div className="resolved-path">
                  {resolvedWorkdir || <span className="resolved-placeholder">Select a lesson…</span>}
                </div>
              </div>
            </div>
          ) : (
            <label className="field full">
              <span>Lesson folder (workdir)</span>
              <input
                type="text"
                value={workdir}
                onChange={(event) => setWorkdir(event.target.value)}
                placeholder="/recordings/lessons/Student/2025-01-15_09-30-00"
              />
            </label>
          )}

          {pathMode === 'smart' && (
            <div className="recordings-state">
              {isRecordingsLoading && <span>Loading lesson folders…</span>}
              {!isRecordingsLoading && recordingsError && (
                <span>Unable to load lesson folders.</span>
              )}
              {!isRecordingsLoading && !recordingsError && recordings.length === 0 && (
                <span>No lesson folders detected yet.</span>
              )}
            </div>
          )}

          {pathMode === 'smart' && recentSuggestions.length > 0 && (
            <div className="recent-block">
              <span className="recent-label">Latest lessons</span>
              <div className="recent-list">
                {recentSuggestions.map((entry) => (
                  <button
                    type="button"
                    key={entry.relativePath}
                    className="recent-chip"
                    onClick={() => applyLessonFolder(entry.relativePath)}
                    disabled={runAll}
                  >
                    {entry.student}/{entry.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {recentWorkdirs.length > 0 && (
            <div className="recent-block">
              <span className="recent-label">Recent</span>
              <div className="recent-list">
                {recentWorkdirs.map((entry) => (
                  <button
                    type="button"
                    key={entry}
                    className="recent-chip"
                    onClick={() => applyRecent(entry)}
                  >
                    {entry}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <label className="field full">
          <span>Notes for the LLM (manual)</span>
          <textarea
            rows={4}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Add extra guidance or context for this lesson..."
          />
        </label>

        <details className="advanced">
          <summary>Advanced options</summary>
          <div className="advanced-body">
            <label className="field full">
              <span>Profile path (optional)</span>
              <input
                type="text"
                value={profilePath}
                onChange={(event) => setProfilePath(event.target.value)}
                placeholder="docs/misc/PROFILE_2025-11-16.md"
              />
              <em className="field-note">Blank uses the backend default profile.</em>
            </label>
          </div>
        </details>

        <div className="prompt-actions">
          <button type="submit" className="btn-primary" disabled={!canSubmit}>
            {isSubmitting ? 'Submitting...' : 'Build Prompt Package'}
          </button>
        </div>
      </form>

      <style>{`
        .prompt-builder {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .prompt-header {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .prompt-title {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .prompt-icon {
          width: 44px;
          height: 44px;
          background: var(--gradient-primary);
          border-radius: var(--radius-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .prompt-title .eyebrow {
          font-size: var(--text-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--color-primary-500);
        }

        .prompt-title h2 {
          margin: 0;
          font-size: var(--text-lg);
        }

        .prompt-subtitle {
          margin: 0;
          color: var(--text-secondary);
          font-size: var(--text-sm);
        }

        .prompt-form {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .path-panel {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
          padding: var(--space-4);
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-light);
          background: var(--bg-secondary);
        }

        .path-toggle {
          display: inline-flex;
          gap: var(--space-2);
          background: var(--bg-primary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-full);
          padding: 4px;
          align-self: flex-start;
        }

        .toggle-btn {
          border: none;
          background: transparent;
          padding: var(--space-2) var(--space-4);
          border-radius: var(--radius-full);
          font-size: var(--text-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-tertiary);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .toggle-btn.active {
          background: var(--gradient-primary);
          color: white;
          box-shadow: var(--shadow-sm);
        }

        .path-hint {
          margin: 0;
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .path-meta {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-3);
          align-items: center;
          justify-content: space-between;
        }

        .runall-toggle {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          font-size: var(--text-xs);
          color: var(--text-secondary);
        }

        .runall-toggle input {
          accent-color: var(--color-primary-500);
        }

        .path-status {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .form-grid {
          display: grid;
          gap: var(--space-3);
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .field span {
          font-weight: 600;
          color: var(--text-secondary);
        }

        .field-note {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .field-select {
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-light);
          background: var(--bg-secondary);
          font-size: var(--text-sm);
          color: var(--text-primary);
          outline: none;
        }

        .field input,
        .field textarea {
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          padding: var(--space-2) var(--space-3);
          font-size: var(--text-sm);
          color: var(--text-primary);
          outline: none;
        }

        .field textarea {
          resize: vertical;
        }

        .field.full {
          width: 100%;
        }

        .resolved-path {
          padding: var(--space-3);
          border-radius: var(--radius-md);
          border: 1px dashed var(--border-light);
          background: var(--bg-primary);
          font-size: var(--text-sm);
          color: var(--text-primary);
          word-break: break-word;
        }

        .resolved-placeholder {
          color: var(--text-tertiary);
        }

        .recordings-state {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .recent-block {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .recent-label {
          font-size: var(--text-xs);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--text-tertiary);
        }

        .recent-list {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
        }

        .recent-chip {
          border: 1px solid var(--border-light);
          background: var(--bg-primary);
          border-radius: var(--radius-full);
          padding: var(--space-1) var(--space-3);
          font-size: var(--text-xs);
          color: var(--text-secondary);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .recent-chip:hover {
          border-color: var(--border-medium);
          color: var(--text-primary);
        }

        .recent-chip:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }

        .advanced {
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          background: var(--bg-secondary);
          padding: var(--space-3) var(--space-4);
        }

        .advanced summary {
          cursor: pointer;
          font-weight: 600;
          color: var(--text-secondary);
        }

        .advanced-body {
          margin-top: var(--space-3);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .prompt-actions {
          display: flex;
          justify-content: flex-end;
        }
      `}</style>
    </section>
  );
};
