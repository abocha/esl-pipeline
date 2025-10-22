import { describe, it, expect } from 'vitest';
import { mdToBlocks } from '../src/mdToBlocks.js';

const sample = `
## 1. study text

:::study-text
A: Hello
B: Hi
:::

## 8. answer key
:::toggle-heading Answer Key
1) Yes.
:::
`;

describe('mdToBlocks', () => {
  it('maps headings, toggles, and study-text', () => {
    const blocks = mdToBlocks(sample);
    const types = blocks.map(b => b.type);
    expect(types.includes('heading_2')).toBe(true);
    expect(types.includes('toggle')).toBe(true);
  });
});
