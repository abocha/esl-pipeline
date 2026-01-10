import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { ValidationError } from '@esl-pipeline/contracts';

import { runImport } from '../../notion-adapter/src/importer.js';
import * as clientMod from '../../notion-adapter/src/client.js';
import * as dataSourceMod from '../../notion-adapter/src/data-source.js';
import * as retryMod from '../../notion-adapter/src/retry.js';

const writeLesson = (tempDir: string, propertiesLine: string) => {
  const mdRaw = `\`\`\`md
---
title: "Homework Assignment: Test"
student: "Anna"
level: A2
topic: weather, travel
input_type: "authentic"
speaker_labels: ["Anna"]
${propertiesLine}
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
:::toggle-heading Teacher's Follow-up Plan
Test plan
:::
\`\`\``;

  const md = mdRaw
    .split('\n')
    .map((line) => line.replace(/^\s+/, ''))
    .join('\n');
  const mdPath = join(tempDir, 'lesson.md');
  writeFileSync(mdPath, md);
  return mdPath;
};

describe('notion property mapping', () => {
  it('maps supported property types based on database schema', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'property-mapping-'));
    try {
      const mdPath = writeLesson(
        tempDir,
        `properties: { Status: Ready, Score: 4, Category: Grammar, Tags: [A, B], Note: "Remember to practice", Due: "2026-01-10", Reviewers: [user-1, user-2], Attachments: ["https://example.com/audio.mp3"], Approved: true, Website: "https://example.com", Email: "teacher@example.com", Phone: "+123456", Course: [rel-1, rel-2] }`,
      );

      vi.spyOn(dataSourceMod, 'resolveDataSourceId').mockResolvedValue({
        dataSourceId: 'ds-123',
        databaseId: 'db-456',
      });
      vi.spyOn(dataSourceMod, 'resolveStudentId').mockResolvedValue('student-1');

      const pagesCreate = vi.fn().mockResolvedValue({ id: 'p1', url: 'https://notion.so/x' });
      vi.spyOn(clientMod, 'createNotionClient').mockReturnValue({
        pages: { create: pagesCreate },
        databases: {
          retrieve: vi.fn().mockResolvedValue({
            id: 'db-456',
            properties: {
              Name: { type: 'title' },
              Status: { type: 'status' },
              Score: { type: 'number' },
              Category: { type: 'select' },
              Tags: { type: 'multi_select' },
              Note: { type: 'rich_text' },
              Due: { type: 'date' },
              Reviewers: { type: 'people' },
              Attachments: { type: 'files' },
              Approved: { type: 'checkbox' },
              Website: { type: 'url' },
              Email: { type: 'email' },
              Phone: { type: 'phone_number' },
              Course: { type: 'relation' },
              Topic: { type: 'multi_select' },
            },
          }),
        },
      } as unknown as ReturnType<typeof clientMod.createNotionClient>);

      vi.spyOn(retryMod, 'withRetry').mockImplementation(async (fn) => fn());

      await runImport({ mdPath, dbId: 'db-456' });

      const arg = pagesCreate.mock.calls[0]?.[0];
      const props = arg?.properties ?? {};
      expect(props.Name).toEqual({ title: [{ type: 'text', text: { content: 'Homework Assignment: Test' } }] });
      expect(props.Status).toEqual({ status: { name: 'Ready' } });
      expect(props.Score).toEqual({ number: 4 });
      expect(props.Category).toEqual({ select: { name: 'Grammar' } });
      expect(props.Tags).toEqual({ multi_select: [{ name: 'A' }, { name: 'B' }] });
      expect(props.Note).toEqual({
        rich_text: [{ type: 'text', text: { content: 'Remember to practice' } }],
      });
      expect(props.Due).toEqual({ date: { start: '2026-01-10' } });
      expect(props.Reviewers).toEqual({ people: [{ id: 'user-1' }, { id: 'user-2' }] });
      expect(props.Attachments).toEqual({
        files: [
          {
            name: 'audio.mp3',
            type: 'external',
            external: { url: 'https://example.com/audio.mp3' },
          },
        ],
      });
      expect(props.Approved).toEqual({ checkbox: true });
      expect(props.Website).toEqual({ url: 'https://example.com' });
      expect(props.Email).toEqual({ email: 'teacher@example.com' });
      expect(props.Phone).toEqual({ phone_number: '+123456' });
      expect(props.Course).toEqual({ relation: [{ id: 'rel-1' }, { id: 'rel-2' }] });
      expect(props.Topic).toEqual({ multi_select: [{ name: 'weather' }, { name: 'travel' }] });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects Notion-generated properties', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'property-generated-'));
    try {
      const mdPath = writeLesson(tempDir, 'properties: { Created: "2026-01-10" }');

      vi.spyOn(dataSourceMod, 'resolveDataSourceId').mockResolvedValue({
        dataSourceId: 'ds-123',
        databaseId: 'db-456',
      });

      vi.spyOn(clientMod, 'createNotionClient').mockReturnValue({
        pages: { create: vi.fn() },
        databases: {
          retrieve: vi.fn().mockResolvedValue({
            id: 'db-456',
            properties: {
              Name: { type: 'title' },
              Created: { type: 'created_time' },
            },
          }),
        },
      } as unknown as ReturnType<typeof clientMod.createNotionClient>);

      vi.spyOn(retryMod, 'withRetry').mockImplementation(async (fn) => fn());

      await expect(runImport({ mdPath, dbId: 'db-456' })).rejects.toThrow(ValidationError);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
