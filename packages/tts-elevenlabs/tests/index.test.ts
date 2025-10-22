import { describe, expect, it } from 'vitest';
import { hashStudyText, buildStudyTextMp3 } from '../src/index.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('tts elevenlabs stubs', () => {
  it('hashes study text deterministically', () => {
    expect(hashStudyText('hello')).toEqual(hashStudyText('hello'));
  });

  it('buildStudyTextMp3 creates stub file when not previewing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
    const result = await buildStudyTextMp3('lesson.md', {
      voiceMapPath: 'voices.json',
      outPath: dir
    });
    expect(result.path.endsWith('.mp3')).toBe(true);
    expect(result.hash).toHaveLength(64);
  });
});
