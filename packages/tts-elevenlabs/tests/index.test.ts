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
    // Create a temporary MD file with study text
    const tempMdPath = join(dir, 'lesson.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await import('node:fs/promises').then(fs => fs.writeFile(tempMdPath, `
---
title: Test Lesson
student: Anna
level: A1
topic: greetings
input_type: dialogue
speaker_labels: ["Alex", "Mara"]
---

# Warm-up

:::study-text
Alex: Hello, how are you?
Mara: I'm fine, thank you. And you?
Alex: Very well, thanks.
:::
    `.trim()));
    await import('node:fs/promises').then(fs => fs.writeFile(tempVoiceMapPath, `
Alex: voice_id_1
Mara: voice_id_2
default: voice_id_default
    `.trim()));

    const result = await buildStudyTextMp3(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir
    });
    expect(result.path.endsWith('.mp3')).toBe(true);
    expect(result.hash).toHaveLength(64);
  });
});
