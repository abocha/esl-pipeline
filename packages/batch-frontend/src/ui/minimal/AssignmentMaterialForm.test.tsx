// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AssignmentMaterial, emptyAssignmentMaterial } from '@esl-pipeline/contracts';

import { fetchAssignmentMaterialTranscript } from '../../utils/api';
import { AssignmentMaterialForm } from './AssignmentMaterialForm';
import { assignmentMaterialErrors } from './AssignmentMaterialForm.validation';

vi.mock('../../utils/api', () => ({ fetchAssignmentMaterialTranscript: vi.fn() }));
const url = 'https://www.youtube.com/watch?v=ESL84demo01';
// biome-ignore lint/style/useComponentExportOnlyModules: Stateful test harness is local to the component tests.
function Form({
  initial = emptyAssignmentMaterial(),
  active = true,
  sessionId = 'session-maya',
}: {
  initial?: AssignmentMaterial;
  active?: boolean;
  sessionId?: string;
}) {
  const [material, setMaterial] = useState(initial);
  return (
    <AssignmentMaterialForm
      material={material}
      onChange={setMaterial}
      sessionId={sessionId}
      active={active}
    />
  );
}
function authentic(sourceText = ''): AssignmentMaterial {
  return { mode: 'authentic', sourceUrl: url, sourceText, sourceTextUrl: url };
}
function sourceText() {
  return screen.getByRole('textbox', { name: 'Transcript or source text' }) as HTMLTextAreaElement;
}

describe('assignment material input', () => {
  beforeEach(() => vi.resetAllMocks());
  it('starts Generated and preserves source edits across mode switches without fetching', () => {
    render(<Form />);
    expect((screen.getByRole('radio', { name: /Generated/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.queryByLabelText('Source link')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Authentic/ }));
    fireEvent.change(screen.getByLabelText('Source link'), { target: { value: url } });
    fireEvent.change(sourceText(), { target: { value: 'Tutor edited text.' } });
    fireEvent.click(screen.getByRole('radio', { name: /Generated/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Authentic/ }));
    expect(sourceText().value).toBe('Tutor edited text.');
    expect(fetchAssignmentMaterialTranscript).not.toHaveBeenCalled();
  });
  it('requires safe URL and actual source text, allowing an article excerpt', () => {
    expect(assignmentMaterialErrors(authentic())).toHaveProperty('sourceText');
    expect(
      assignmentMaterialErrors({ ...authentic('excerpt'), sourceUrl: 'file:///secret' }),
    ).toHaveProperty('sourceUrl');
    render(
      <Form
        initial={{
          ...authentic('A useful article excerpt.'),
          sourceUrl: 'https://example.com/article',
          sourceTextUrl: 'https://example.com/article',
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Fetch transcript' })).toBeNull();
    expect(sourceText().value).toBe('A useful article excerpt.');
  });
  it('fetches explicitly once and keeps the successful result editable', async () => {
    let resolve!: (value: { sourceUrl: string; sourceText: string }) => void;
    vi.mocked(fetchAssignmentMaterialTranscript).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(<Form initial={authentic()} />);
    const button = screen.getByRole('button', { name: 'Fetch transcript' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchAssignmentMaterialTranscript).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ sourceUrl: url, sourceText: 'Fetched text.' }));
    expect(sourceText().value).toBe('Fetched text.');
    fireEvent.change(sourceText(), { target: { value: 'Corrected fetched text.' } });
    expect(sourceText().value).toBe('Corrected fetched text.');
  });
  it('asks before replacing nonempty text and preserves it on failure', async () => {
    vi.mocked(fetchAssignmentMaterialTranscript).mockRejectedValue(
      new Error('Captions unavailable. Paste a transcript below.'),
    );
    render(<Form initial={authentic('Keep my edits.')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fetch transcript' }));
    expect(fetchAssignmentMaterialTranscript).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep text' }));
    expect(sourceText().value).toBe('Keep my edits.');
    fireEvent.click(screen.getByRole('button', { name: 'Fetch transcript' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace text' }));
    await screen.findByText(/Captions unavailable/);
    expect(sourceText().value).toBe('Keep my edits.');
    expect(
      screen.getByRole('link', { name: 'Get transcript manually' }).getAttribute('target'),
    ).toBe('_blank');
    expect(assignmentMaterialErrors(authentic('Keep my edits.'))).toEqual({});
  });
  it.each(['edit', 'url', 'mode', 'leave', 'session'])(
    'ignores late fetch results after %s changes',
    async (change) => {
      let resolve!: (value: { sourceUrl: string; sourceText: string }) => void;
      vi.mocked(fetchAssignmentMaterialTranscript).mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const view = render(<Form initial={authentic()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Fetch transcript' }));
      if (change === 'edit')
        fireEvent.change(sourceText(), { target: { value: 'Newer tutor text.' } });
      if (change === 'url')
        fireEvent.change(screen.getByLabelText('Source link'), {
          target: { value: 'https://example.com/other' },
        });
      if (change === 'mode') fireEvent.click(screen.getByRole('radio', { name: /Generated/ }));
      if (change === 'leave') view.rerender(<Form initial={authentic()} active={false} />);
      if (change === 'session')
        view.rerender(<Form initial={authentic()} sessionId="session-other" />);
      await act(async () => resolve({ sourceUrl: url, sourceText: 'Obsolete response.' }));
      if (change === 'mode') fireEvent.click(screen.getByRole('radio', { name: /Authentic/ }));
      expect(sourceText().value).toBe(change === 'edit' ? 'Newer tutor text.' : '');
    },
  );
  it('recognizes equivalent YouTube links but requires explicit association with another source', async () => {
    render(<Form initial={authentic('Keep this text.')} />);
    fireEvent.change(screen.getByLabelText('Source link'), {
      target: { value: 'https://youtu.be/ESL84demo01?t=20' },
    });
    expect(screen.queryByText('This text belongs to the previous link.')).toBeNull();
    fireEvent.change(screen.getByLabelText('Source link'), {
      target: { value: 'https://example.com/new-source' },
    });
    expect(sourceText().value).toBe('Keep this text.');
    fireEvent.click(screen.getByRole('button', { name: 'Use this text with new link' }));
    await waitFor(() =>
      expect(screen.queryByText('This text belongs to the previous link.')).toBeNull(),
    );
  });
});
