import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';

import { useJobMonitor } from '../../context/JobMonitorContext';
import { useJobSettings } from '../../context/JobSettingsContext';
import type { AppliedJobSettings, JobSettings } from '../../context/JobSettingsContext';
import { createJob, uploadMarkdown } from '../../utils/api';

type FileStatus = 'idle' | 'uploading' | 'submitting' | 'success' | 'error';

interface QueuedFile {
  id: string;
  file: File;
  status: FileStatus;
  uploadError?: string;
  jobError?: string;
  jobId?: string;
  mdPath?: string;
  appliedSettings: AppliedJobSettings;
}

// Icons
const UploadIcon = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const FileIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const CheckIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const XIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const RefreshIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

export const JobUploader: React.FC = () => {
  const { settings } = useJobSettings();
  const { registerJob } = useJobMonitor();
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const sequentialLock = useRef(false);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      const snapshot = buildAppliedSettings(settings);
      const newEntries: QueuedFile[] = acceptedFiles.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        file,
        status: 'idle',
        appliedSettings: snapshot,
      }));
      setQueue((prev) => [...prev, ...newEntries]);
      toast.success(`${acceptedFiles.length} file(s) added to queue`);
    },
    [settings],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/markdown': ['.md', '.markdown'] },
    multiple: true,
  });

  const pendingFiles = queue.filter((item) => item.status === 'idle' || item.status === 'error');

  useEffect(() => {
    if (!settings.applyToPending) return;
    const snapshot = buildAppliedSettings(settings);
    setQueue((prev) => {
      let changed = false;
      const next = prev.map((file) => {
        if (file.status !== 'idle') return file;
        if (areSettingsEqual(file.appliedSettings, snapshot)) return file;
        changed = true;
        return { ...file, appliedSettings: snapshot };
      });
      return changed ? next : prev;
    });
  }, [
    settings.applyToPending,
    settings.preset,
    settings.notionDatabase,
    settings.withTts,
    settings.forceTts,
    settings.mode,
  ]);

  const processFile = useCallback(
    async (id: string, overrideSettings?: AppliedJobSettings) => {
      const target = queue.find((file) => file.id === id);
      if (!target) return;
      const jobFile = target.file;
      const jobSettings =
        overrideSettings ?? target.appliedSettings ?? buildAppliedSettings(settings);

      setQueue((prev) =>
        prev.map((file) =>
          file.id === id
            ? {
                ...file,
                status: 'uploading',
                uploadError: undefined,
                jobError: undefined,
                appliedSettings: jobSettings,
              }
            : file,
        ),
      );

      let phase: 'upload' | 'job' = 'upload';
      const uploadTarget = 's3';

      try {
        const uploadResponse = await uploadMarkdown(jobFile);
        phase = 'job';
        setQueue((prev) =>
          prev.map((file) =>
            file.id === id ? { ...file, status: 'submitting', mdPath: uploadResponse.md } : file,
          ),
        );

        const jobResponse = await createJob({
          md: uploadResponse.md,
          preset: jobSettings.preset,
          withTts: jobSettings.withTts,
          forceTts: jobSettings.forceTts,
          notionDatabase: jobSettings.notionDatabase,
          upload: uploadTarget,
          mode: jobSettings.mode,
        });

        setQueue((prev) =>
          prev.map((file) =>
            file.id === id
              ? {
                  ...file,
                  status: 'success',
                  jobId: jobResponse.jobId,
                  jobError: undefined,
                }
              : file,
          ),
        );
        registerJob({
          jobId: jobResponse.jobId,
          fileName: jobFile.name,
          md: uploadResponse.md,
          preset: jobSettings.preset,
          notionDatabase: jobSettings.notionDatabase,
          withTts: jobSettings.withTts,
          mode: jobSettings.mode,
        });
        toast.success(`Job ${jobResponse.jobId} created`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to process file';
        const contextMessage =
          phase === 'upload'
            ? 'Failed to upload Markdown to S3. Check connectivity and credentials.'
            : 'Job submission failed; upload was required and did not complete.';
        console.error(contextMessage, {
          file: jobFile.name,
          phase,
          error,
        });
        setQueue((prev) =>
          prev.map((file) =>
            file.id === id
              ? {
                  ...file,
                  status: 'error',
                  uploadError: phase === 'upload' ? message : file.uploadError,
                  jobError: phase === 'job' ? message : file.jobError,
                }
              : file,
          ),
        );
        toast.error(contextMessage);
      }
    },
    [queue, settings, registerJob],
  );

  const startProcessing = useCallback(async () => {
    if (sequentialLock.current) return;
    const filesToProcess = queue.filter(
      (file) => file.status === 'idle' || file.status === 'error',
    );
    if (filesToProcess.length === 0) return;
    sequentialLock.current = true;
    setIsProcessing(true);

    try {
      for (const item of filesToProcess) {
        await processFile(item.id);
      }
    } finally {
      setIsProcessing(false);
      sequentialLock.current = false;
    }
  }, [queue, processFile]);

  const handleRetry = useCallback(
    async (id: string) => {
      const snapshot = buildAppliedSettings(settings);
      setQueue((prev) =>
        prev.map((file) =>
          file.id === id
            ? {
                ...file,
                status: 'idle',
                uploadError: undefined,
                jobError: undefined,
                appliedSettings: snapshot,
              }
            : file,
        ),
      );
      await processFile(id, snapshot);
    },
    [processFile, settings],
  );

  const clearCompleted = () => {
    setQueue((prev) => prev.filter((file) => file.status !== 'success'));
  };

  const summary = useMemo(() => {
    const total = queue.length;
    const success = queue.filter((item) => item.status === 'success').length;
    const failed = queue.filter((item) => item.status === 'error').length;
    const pending = queue.filter((item) => item.status === 'idle').length;
    const inProgress = queue.filter(
      (item) => item.status === 'uploading' || item.status === 'submitting',
    ).length;
    return { total, success, failed, pending, inProgress };
  }, [queue]);

  return (
    <section className="uploader card animate-fade-in-up">
      <header className="uploader-header">
        <div className="uploader-title">
          <span className="eyebrow">Upload</span>
          <h2>Drop your Markdown files</h2>
        </div>
        <div className="uploader-actions">
          {summary.success > 0 && (
            <button type="button" onClick={clearCompleted} className="btn-ghost">
              Clear completed
            </button>
          )}
          <button
            type="button"
            onClick={() => void startProcessing()}
            disabled={isProcessing || pendingFiles.length === 0}
            className="btn-primary"
          >
            {isProcessing ? (
              <>
                <span className="spinner" />
                Processing…
              </>
            ) : (
              `Submit ${pendingFiles.length} file(s)`
            )}
          </button>
        </div>
      </header>

      <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
        <input {...getInputProps()} />
        <div className="dropzone-content">
          <div className={`dropzone-icon ${isDragActive ? 'bounce' : ''}`}>
            <UploadIcon />
          </div>
          <p className="dropzone-text">
            {isDragActive ? 'Drop files here…' : 'Drag & drop Markdown files, or click to browse'}
          </p>
          <span className="dropzone-hint">Accepts .md and .markdown files</span>
        </div>
      </div>

      {queue.length > 0 && (
        <>
          <div className="file-list stagger-children">
            {queue.map((file) => (
              <FileRow
                key={file.id}
                entry={file}
                onRetry={() => void handleRetry(file.id)}
                isProcessing={isProcessing}
              />
            ))}
          </div>

          <footer className="uploader-footer">
            <div className="summary-stats">
              {summary.inProgress > 0 && (
                <span className="stat stat-progress">
                  <span className="spinner-small" />
                  {summary.inProgress} processing
                </span>
              )}
              {summary.pending > 0 && (
                <span className="stat stat-pending">{summary.pending} pending</span>
              )}
              {summary.success > 0 && (
                <span className="stat stat-success">{summary.success} succeeded</span>
              )}
              {summary.failed > 0 && (
                <span className="stat stat-failed">{summary.failed} failed</span>
              )}
            </div>
          </footer>
        </>
      )}

      <style>{`
        .uploader {
          display: flex;
          flex-direction: column;
          gap: var(--space-5);
        }

        .uploader-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--space-4);
          flex-wrap: wrap;
        }

        .uploader-title {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .eyebrow {
          font-size: var(--text-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--color-primary-500);
        }

        .uploader-title h2 {
          font-size: var(--text-xl);
          margin: 0;
        }

        .uploader-actions {
          display: flex;
          gap: var(--space-2);
        }

        .dropzone {
          border: 2px dashed var(--border-light);
          border-radius: var(--radius-xl);
          padding: var(--space-10);
          text-align: center;
          cursor: pointer;
          transition: all var(--transition-base);
          background: var(--bg-secondary);
        }

        .dropzone:hover {
          border-color: var(--color-primary-300);
          background: var(--color-primary-50);
        }

        .dropzone.active {
          border-color: var(--color-primary-500);
          background: var(--color-primary-50);
          border-style: solid;
        }

        [data-theme="dark"] .dropzone:hover,
        [data-theme="dark"] .dropzone.active {
          background: rgba(99, 102, 241, 0.1);
        }

        .dropzone-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-3);
        }

        .dropzone-icon {
          width: 64px;
          height: 64px;
          background: var(--gradient-primary);
          border-radius: var(--radius-xl);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          transition: transform var(--transition-bounce);
        }

        .dropzone-icon.bounce {
          animation: bounce-subtle 0.5s ease-in-out infinite;
        }

        .dropzone-text {
          font-size: var(--text-base);
          font-weight: 500;
          color: var(--text-primary);
          margin: 0;
        }

        .dropzone-hint {
          font-size: var(--text-sm);
          color: var(--text-tertiary);
        }

        .file-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .uploader-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: var(--space-4);
          border-top: 1px solid var(--border-light);
        }

        .summary-stats {
          display: flex;
          gap: var(--space-4);
          flex-wrap: wrap;
        }

        .stat {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          font-size: var(--text-sm);
          font-weight: 500;
        }

        .stat-progress {
          color: var(--color-info-500);
        }

        .stat-pending {
          color: var(--text-tertiary);
        }

        .stat-success {
          color: var(--color-success-500);
        }

        .stat-failed {
          color: var(--color-error-500);
        }

        .spinner-small {
          width: 14px;
          height: 14px;
          border: 2px solid var(--border-light);
          border-top-color: var(--color-info-500);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
      `}</style>
    </section>
  );
};

