import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DropZone } from './DropZone';

const accept = { 'audio/*': ['.opus'] };

function makeFile(name: string, type: string): File {
  return new File(['audio'], name, { type });
}

function renderDropZone(overrides: Partial<React.ComponentProps<typeof DropZone>> = {}) {
  const onFiles = overrides.onFiles ?? vi.fn();

  render(<DropZone title="Upload audio" accept={accept} onFiles={onFiles} {...overrides} />);

  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('DropZone file input was not rendered');
  }

  return { input, onFiles };
}

describe('DropZone', () => {
  it('passes a valid file to onFiles', async () => {
    const { input, onFiles } = renderDropZone();
    const file = makeFile('lesson.opus', 'audio/ogg');

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([file]));
  });

  it('rejects an audio file whose extension is outside the configured accept list', async () => {
    const { input, onFiles } = renderDropZone();
    const file = makeFile('lesson.mp3', 'audio/mpeg');

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText('lesson.mp3: Unsupported file type.')).toBeTruthy();
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('does not pass an invalid file type through and maps its rejection', async () => {
    const { input, onFiles } = renderDropZone();
    const file = makeFile('lesson.pdf', 'application/pdf');

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText('lesson.pdf: Unsupported file type.')).toBeTruthy();
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('does not accept files while disabled', () => {
    const { input, onFiles } = renderDropZone({ disabled: true });
    const file = makeFile('lesson.opus', 'audio/ogg');
    const shell = input.closest('.dropzone-shell');

    expect(shell?.classList.contains('disabled')).toBe(true);
    fireEvent.change(input, { target: { files: [file] } });

    expect(onFiles).not.toHaveBeenCalled();
  });

  it('does not deliver multiple files in single-file mode', async () => {
    const { input, onFiles } = renderDropZone({ multiple: false });
    const first = makeFile('first.opus', 'audio/ogg');
    const second = makeFile('second.opus', 'audio/ogg');

    fireEvent.change(input, { target: { files: [first, second] } });

    expect(await screen.findByText('second.opus: Too many files selected.')).toBeTruthy();
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('passes multiple valid files in multiple-file mode', async () => {
    const { input, onFiles } = renderDropZone({ multiple: true });
    const first = makeFile('first.opus', 'audio/ogg');
    const second = makeFile('second.opus', 'audio/ogg');

    fireEvent.change(input, { target: { files: [first, second] } });

    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([first, second]));
  });

  it('passes accepted files while mapping rejections in a mixed selection', async () => {
    const { input, onFiles } = renderDropZone({ multiple: true });
    const accepted = makeFile('lesson.opus', 'audio/ogg');
    const rejected = makeFile('lesson.pdf', 'application/pdf');

    fireEvent.change(input, { target: { files: [accepted, rejected] } });

    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([accepted]));
    expect(await screen.findByText('lesson.pdf: Unsupported file type.')).toBeTruthy();
  });
});
