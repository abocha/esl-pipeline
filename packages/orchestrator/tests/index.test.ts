import { describe, expect, it } from 'vitest';
import { newAssignment } from '../src/index.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('orchestrator stub', () => {
  it('produces manifest and step summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-'));
    const mdPath = join(dir, 'lesson.md');
    const result = await newAssignment({
      md: mdPath,
      preset: 'default',
      withTts: true,
      upload: 's3',
      dryRun: true
    });

    expect(result.steps).toContain('import');
    expect(result.manifestPath).toBeDefined();
    expect(result.pageId).toBeDefined();
  });
});