interface FileRowProps {
  entry: QueuedFile;
  onRetry: () => void;
  isProcessing: boolean;
}

const FileRow: React.FC<FileRowProps> = ({ entry, onRetry, isProcessing }) => {
  const getStatusConfig = () => {
    switch (entry.status) {
      case 'uploading': {
        return {
          color: 'var(--color-info-500)',
          bg: 'rgba(14, 165, 233, 0.1)',
          label: 'Uploading…',
        };
      }
      case 'submitting': {
        return {
          color: 'var(--color-warning-500)',
          bg: 'rgba(245, 158, 11, 0.1)',
          label: 'Creating job…',
        };
      }
      case 'success': {
        return {
          color: 'var(--color-success-500)',
          bg: 'rgba(16, 185, 129, 0.1)',
          label: 'Success',
        };
      }
      case 'error': {
        return { color: 'var(--color-error-500)', bg: 'rgba(244, 63, 94, 0.1)', label: 'Failed' };
      }
      default: {
        return { color: 'var(--text-tertiary)', bg: 'var(--bg-tertiary)', label: 'Pending' };
      }
    }
  };

  const statusConfig = getStatusConfig();
  const isActive = entry.status === 'uploading' || entry.status === 'submitting';

  return (
    <div className={`file-row ${entry.status}`}>
      <div className="file-icon-wrap">
        <FileIcon />
      </div>

      <div className="file-info">
        <div className="file-name">{entry.file.name}</div>
        <div className="file-meta">
          {entry.status === 'success' && entry.jobId ? (
            <span>
              Job <code>{entry.jobId}</code>
            </span>
          ) : entry.status === 'error' ? (
            <span className="file-error">
              {entry.uploadError || entry.jobError || 'Unknown error'}
            </span>
          ) : (
            <span>{prettyBytes(entry.file.size)}</span>
          )}
        </div>
      </div>

      <div className="file-status">
        <span
          className={`status-badge ${isActive ? 'animate-pulse' : ''}`}
          style={{ color: statusConfig.color, background: statusConfig.bg }}
        >
          {entry.status === 'success' && <CheckIcon />}
          {entry.status === 'error' && <XIcon />}
          {isActive && <span className="spinner-tiny" />}
          {statusConfig.label}
        </span>

        {entry.status === 'error' && (
          <button type="button" onClick={onRetry} disabled={isProcessing} className="btn-retry">
            <RefreshIcon />
            Retry
          </button>
        )}
      </div>

      <style>{`
        .file-row {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-4);
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-xl);
          transition: all var(--transition-fast);
          animation: fadeInUp 0.3s ease-out backwards;
        }

        .file-row:hover {
          border-color: var(--border-medium);
        }

        .file-row.success {
          border-color: rgba(16, 185, 129, 0.3);
          background: rgba(16, 185, 129, 0.05);
        }

        .file-row.error {
          border-color: rgba(244, 63, 94, 0.3);
          background: rgba(244, 63, 94, 0.05);
        }

        .file-icon-wrap {
          width: 40px;
          height: 40px;
          background: var(--bg-primary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-tertiary);
          flex-shrink: 0;
        }

        .file-info {
          flex: 1;
          min-width: 0;
        }

        .file-name {
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .file-meta {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
          margin-top: var(--space-1);
        }

        .file-meta code {
          font-size: var(--text-xs);
          background: var(--bg-tertiary);
          padding: 2px 6px;
          border-radius: var(--radius-sm);
        }

        .file-error {
          color: var(--color-error-500);
        }

        .file-status {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          flex-shrink: 0;
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: var(--space-1);
          padding: var(--space-1) var(--space-3);
          border-radius: var(--radius-full);
          font-size: var(--text-xs);
          font-weight: 600;
        }

        .spinner-tiny {
          width: 12px;
          height: 12px;
          border: 2px solid currentColor;
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          opacity: 0.7;
        }

        .btn-retry {
          display: flex;
          align-items: center;
          gap: var(--space-1);
          padding: var(--space-1) var(--space-3);
          background: var(--bg-primary);
          border: 1px solid var(--color-error-300);
          border-radius: var(--radius-full);
          color: var(--color-error-500);
          font-size: var(--text-xs);
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .btn-retry:hover:not(:disabled) {
          background: var(--color-error-500);
          color: white;
        }

        .btn-retry:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
};

function prettyBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const buildAppliedSettings = (settings: JobSettings): AppliedJobSettings => {
  const { applyToPending: _applyToPending, ...rest } = settings;
  return rest;
};

const APPLIED_KEYS: (keyof AppliedJobSettings)[] = [
  'preset',
  'notionDatabase',
  'withTts',
  'forceTts',
  'mode',
];

function areSettingsEqual(a: AppliedJobSettings, b: AppliedJobSettings): boolean {
  return APPLIED_KEYS.every((key) => a[key] === b[key]);
}
