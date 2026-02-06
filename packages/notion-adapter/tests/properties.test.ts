import { describe, expect, it } from 'vitest';

import { mapFrontmatterProperties } from '../src/properties.js';

describe('mapFrontmatterProperties', () => {
  it('maps values based on property types', () => {
    const databaseProperties = {
      Status: { type: 'status' },
      Flag: { type: 'checkbox' },
    };

    const mapped = mapFrontmatterProperties({ Status: 'Ready', Flag: true }, databaseProperties);

    expect(mapped).toEqual({
      Status: { status: { name: 'Ready' } },
      Flag: { checkbox: true },
    });
  });
});
