import { describe, expect, it } from 'vitest';
import { applyHeadingPreset } from '../src/index.js';

describe('applyHeadingPreset', () => {
  it('returns zero-count stub result', async () => {
    const result = await applyHeadingPreset('page-123', 'default');
    expect(result.applied).toBe(false);
    expect(result.counts).toEqual({ h2: 0, h3: 0, toggles: 0 });
    expect(result.preset).toBe('default');
  });
});
