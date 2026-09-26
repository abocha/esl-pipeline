import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LessonSourceStep } from './LessonSourceStep';

describe('LessonSourceStep', () => {
  it('offers supported recording upload and a durable existing-transcript path', async () => {
    const onCreateManualTranscript = vi.fn().mockResolvedValue(undefined);
    render(
      <LessonSourceStep
        studentSelected
        manualSaving={false}
        manualError={null}
        transcriptReady={false}
        onCreateManualTranscript={onCreateManualTranscript}
      >
        Upload controls
      </LessonSourceStep>,
    );

    expect(
      screen.getByRole('button', { name: /Upload lesson recording.*Audio or video recording/i }),
    ).toBeTruthy();
    expect(screen.getByText('Upload controls')).toBeTruthy();
    expect(screen.queryByText(/OPUS audio only/i)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Use an existing transcript/i }));
    expect(screen.queryByText('Upload controls')).toBeNull();
    expect(screen.getByText(/No audio transcription is started/i)).toBeTruthy();
    await userEvent.type(
      screen.getByRole('textbox', { name: /Existing lesson transcript/i }),
      'Existing lesson transcript',
    );
    await userEvent.click(screen.getByRole('button', { name: /Use transcript/i }));
    expect(onCreateManualTranscript).toHaveBeenCalledWith(
      'Existing lesson transcript',
      'Pasted lesson transcript',
    );
  });

  it('collapses mutually exclusive source choices after a source is prepared', () => {
    render(
      <LessonSourceStep
        studentSelected
        manualSaving={false}
        manualError={null}
        transcriptReady
        sourcePrepared
        onCreateManualTranscript={vi.fn().mockResolvedValue(undefined)}
      >
        Prepared source summary
      </LessonSourceStep>,
    );

    expect(screen.queryByRole('button', { name: /Upload lesson recording/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Use an existing transcript/i })).toBeNull();
    expect(screen.getByText('Prepared source summary')).toBeTruthy();
  });

  it('can abandon a source change and collapses again after a replacement is established', async () => {
    const user = userEvent.setup();
    const onCreateManualTranscript = vi.fn().mockResolvedValue(undefined);
    const props = {
      studentSelected: true,
      manualSaving: false,
      manualError: null,
      transcriptReady: true,
      sourcePrepared: true,
      onCreateManualTranscript,
    };
    const { rerender } = render(
      <LessonSourceStep {...props} preparedSourceKey="rec-1:tx-1">
        Current source summary
      </LessonSourceStep>,
    );

    await user.click(screen.getByRole('button', { name: /Change lesson source/i }));
    expect(screen.getByRole('button', { name: /Upload lesson recording/i })).toBeTruthy();
    expect(screen.queryByText(/OPUS audio only/i)).toBeNull();
    expect(screen.getByRole('button', { name: /Use an existing transcript/i })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Keep current source/i }));
    expect(screen.queryByRole('button', { name: /Use an existing transcript/i })).toBeNull();
    expect(screen.getByText('Current source summary')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Change lesson source/i }));
    await user.click(screen.getByRole('button', { name: /Use an existing transcript/i }));
    await user.type(
      screen.getByRole('textbox', { name: /Existing lesson transcript/i }),
      'New transcript',
    );
    await user.click(screen.getByRole('button', { name: /Use transcript/i }));
    expect(onCreateManualTranscript).toHaveBeenCalledWith(
      'New transcript',
      'Pasted lesson transcript',
    );

    rerender(
      <LessonSourceStep {...props} preparedSourceKey="rec-2:tx-2">
        Replacement source summary
      </LessonSourceStep>,
    );
    expect(screen.queryByRole('button', { name: /Use an existing transcript/i })).toBeNull();
    expect(screen.getByText('Replacement source summary')).toBeTruthy();
  });
});
