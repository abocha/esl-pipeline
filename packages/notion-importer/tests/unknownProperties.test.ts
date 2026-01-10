import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { ValidationError } from '@esl-pipeline/contracts';

import { runImport } from '../../notion-adapter/src/importer.js';
import * as clientMod from '../../notion-adapter/src/client.js';
import * as dataSourceMod from '../../notion-adapter/src/data-source.js';

describe('runImport - unknown properties', () => {
  it('fails fast when frontmatter properties are not in the database', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'unknown-props-'));
    try {
      const mdRaw = `\`\`\`md
---
title: "Homework Assignment: Test"
student: "Anna"
level: A2
topic: weather
input_type: "authentic"
properties:
  Foo: "bar"
---
## 1. This Week's Mission Briefing
text

## 2. Your Homework Roadmap
text

## 3. Input Material: The Source
### B. Generated Material
- **Text:**
:::study-text
[Anna]: Hello, how are you?
:::

## 4. Language Toolkit: Useful Language
text

## 5. Practice & Pronunciation
### A. Controlled Practice
1) item one
2) item two
3) item three
4) item four
5) item five
6) item six
7) item seven
8) item eight
### B. Comprehension Check
1) question one
2) question two

## 6. Your Turn: Complete the Mission!
text

## 7. Why This Mission Helps You
text

## 8. Answer Key & Sample Mission
:::toggle-heading Answer Key
Test answers
:::

## 9. Teacher's Follow-up Plan
:::toggle-heading Teacher’s Follow-up Plan
Test plan
:::
\`\`\``;
      const md = mdRaw
        .split('\n')
        .map((line) => line.replace(/^\s+/, ''))
        .join('\n');
      const mdPath = join(tempDir, 'lesson.md');
      writeFileSync(mdPath, md);

      // Mock resolveDataSourceId to return specific IDs
      vi.spyOn(dataSourceMod, 'resolveDataSourceId').mockResolvedValue({
        dataSourceId: 'ds-123',
        databaseId: 'db-456',
      });

      // Mock notion client and pages.create
      vi.spyOn(clientMod, 'createNotionClient').mockReturnValue({
        pages: { create: vi.fn() },
        databases: {
          retrieve: vi.fn().mockResolvedValue({
            id: 'db-456',
            properties: { Name: { type: 'title' }, Topic: { type: 'rich_text' } },
          }),
        },
      } as unknown as ReturnType<typeof clientMod.createNotionClient>);

      await expect(
        runImport({
          mdPath,
          dbId: 'db-456',
          dryRun: false,
        }),
      ).rejects.toThrow(ValidationError);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
