import { describe, expect, it } from 'vitest';

import { resolveHeadingTheme } from '../src/runtime/publish-utils.js';

describe('runtime/publish-utils', () => {
  it('maps preset colors into heading theme hex values', () => {
    expect(resolveHeadingTheme({ h2: 'blue', h3: 'green' })).toEqual({
      h2: '#2d9cdb',
      h3: '#27ae60',
    });
    expect(resolveHeadingTheme({})).toBeUndefined();
  });
});
