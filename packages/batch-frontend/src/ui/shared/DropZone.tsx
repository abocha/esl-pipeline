import React, { useCallback } from 'react';
import { type Accept, type FileRejection, useDropzone } from 'react-dropzone';

import './SharedControls.css';

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
    (files: File[], fileRejections: readonly FileRejection[]) => {
      // react-dropzone >=19 returns in-limit files from an over-limit batch.
      // Preserve this wrapper's historical all-or-nothing single-file contract.
      const hasTooManyFilesRejection = fileRejections.some((rejection) =>
        rejection.errors.some((error) => error.code === 'too-many-files'),
      );
      if (files.length === 0 || (!multiple && hasTooManyFilesRejection)) return;
      onFiles(files);
    },
    [multiple, onFiles],
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
        <div className="dropzone-icon">
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
