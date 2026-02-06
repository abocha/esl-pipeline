import { describe, expect, it } from 'vitest';

import { findDirectiveBlocks, parsePmdDocument } from '../src/index.js';

const baseFrontmatter = [
  '---',
  'title: "Test"',
  'student: "A"',
  'level: "A1"',
  'topic: "X"',
  'input_type: "generate"',
  'icon: "X"',
  '---',
  '',
].join('\n');

describe('parsePmdDocument', () => {
  it('parses nested directives in order', () => {
    const md =
      baseFrontmatter +
      [':::toggle Answer Key', ':::callout target', 'Inner content', ':::', ':::'].join('\n');

    const doc = parsePmdDocument(md);
    const toggles = findDirectiveBlocks(doc, 'toggle');
    expect(toggles).toHaveLength(1);

    const callouts = findDirectiveBlocks(toggles[0]?.children ?? [], 'callout');
    expect(callouts).toHaveLength(1);
  });

  it('warns on legacy fenced input', () => {
    const legacy = [
      '```',
      baseFrontmatter.trimEnd(),
      ':::study-text Transcript',
      'Hello',
      ':::',
      '```',
    ].join('\n');

    const doc = parsePmdDocument(legacy);
    expect(doc.meta.format).toBe('legacy-fenced');
    expect(doc.warnings).toHaveLength(1);
    expect(doc.warnings[0]?.code).toBe('legacy-fenced-input');
  });

  it('detects study-text directives', () => {
    const withStudyText =
      baseFrontmatter + [':::study-text Transcript', 'Line 1', ':::'].join('\n');

    const withoutStudyText = baseFrontmatter + 'Plain paragraph.';

    const found = findDirectiveBlocks(parsePmdDocument(withStudyText), 'study-text');
    const missing = findDirectiveBlocks(parsePmdDocument(withoutStudyText), 'study-text');

    expect(found).toHaveLength(1);
    expect(missing).toHaveLength(0);
  });
});
