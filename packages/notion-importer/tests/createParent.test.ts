// packages/notion-importer/tests/createParent.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as notionMod from '../src/notion.js';
import { runImport } from '../src/index.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('pages.create parent uses data_source', () => {
  it('calls pages.create with parent.data_source.id', async () => {
    // MD fixture with proper structure that passes validation
    const tempDir = mkdtempSync(join(tmpdir(), 'create-parent-'));
    try {
      const mdRaw = `\`\`\`md
---
title: "Homework Assignment: Test"
student: "Anna"
level: A2
topic: weather
input_type: "authentic"
speaker_labels: ["Anna"]
---
## 1. This Week's Mission Briefing
Test briefing

## 2. Your Homework Roadmap
Test roadmap

## 3. Input Material: The Source
### B. Generated Material
- **Text:**
:::study-text
[Anna]: Hello, how are you?
:::

## 4. Language Toolkit: Useful Language
Test toolkit

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
Test mission

## 7. Why This Mission Helps You
Test explanation

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
        .map(line => line.replace(/^\s+/, ''))
        .join('\n');
      const mdPath = join(tempDir, 'lesson.md');
      writeFileSync(mdPath, md);

      // Mock resolveDataSourceId to return specific IDs
      vi.spyOn(notionMod, 'resolveDataSourceId' as any).mockResolvedValue({
        dataSourceId: 'ds-123',
        databaseId: 'db-456',
      });

      // Mock notion client and pages.create
      const pagesCreate = vi.fn().mockResolvedValue({ id: 'p1', url: 'https://notion.so/x' });
      vi.spyOn(notionMod, 'createNotionClient' as any).mockReturnValue({
        pages: { create: pagesCreate },
      });

      // Mock resolveStudentId to return student page ID
      vi.spyOn(notionMod, 'resolveStudentId' as any).mockResolvedValue('student-page-id');

      const res = await runImport({
        mdPath: mdPath,
        dbId: 'db-456',
        dryRun: false,
      });

      expect(pagesCreate).toHaveBeenCalled();
      const arg = pagesCreate.mock.calls[0]?.[0];
      expect(arg?.parent).toEqual({ data_source_id: 'ds-123' });
      expect(res.page_id).toBe('p1');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
