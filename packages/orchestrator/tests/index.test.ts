import { describe, expect, it, vi } from 'vitest';
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
    // Set required env vars for dry-run upload preview
    process.env.S3_BUCKET = 'test-bucket';
    process.env.AWS_REGION = 'us-east-1';
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
    expect(result.audio?.url).toMatch(/^https:\/\/test-bucket\.s3\.amazonaws\.com\/audio\/assignments\/.*\.mp3$/);
  }, 30000);
});
