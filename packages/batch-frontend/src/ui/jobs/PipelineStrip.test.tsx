import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PipelineStrip } from './PipelineStrip';

describe('PipelineStrip', () => {
  it('renders neutral state when stages are missing', () => {
    render(<PipelineStrip stages={null} />);
    const strip = document.querySelector('.pipeline-strip');
    expect(strip?.classList.contains('pipeline-neutral')).toBe(true);
    expect(screen.getAllByText(/Val|Ext|Not|TTS|Up|Att/).length).toBeGreaterThan(0);
  });

  it('renders stage states when stages are present', () => {
    render(
      <PipelineStrip
        stages={{
          validate: 'succeeded',
          extract: 'running',
          notion: 'pending',
          tts: 'pending',
          upload: 'pending',
          attach: 'pending',
        }}
      />,
    );

    const running = document.querySelector('.pipeline-running');
    const succeeded = document.querySelector('.pipeline-succeeded');
    expect(running).not.toBeNull();
    expect(succeeded).not.toBeNull();
  });
});
