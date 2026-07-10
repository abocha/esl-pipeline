import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProductNotice } from './ProductNotice';

describe('ProductNotice', () => {
  it('uses alert semantics only for errors', () => {
    const { rerender } = render(
      <ProductNotice tone="error" title="Unable to save">
        Try again.
      </ProductNotice>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Unable to save');

    rerender(
      <ProductNotice tone="info" title="Your work is saved">
        You can return later.
      </ProductNotice>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
