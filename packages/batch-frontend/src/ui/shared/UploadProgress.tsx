import React from 'react';

import './SharedControls.css';

interface UploadProgressProps {
  fileName?: string | null;
  progress: number;
  onCancel?: () => void;
}

export const UploadProgress: React.FC<UploadProgressProps> = ({ fileName, progress, onCancel }) => {
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
        <span style={{ transform: `scaleX(${normalized / 100})` }} />
      </div>
      <span className="upload-progress-value">{normalized}%</span>
    </div>
  );
};
