import { describe, expect, it } from 'vitest';

import { resolveHeadingTheme } from '../src/index.js';

describe('heading theme', () => {
  it('maps notion colors into heading theme hex values', () => {
    expect(resolveHeadingTheme({ h2: 'blue', h3: 'green' })).toEqual({
      h2: '#2d9cdb',
      h3: '#27ae60',
    });
    expect(resolveHeadingTheme({})).toBeUndefined();
  });
});
