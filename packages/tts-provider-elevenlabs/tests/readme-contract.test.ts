import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('README contract smoke', () => {
  it('documents adapter registration and no standalone CLI surface', async () => {
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    const packageJsonRaw = await readFile(new URL('../package.json', import.meta.url), 'utf8');
    const packageJson = JSON.parse(packageJsonRaw) as {
      bin?: Record<string, string>;
    };

    const bins = Object.keys(packageJson.bin ?? {});
    expect(bins).toHaveLength(0);
    expect(readme).toContain('@esl-pipeline/tts-provider-elevenlabs');
    expect(readme).toContain('No standalone CLI surface');
    expect(readme).toContain('createElevenLabsTtsProvider');
  });
});
