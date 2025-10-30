// packages/notion-importer/tests/parentShape.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runImport } from '../src/index.js';
import * as notion from '../src/notion.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('parent object shape', () => {
  it('uses the chosen data source parent shape', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'parent-shape-'));
    try {
      const md = `\`\`\`md
---
title: "Test"
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
      const normalized = md
        .split('\n')
        .map(line => line.replace(/^\s+/, ''))
        .join('\n');
      const mdPath = join(tempDir, 'lesson.md');
      writeFileSync(mdPath, normalized);

      // Mock resolveDataSourceId to return specific IDs
      vi.spyOn(notion, 'resolveDataSourceId' as any).mockResolvedValue({
        dataSourceId: 'ds-123',
        databaseId: 'db-456',
      });

      // Mock createNotionClient and pages.create
      const create = vi.fn().mockResolvedValue({ id: 'p1' });
      vi.spyOn(notion, 'createNotionClient' as any).mockReturnValue({ pages: { create } });

      // Mock resolveStudentId to return student page ID
      vi.spyOn(notion, 'resolveStudentId' as any).mockResolvedValue('student-page-id');

      // Mock withRetry to avoid actual network calls during test
      const withRetry = vi.fn(async fn => fn());
      vi.doMock('../src/retry.js', () => ({ withRetry }));

      await runImport({ mdPath: mdPath, dbId: 'db-456' });

      const arg = create.mock.calls[0]?.[0];
      // Assert the implemented shape: { data_source_id: '...' }
      expect(arg?.parent).toEqual({ data_source_id: 'ds-123' });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
