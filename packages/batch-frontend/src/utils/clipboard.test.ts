import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyTextToClipboard } from './clipboard';

describe('copyTextToClipboard', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const originalExecCommand = Object.getOwnPropertyDescriptor(Document.prototype, 'execCommand');

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
    if (originalExecCommand) {
      Object.defineProperty(Document.prototype, 'execCommand', originalExecCommand);
    } else {
      Reflect.deleteProperty(Document.prototype, 'execCommand');
    }
  });

  it('uses navigator.clipboard when available', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const execSpy = vi.fn(() => true);
    Object.defineProperty(Document.prototype, 'execCommand', {
      value: execSpy,
      configurable: true,
    });

    await expect(copyTextToClipboard('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(execSpy).not.toHaveBeenCalled();
  });

  it('falls back to execCommand when navigator.clipboard fails', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('clipboard denied');
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const execSpy = vi.fn(() => true);
    Object.defineProperty(Document.prototype, 'execCommand', {
      value: execSpy,
      configurable: true,
    });

    await expect(copyTextToClipboard('fallback')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('fallback');
    expect(execSpy).toHaveBeenCalledWith('copy');
  });

  it('returns false when all copy strategies fail', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(async () => {
          throw new Error('clipboard denied');
        }),
      },
      configurable: true,
    });

    Object.defineProperty(Document.prototype, 'execCommand', {
      value: vi.fn(() => false),
      configurable: true,
    });

    await expect(copyTextToClipboard('cannot-copy')).resolves.toBe(false);
  });
});
