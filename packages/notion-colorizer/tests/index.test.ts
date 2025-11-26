import { describe, expect, it } from 'vitest';

import { applyHeadingPreset } from '../src/index.js';

describe('applyHeadingPreset', () => {
  it.todo(
    'returns zero-count stub result',
    async () => {
      const result = await applyHeadingPreset('page-123', 'b1-default', './configs/presets.json');
      expect(result.applied).toBe(true);
      expect(result.counts).toEqual({ h2: 0, h3: 0, toggles: 0 });
    },
    10_000,
  );
});
