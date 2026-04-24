import React, { useCallback } from 'react';
import { type Accept, type FileRejection, useDropzone } from 'react-dropzone';

interface DropZoneProps {
  title: string;
  description?: string;
  hint?: string;
  accept?: Accept;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}

const UploadIcon = () => (
  <svg
    width="28"
    height="28"
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

export const DropZone: React.FC<DropZoneProps> = ({
  title,
  description,
  hint,
  accept,
  multiple = false,
  disabled,
  onFiles,
}) => {
  const handleDrop = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      onFiles(files);
    },
    [onFiles],
  );

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop: handleDrop,
    accept,
    multiple,
    disabled,
    maxFiles: multiple ? undefined : 1,
  });

  const rejectionMessages = formatRejections(fileRejections);

  return (
    <div
      {...getRootProps()}
      className={`dropzone-shell ${isDragActive ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
    >
      <input {...getInputProps()} />
      <div className="dropzone-content">
        <div className={`dropzone-icon ${isDragActive ? 'bounce' : ''}`}>
          <UploadIcon />
        </div>
        <div>
          <h4>{title}</h4>
          {description ? <p>{description}</p> : null}
        </div>
        <span className="dropzone-hint">{hint ?? 'Drag & drop files or click to browse'}</span>
      </div>
      {rejectionMessages.length > 0 ? (
        <div className="dropzone-errors">
          {rejectionMessages.map((message, index) => (
            <p key={`${message}-${index}`} className="dropzone-error">
              {message}
            </p>
          ))}
        </div>
      ) : null}

      <style>{`
        .dropzone-shell {
          border: 1px dashed var(--border-medium);
          border-radius: var(--radius-2xl);
          padding: var(--space-6);
          text-align: center;
          background: var(--bg-primary);
          cursor: pointer;
          transition:
            border-color var(--transition-fast),
            box-shadow var(--transition-fast),
            opacity var(--transition-fast);
        }

        .dropzone-shell.active {
          border-color: var(--color-primary-400);
          box-shadow: var(--shadow-md);
        }

        .dropzone-shell.disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .dropzone-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-2);
        }

        .dropzone-content h4 {
          margin: 0;
          font-size: var(--text-base);
        }

        .dropzone-content p {
          margin: 0;
          color: var(--text-tertiary);
          font-size: var(--text-sm);
        }

        .dropzone-icon {
          width: 54px;
          height: 54px;
          border-radius: var(--radius-xl);
          background: var(--bg-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--color-primary-500);
        }

        .dropzone-icon.bounce {
          animation: pulse 1s ease-in-out infinite;
        }

        .dropzone-hint {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }

        .dropzone-errors {
          margin-top: var(--space-3);
          display: grid;
          gap: var(--space-1);
          text-align: center;
        }

        .dropzone-error {
          margin: 0;
          font-size: var(--text-xs);
          color: var(--color-error-500);
        }
      `}</style>
    </div>
  );
};

function formatRejections(rejections: readonly FileRejection[]): string[] {
  const messages: string[] = [];
  for (const rejection of rejections) {
    const name = rejection.file.name;
    for (const error of rejection.errors) {
      messages.push(`${name}: ${formatRejectionReason(error.code)}`);
    }
  }
  return messages;
}

function formatRejectionReason(code: string): string {
  switch (code) {
    case 'file-invalid-type': {
      return 'Unsupported file type.';
    }
    case 'file-too-large': {
      return 'File is too large.';
    }
    case 'file-too-small': {
      return 'File is too small.';
    }
    case 'too-many-files': {
      return 'Too many files selected.';
    }
    default: {
      return 'File rejected.';
    }
  }
}
