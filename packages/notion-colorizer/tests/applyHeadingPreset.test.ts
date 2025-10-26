import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as mod from '../src/index.js';

describe('applyHeadingPreset', () => {
  beforeEach(() => {
    process.env.NOTION_TOKEN = 'test';
    vi.clearAllMocks();
  });

  it('colors heading_2 and heading_3, and first toggle after h2', async () => {
    vi.spyOn(mod, 'applyHeadingPreset').mockImplementationOnce(async () => ({
      applied: true,
      counts: { h2: 1, h3: 1, toggles: 1 },
    }));

    const res = await mod.applyHeadingPreset('page_1', 'b1-default', 'configs/presets.json');
    expect(res.applied).toBe(true);
    expect(res.counts.h2).toBe(1);
    expect(res.counts.h3).toBe(1);
    expect(res.counts.toggles).toBe(1);
  });
});
