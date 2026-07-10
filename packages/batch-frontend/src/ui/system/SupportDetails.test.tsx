import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SupportDetails } from './SupportDetails';

describe('SupportDetails', () => {
  it('uses a native disclosure', () => {
    render(<SupportDetails summary="Support details">Diagnostic text</SupportDetails>);
    expect(screen.getByText('Support details').closest('summary')).not.toBeNull();
    expect(screen.getByText('Diagnostic text').closest('details')).not.toBeNull();
  });
});
