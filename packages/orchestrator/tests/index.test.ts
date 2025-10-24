import { describe, expect, it } from 'vitest';
import { newAssignment } from '../src/index.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('orchestrator stub', () => {
  it('produces manifest and step summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-'));
    const mdPath = join(dir, 'lesson.md');
    const voiceMapPath = join(dir, 'voices.yml');
    await import('node:fs/promises').then(fs => fs.writeFile(mdPath, `
---
title: Test Lesson
student: Anna
level: A1
topic: greetings
input_type: monologue
---

# Warm-up

:::study-text
This is a test lesson.
:::
    `.trim()));
    await import('node:fs/promises').then(fs => fs.writeFile(voiceMapPath, `
default: voice_id_default
    `.trim()));
    const result = await newAssignment({
      md: mdPath,
      preset: 'default',
      withTts: true,
      upload: 's3',
      dryRun: true,
      voices: voiceMapPath
    });

    expect(result.steps).toContain('import');
    expect(result.manifestPath).toBeDefined();
    expect(result.pageId).toBeDefined();
  });
});
