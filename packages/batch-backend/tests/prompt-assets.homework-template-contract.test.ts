import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { ASSIGNMENT_TEMPLATE_CONTRACT, ASSIGNMENT_TEMPLATE_ID } from '@esl-pipeline/contracts';

describe('structured homework bootstrap template', () => {
  it('pins the domain contract without generated Markdown layout instructions', async () => {
    const template = await readFile(
      path.join(import.meta.dirname, '..', 'prompt-assets', 'templates', ASSIGNMENT_TEMPLATE_ID),
      'utf8',
    );
    expect(template.split(/\r?\n/)[0]).toBe(ASSIGNMENT_TEMPLATE_CONTRACT);
    for (const obsolete of [
      ':::study-text',
      'raw Markdown',
      'YAML front matter',
      'Definitive Homework Output Template',
      'code fence',
    ])
      expect(template).not.toContain(obsolete);
    for (const semantic of [
      'Source Authority by Fact Type',
      'Parallel Scenario Principle',
      'real linguistic decision',
      'optional',
      'age',
      'supplied',
    ])
      expect(template).toContain(semantic);
  });
});
