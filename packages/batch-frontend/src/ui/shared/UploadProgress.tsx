import React from 'react';

interface UploadProgressProps {
  fileName?: string | null;
  progress: number;
  onCancel?: () => void;
}

export const UploadProgress: React.FC<UploadProgressProps> = ({
  fileName,
  progress,
  onCancel,
}) => {
  const normalized = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div className="upload-progress">
      <div className="upload-progress-header">
        <div>
          <span className="upload-progress-label">Uploading</span>
          {fileName ? <span className="upload-progress-name">{fileName}</span> : null}
        </div>
        {onCancel ? (
          <button type="button" className="upload-cancel" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
      <div className="upload-progress-bar">
        <span style={{ width: `${normalized}%` }} />
      </div>
      <span className="upload-progress-value">{normalized}%</span>

      <style>{`
        .upload-progress {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .upload-progress-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
        }

        .upload-progress-label {
          font-size: var(--text-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-tertiary);
        }

        .upload-progress-name {
          display: block;
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-primary);
        }

        .upload-progress-bar {
          height: 8px;
          background: var(--bg-tertiary);
          border-radius: var(--radius-full);
          overflow: hidden;
        }

        .upload-progress-bar span {
          display: block;
          height: 100%;
          background: var(--gradient-primary);
          transition: width var(--transition-base);
        }

        .upload-progress-value {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .upload-cancel {
          background: transparent;
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-full);
          padding: var(--space-1) var(--space-3);
          font-size: var(--text-xs);
          color: var(--text-secondary);
          cursor: pointer;
        }

        .upload-cancel:hover {
          border-color: var(--color-error-400);
          color: var(--color-error-500);
        }
      `}</style>
    </div>
  );
};
