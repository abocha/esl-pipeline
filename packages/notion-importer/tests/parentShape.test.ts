// packages/notion-importer/tests/parentShape.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runImport } from '../src/index.js';
import * as notion from '../src/notion.js';
import { writeFileSync } from 'node:fs';

describe('parent object shape', () => {
  it('uses the chosen data source parent shape', async () => {
    const md = `\`\`\`md
---
title: "Test"
student: "Anna"
level: A2
topic: weather
input_type: "authentic"
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
Test practice

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
    writeFileSync('tmp.md', md);

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
    const withRetry = vi.fn(async (fn) => fn());
    vi.doMock('../src/retry.js', () => ({ withRetry }));

    await runImport({ mdPath: 'tmp.md', dbId: 'db-456' });

    const arg = create.mock.calls[0]?.[0];
    // Assert the implemented shape: { data_source_id: '...' }
    expect(arg?.parent).toEqual({ data_source_id: 'ds-123' });
  });
});