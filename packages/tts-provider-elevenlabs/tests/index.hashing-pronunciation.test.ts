import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { hashStudyText } from '../src/index.js';
import {
  buildPronunciationShadowSentenceMp3FromPath,
  createTempDir,
  setupClientMock,
  setupTtsTestSuite,
  writeFixture,
} from './index.test-harness.js';

setupTtsTestSuite();

describe('tts elevenlabs integration', () => {
  it('hashes study text deterministically', () => {
    expect(hashStudyText('hello')).toEqual(hashStudyText('hello'));
  });

  it('buildPronunciationShadowSentenceMp3 preview mode', async () => {
    const dir = await createTempDir('tts-shadow-');
    const tempMdPath = join(dir, 'lesson-shadow.md');
    await writeFixture(
      tempMdPath,
      `
---
title: Pronunciation Lesson
student: Anna
input_type: generate
---

:::study-text
Narrator: Main text.
:::

### C. 🎙️ Pronunciation Micro-Focus (≈1 min)
:::callout 🗣️
**Mode:** shadow_sentence
**Shadow sentence:** I was thinking about working this morning.
1. thinking — /ˈθɪŋkɪŋ/
2. working — /ˈwɜːrkɪŋ/
3. morning — /ˈmɔːrnɪŋ/
:::
    `,
    );

    const convertMock = setupClientMock();
    const result = await buildPronunciationShadowSentenceMp3FromPath(tempMdPath, 'voice_narrator', {
      outPath: dir,
      preview: true,
    });
    expect(result.path.endsWith('-shadow-sentence.mp3')).toBe(true);
    expect(result.hash).toHaveLength(64);
    expect(result.generatedCharacters).toBeGreaterThan(0);
    expect(convertMock).not.toHaveBeenCalled();
  });

  it('buildPronunciationShadowSentenceMp3 generates and caches output', async () => {
    const dir = await createTempDir('tts-shadow-cache-');
    const tempMdPath = join(dir, 'lesson-shadow-cache.md');
    await writeFixture(
      tempMdPath,
      `
---
title: Pronunciation Lesson
student: Anna
input_type: generate
---

:::study-text
Narrator: Main text.
:::

### C. 🎙️ Pronunciation Micro-Focus (≈1 min)
:::callout 🗣️
**Mode:** shadow_sentence
**Shadow sentence:** I was thinking about working this morning.
1. thinking — /ˈθɪŋkɪŋ/
2. working — /ˈwɜːrkɪŋ/
3. morning — /ˈmɔːrnɪŋ/
:::
    `,
    );
    const convertMock = setupClientMock();

    const first = await buildPronunciationShadowSentenceMp3FromPath(tempMdPath, 'voice_narrator', {
      outPath: dir,
    });
    expect(first.generatedCharacters).toBeGreaterThan(0);
    expect(first.cachedCharacters).toBe(0);
    expect(convertMock).toHaveBeenCalledTimes(1);

    const second = await buildPronunciationShadowSentenceMp3FromPath(tempMdPath, 'voice_narrator', {
      outPath: dir,
    });
    expect(second.generatedCharacters).toBe(0);
    expect(second.cachedCharacters).toBeGreaterThan(0);
    expect(convertMock).toHaveBeenCalledTimes(1);
  });
});
