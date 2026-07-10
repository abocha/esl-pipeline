import { render, screen } from '@testing-library/react';
import { Save } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { ProductButton } from './ProductButton';

describe('ProductButton', () => {
  it('disables interaction and exposes busy state', () => {
    render(<ProductButton busy>Saving</ProductButton>);
    const button = screen.getByRole('button', { name: 'Saving' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides a decorative icon from assistive technology', () => {
    render(<ProductButton icon={<Save data-testid="icon" />}>Save draft</ProductButton>);
    expect(screen.getByTestId('icon').getAttribute('aria-hidden')).toBe('true');
  });
});
