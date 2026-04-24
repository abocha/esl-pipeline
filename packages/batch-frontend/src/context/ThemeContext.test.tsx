import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from './ThemeContext';

const matchMediaMock = vi.fn();

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    matchMediaMock.mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      value: matchMediaMock,
    });
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to light mode even when the browser prefers dark mode', async () => {
    render(
      <ThemeProvider>
        <p>App</p>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('light');
    });
    expect(localStorage.getItem('esl-batch-theme')).toBe('light');
  });

  it('migrates a previously stored dark preference back to light mode', async () => {
    localStorage.setItem('esl-batch-theme', 'dark');

    render(
      <ThemeProvider>
        <p>App</p>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('light');
    });
    expect(localStorage.getItem('esl-batch-theme')).toBe('light');
  });
});
