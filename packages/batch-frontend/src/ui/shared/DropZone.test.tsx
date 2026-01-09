import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { DropZone } from './DropZone';

let mockRejections: { file: File; errors: { code: string; message: string }[] }[] = [];

vi.mock('react-dropzone', () => ({
  useDropzone: () => ({
    getRootProps: () => ({}),
    getInputProps: () => ({}),
    isDragActive: false,
    fileRejections: mockRejections,
  }),
}));

describe('DropZone', () => {
  beforeEach(() => {
    mockRejections = [];
  });

  afterEach(() => {
    cleanup();
  });

  it('renders rejection messages for invalid files', () => {
    mockRejections = [
      {
        file: new File(['bad'], 'bad.txt', { type: 'text/plain' }),
        errors: [{ code: 'file-invalid-type', message: 'Invalid type' }],
      },
      {
        file: new File(['too-many'], 'extra.mp3', { type: 'audio/mpeg' }),
        errors: [{ code: 'too-many-files', message: 'Too many files' }],
      },
    ];

    render(
      <DropZone
        title="Upload"
        onFiles={vi.fn()}
      />,
    );

    expect(screen.getByText(/bad.txt: Unsupported file type/i)).not.toBeNull();
    expect(screen.getByText(/extra.mp3: Too many files selected/i)).not.toBeNull();
  });
});
