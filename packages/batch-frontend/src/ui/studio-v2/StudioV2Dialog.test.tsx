import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StudioV2Dialog } from './StudioV2Dialog';

function press(dialog: HTMLElement, down: number, up: number) {
  fireEvent(dialog, new MouseEvent('pointerdown', { bubbles: true, clientX: down, clientY: 150 }));
  fireEvent.click(dialog, { clientX: up, clientY: 150 });
}

describe('Studio dialog backdrop', () => {
  it.each([false, true])('dismisses on a complete backdrop press with drawer=%s', (drawer) => {
    const onClose = vi.fn();
    render(
      <StudioV2Dialog title="Editor" drawer={drawer} onClose={onClose}>
        Form
      </StudioV2Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Editor' });
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 200, 200));

    press(dialog, 150, 150);
    press(dialog, 150, 50);
    press(dialog, 50, 150);
    expect(onClose).not.toHaveBeenCalled();

    press(dialog, 50, 50);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the modal open while closing is disabled', () => {
    const onClose = vi.fn();
    render(
      <StudioV2Dialog title="Editor" closeDisabled onClose={onClose}>
        Form
      </StudioV2Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Editor' });
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 200, 200));

    press(dialog, 50, 50);
    expect(onClose).not.toHaveBeenCalled();
  });
});
