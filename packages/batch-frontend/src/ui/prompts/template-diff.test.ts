import { describe, expect, it } from 'vitest';

import { diffTemplateContent } from './template-diff';

describe('template content diff', () => {
  it('keeps ordering and repeated lines while marking additions and removals', () => {
    expect(
      diffTemplateContent(
        'Header\nRepeat\nOld\nRepeat\nFooter',
        'Header\nRepeat\nNew\nRepeat\nFooter',
      ),
    ).toEqual([
      { kind: 'same', text: 'Header' },
      { kind: 'same', text: 'Repeat' },
      { kind: 'removed', text: 'Old' },
      { kind: 'added', text: 'New' },
      { kind: 'same', text: 'Repeat' },
      { kind: 'same', text: 'Footer' },
    ]);
  });
  it('represents reordered lines as changed rather than comparing unordered membership', () => {
    const diff = diffTemplateContent('A\nB\nC', 'B\nA\nC');
    expect(
      diff
        .filter((line) => line.kind !== 'added')
        .map((line) => line.text)
        .join('\n'),
    ).toBe('A\nB\nC');
    expect(
      diff
        .filter((line) => line.kind !== 'removed')
        .map((line) => line.text)
        .join('\n'),
    ).toBe('B\nA\nC');
    expect(diff.some((line) => line.kind === 'removed')).toBe(true);
  });
  it('bounds work for large replaced content and preserves both exact texts', () => {
    const before = Array.from({ length: 1100 }, (_, i) => `old ${i}`).join('\n');
    const after = Array.from({ length: 1100 }, (_, i) => `new ${i}`).join('\n');
    const diff = diffTemplateContent(before, after);
    expect(
      diff
        .filter((line) => line.kind !== 'added')
        .map((line) => line.text)
        .join('\n'),
    ).toBe(before);
    expect(
      diff
        .filter((line) => line.kind !== 'removed')
        .map((line) => line.text)
        .join('\n'),
    ).toBe(after);
  });
});
