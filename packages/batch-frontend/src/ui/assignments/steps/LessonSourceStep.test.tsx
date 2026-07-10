import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LessonSourceStep } from './LessonSourceStep';

describe('LessonSourceStep', () => {
  it('offers OPUS upload and a durable existing-transcript path', async () => {
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

    expect(screen.getAllByText(/OPUS audio only during the alpha/i).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: /Use an existing transcript/i }));
    await userEvent.type(
      screen.getByRole('textbox', { name: /Existing lesson transcript/i }),
      'Existing lesson transcript',
    );
    await userEvent.click(screen.getByRole('button', { name: /Save existing transcript/i }));
    expect(onCreateManualTranscript).toHaveBeenCalledWith(
      'Existing lesson transcript',
      'Pasted lesson transcript',
    );
  });
});
