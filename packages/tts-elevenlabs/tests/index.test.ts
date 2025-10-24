import { describe, expect, it, vi } from 'vitest';
import { hashStudyText, buildStudyTextMp3 } from '../src/index.js';
import * as ffm from '../src/ffmpeg.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('tts elevenlabs stubs', () => {
  it('hashes study text deterministically', () => {
    expect(hashStudyText('hello')).toEqual(hashStudyText('hello'));
  });

  it('buildStudyTextMp3 preview mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
    // Create a temporary MD file with monologue study text
    const tempMdPath = join(dir, 'lesson.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await import('node:fs/promises').then(fs => fs.writeFile(tempMdPath, `
---
title: Test Lesson
student: Anna
level: A1
topic: greetings
input_type: monologue
---

# Warm-up

:::study-text
This is a monologue line for preview.
:::
    `.trim()));
    await import('node:fs/promises').then(fs => fs.writeFile(tempVoiceMapPath, `
default: voice_id_default
    `.trim()));

    const spy = vi.spyOn(ffm, 'concatMp3Segments').mockResolvedValue();
    const result = await buildStudyTextMp3(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      preview: true
    });
    expect(result.path.endsWith('.mp3')).toBe(true);
    expect(result.hash).toHaveLength(64);
    expect(spy).not.toHaveBeenCalled();
  });

  it('buildStudyTextMp3 creates concatenated file for dialogue', async () => {
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

    const spy = vi.spyOn(ffm, 'concatMp3Segments').mockResolvedValue();
    const result = await buildStudyTextMp3(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir
    });
    expect(result.path.endsWith('.mp3')).toBe(true);
    expect(result.hash).toHaveLength(64);
    expect(spy).toHaveBeenCalledWith(expect.any(Array), expect.stringContaining('.mp3'), true);
  });

  it('buildStudyTextMp3 handles monologue as single file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
    // Create a temporary MD file with monologue study text
    const tempMdPath = join(dir, 'lesson.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await import('node:fs/promises').then(fs => fs.writeFile(tempMdPath, `
---
title: Test Lesson
student: Anna
level: A1
topic: greetings
input_type: monologue
---

# Warm-up

:::study-text
This is a monologue line.
This is another line.
:::
    `.trim()));
    await import('node:fs/promises').then(fs => fs.writeFile(tempVoiceMapPath, `
default: voice_id_default
    `.trim()));

    const spy = vi.spyOn(ffm, 'concatMp3Segments').mockResolvedValue();
    const result = await buildStudyTextMp3(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir
    });
    expect(result.path.endsWith('.mp3')).toBe(true);
    expect(result.hash).toHaveLength(64);
    expect(spy).toHaveBeenCalledWith(expect.any(Array), expect.stringContaining('.mp3'), true);
  });

  it('buildStudyTextMp3 handles dialogue with multiple speakers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
    // Create a temporary MD file with dialogue study text
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
Mara: I'm fine, thank you.
Alex: Very well, thanks.
:::
    `.trim()));
    await import('node:fs/promises').then(fs => fs.writeFile(tempVoiceMapPath, `
Alex: voice_id_1
Mara: voice_id_2
default: voice_id_default
    `.trim()));

    const spy = vi.spyOn(ffm, 'concatMp3Segments').mockResolvedValue();
    const result = await buildStudyTextMp3(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir
    });
    expect(result.path.endsWith('.mp3')).toBe(true);
    expect(result.hash).toHaveLength(64);
    expect(spy).toHaveBeenCalledWith(expect.any(Array), expect.stringContaining('.mp3'), true);
  });

  it('buildStudyTextMp3 mocks fetch and uses preview for monologue', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array(1024))
    });
    vi.stubGlobal('fetch', mockFetch);

    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
    const tempMdPath = join(dir, 'lesson.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await import('node:fs/promises').then(fs => fs.writeFile(tempMdPath, `
---
title: Test Lesson
student: Anna
level: A1
topic: greetings
input_type: monologue
---

# Warm-up

:::study-text
This is a monologue line for preview.
:::
    `.trim()));
    await import('node:fs/promises').then(fs => fs.writeFile(tempVoiceMapPath, `
default: voice_id_default
    `.trim()));

    const result = await buildStudyTextMp3(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      preview: true
    });
    expect(result.path.endsWith('.mp3')).toBe(true);
    expect(result.hash).toHaveLength(64);
    expect(mockFetch).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('buildStudyTextMp3 mocks fetch and uses preview for dialogue', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array(1024))
    });
    vi.stubGlobal('fetch', mockFetch);

    const dir = await mkdtemp(join(tmpdir(), 'tts-'));
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
Mara: I'm fine, thank you.
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
      outPath: dir,
      preview: true
    });
    expect(result.path.endsWith('.mp3')).toBe(true);
    expect(result.hash).toHaveLength(64);
    expect(mockFetch).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});
