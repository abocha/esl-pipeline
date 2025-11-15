import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { uploadMarkdown, createJob } from '../../utils/api';
import { useJobSettings } from '../../context/JobSettingsContext';
import type { AppliedJobSettings, JobSettings } from '../../context/JobSettingsContext';
import { useJobMonitor } from '../../context/JobMonitorContext';

type FileStatus = 'idle' | 'uploading' | 'submitting' | 'success' | 'error';

type QueuedFile = {
  id: string;
  file: File;
  status: FileStatus;
  uploadError?: string;
  jobError?: string;
  jobId?: string;
  mdPath?: string;
  appliedSettings: AppliedJobSettings;
};

export const JobUploader: React.FC = () => {
  const { settings } = useJobSettings();
  const { registerJob } = useJobMonitor();
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const sequentialLock = useRef(false);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (!acceptedFiles.length) return;
      const snapshot = buildAppliedSettings(settings);
      const newEntries: QueuedFile[] = acceptedFiles.map(file => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        file,
        status: 'idle',
        appliedSettings: snapshot,
      }));
      setQueue(prev => [...prev, ...newEntries]);
      toast.success(`${acceptedFiles.length} file(s) added to queue`);
    },
    [settings]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/markdown': ['.md', '.markdown'] },
    multiple: true,
  });

  const pendingFiles = queue.filter(item => item.status === 'idle' || item.status === 'error');

  useEffect(() => {
    if (!settings.applyToPending) return;
    const snapshot = buildAppliedSettings(settings);
    setQueue(prev => {
      let changed = false;
      const next = prev.map(file => {
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
    settings.upload,
    settings.mode,
  ]);

  const processFile = useCallback(
    async (id: string, overrideSettings?: AppliedJobSettings) => {
      const target = queue.find(file => file.id === id);
      if (!target) return;
      const jobFile = target.file;
      const jobSettings = overrideSettings ?? target.appliedSettings ?? buildAppliedSettings(settings);

      setQueue(prev =>
        prev.map(file =>
          file.id === id
            ? {
                ...file,
                status: 'uploading',
                uploadError: undefined,
                jobError: undefined,
                appliedSettings: jobSettings,
              }
            : file
        )
      );

      let phase: 'upload' | 'job' = 'upload';

      try {
        const uploadResponse = await uploadMarkdown(jobFile);
        phase = 'job';
        setQueue(prev =>
          prev.map(file =>
            file.id === id ? { ...file, status: 'submitting', mdPath: uploadResponse.md } : file
          )
        );

        const jobResponse = await createJob({
          md: uploadResponse.md,
          preset: jobSettings.preset,
          withTts: jobSettings.withTts,
          forceTts: jobSettings.forceTts,
          notionDatabase: jobSettings.notionDatabase,
          upload: jobSettings.upload,
          mode: jobSettings.mode,
        });

        setQueue(prev =>
          prev.map(file =>
            file.id === id
              ? {
                  ...file,
                  status: 'success',
                  jobId: jobResponse.jobId,
                  jobError: undefined,
                }
              : file
          )
        );
        registerJob({
          jobId: jobResponse.jobId,
          fileName: jobFile.name,
          submittedMd: uploadResponse.md,
          preset: jobSettings.preset,
          notionDatabase: jobSettings.notionDatabase,
          upload: jobSettings.upload,
          withTts: jobSettings.withTts,
          mode: jobSettings.mode,
        });
        toast.success(`Job ${jobResponse.jobId} created`);
      } catch (error: any) {
        const message = error?.message ?? 'Failed to process file';
        setQueue(prev =>
          prev.map(file =>
            file.id === id
              ? {
                  ...file,
                  status: 'error',
                  uploadError: phase === 'upload' ? message : file.uploadError,
                  jobError: phase === 'job' ? message : file.jobError,
                }
              : file
          )
        );
        toast.error(message);
      }
    },
    [queue, settings]
  );

  const startProcessing = useCallback(async () => {
    if (sequentialLock.current) return;
    const filesToProcess = queue.filter(file => file.status === 'idle' || file.status === 'error');
    if (!filesToProcess.length) return;
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
      setQueue(prev =>
        prev.map(file =>
          file.id === id
            ? {
                ...file,
                status: 'idle',
                uploadError: undefined,
                jobError: undefined,
                appliedSettings: snapshot,
              }
            : file
        )
      );
      await processFile(id, snapshot);
    },
    [processFile, settings]
  );

  const summary = useMemo(() => {
    const total = queue.length;
    const success = queue.filter(item => item.status === 'success').length;
    const failed = queue.filter(item => item.status === 'error').length;
    return { total, success, failed };
  }, [queue]);

  return (
    <section style={cardStyle}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p style={eyebrowStyle}>Upload</p>
          <h2 style={{ margin: 0, fontSize: '22px' }}>Drag & drop Markdown files</h2>
        </div>
        <button
          type="button"
          onClick={startProcessing}
          disabled={isProcessing || pendingFiles.length === 0}
          style={primaryButtonStyle(isProcessing || pendingFiles.length === 0)}
        >
          {isProcessing ? 'Processing…' : `Submit ${pendingFiles.length} file(s)`}
        </button>
      </header>

      <div {...getRootProps({ className: 'dropzone' })} style={dropzoneStyle(isDragActive)}>
        <input {...getInputProps()} />
        <p style={{ margin: 0, fontSize: '15px' }}>
          {isDragActive ? 'Drop the files here…' : 'Drag & drop Markdown files, or click to select'}
        </p>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#475569' }}>Only .md/.markdown files</p>
      </div>

      {queue.length === 0 ? (
        <p style={{ margin: 0, color: '#94a3b8', fontSize: '13px' }}>No files queued yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {queue.map(file => (
            <FileRow
              key={file.id}
              entry={file}
              onRetry={() => void handleRetry(file.id)}
              isProcessing={isProcessing}
              settingsHint={settings.applyToPending ? 'Pending uploads inherit current settings.' : undefined}
            />
          ))}
        </div>
      )}

      <footer style={footerStyle}>
        <span>
          {summary.success}/{summary.total} succeeded
        </span>
        {summary.failed > 0 && <span style={{ color: '#b91c1c' }}>{summary.failed} failed</span>}
      </footer>
    </section>
  );
};

type FileRowProps = {
  entry: QueuedFile;
  onRetry: () => void;
  isProcessing: boolean;
  settingsHint?: string;
};

const statusColorMap: Record<FileStatus, string> = {
  idle: '#94a3b8',
  uploading: '#0ea5e9',
  submitting: '#f59e0b',
  success: '#22c55e',
  error: '#ef4444',
};

const FileRow: React.FC<FileRowProps> = ({ entry, onRetry, isProcessing, settingsHint }) => {
  return (
    <div style={fileRowStyle}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: '14px' }}>{entry.file.name}</strong>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>{prettyBytes(entry.file.size)}</span>
        </div>
        <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#475569' }}>
          {entry.status === 'success' && entry.jobId ? (
            <>
              Job <code>{entry.jobId}</code> created
            </>
          ) : entry.status === 'error' ? (
            entry.uploadError || entry.jobError || 'Unknown error'
          ) : (
            statusLabel(entry.status)
          )}
        </p>
        {settingsHint && entry.status === 'idle' && (
          <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#94a3b8' }}>{settingsHint}</p>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
        <span style={{ fontSize: '12px', color: statusColorMap[entry.status] }}>{entry.status}</span>
        {entry.status === 'error' && (
          <button type="button" onClick={onRetry} disabled={isProcessing} style={retryButtonStyle}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  padding: '28px',
  borderRadius: '20px',
  boxShadow: '0 25px 70px rgba(15, 23, 42, 0.08)',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const dropzoneStyle = (isDragActive: boolean): React.CSSProperties => ({
  border: '2px dashed',
  borderColor: isDragActive ? '#4f46e5' : '#cbd5f5',
  borderRadius: '16px',
  padding: '40px',
  textAlign: 'center',
  background: isDragActive ? '#eef2ff' : '#f8fbff',
  cursor: 'pointer',
});

const eyebrowStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '12px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#94a3b8',
};

const primaryButtonStyle = (disabled: boolean): React.CSSProperties => ({
  border: 'none',
  borderRadius: '999px',
  padding: '10px 24px',
  fontWeight: 600,
  fontSize: '14px',
  background: disabled ? '#cbd5f5' : 'linear-gradient(120deg, #6366f1, #8b5cf6)',
  color: '#fff',
  cursor: disabled ? 'default' : 'pointer',
  boxShadow: disabled ? 'none' : '0 18px 40px rgba(99, 102, 241, 0.25)',
});

const fileRowStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: '14px',
  padding: '12px 16px',
  display: 'flex',
  gap: '12px',
  alignItems: 'center',
  background: '#f8fafc',
};

const retryButtonStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: '999px',
  padding: '6px 12px',
  fontSize: '12px',
  fontWeight: 600,
  background: '#fee2e2',
  color: '#b91c1c',
  cursor: 'pointer',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: '13px',
  color: '#475569',
};

function prettyBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status: FileStatus): string {
  switch (status) {
    case 'uploading':
      return 'Uploading to /uploads…';
    case 'submitting':
      return 'Posting job…';
    case 'success':
      return 'Job created';
    case 'error':
      return 'Failed';
    default:
      return 'Waiting to submit';
  }
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
  'upload',
  'mode',
];

function areSettingsEqual(a: AppliedJobSettings, b: AppliedJobSettings): boolean {
  return APPLIED_KEYS.every(key => a[key] === b[key]);
}
