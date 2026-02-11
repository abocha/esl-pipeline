import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('README contract smoke', () => {
  it('documents the current CLI commands and programmatic signature', async () => {
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    const packageJsonRaw = await readFile(new URL('../package.json', import.meta.url), 'utf8');
    const packageJson = JSON.parse(packageJsonRaw) as {
      bin?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    const bins = Object.keys(packageJson.bin ?? {});
    expect(bins).toContain('tts-elevenlabs');
    expect(bins).toContain('tts-voices');
    for (const bin of bins) {
      expect(readme).toContain(bin);
    }

    expect(packageJson.scripts?.['voices:sync']).toBe('node dist/bin/voices.js');
    expect(readme).toContain('pnpm --filter @esl-pipeline/tts-elevenlabs run voices:sync');
    expect(readme).toContain('node dist/bin/voices.js');
    expect(readme).toContain('buildStudyTextMp3(');
    expect(readme).toContain("buildStudyTextMp3('/abs/path/lesson.md', {");
  });
});
