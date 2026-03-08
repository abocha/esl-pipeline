import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildPronunciationShadowSentenceMp3FromPath,
  buildStudyTextMp3FromPath,
  createTempDir,
  mockConcat,
  setupGoogleSynthesizeMock,
  setupTtsTestSuite,
  writeFixture,
} from './index.test-harness.js';

setupTtsTestSuite();

describe('tts google provider integration', () => {
  it('uses Google provider defaults (Chirp 3 HD) in preview mode', async () => {
    const dir = await createTempDir('tts-google-');
    const tempMdPath = join(dir, 'lesson.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      tempMdPath,
      `
---
title: Google Preview
student: Anna
input_type: monologue
speaker_labels: [Narrator]
---

:::study-text
Hello from Google TTS preview.
:::
    `,
    );
    await writeFixture(tempVoiceMapPath, `auto: true`);

    const synthMock = setupGoogleSynthesizeMock();
    const result = await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      preview: true,
      ttsProvider: 'google',
    });

    expect(result.provider).toBe('google');
    expect(result.generatedCharacters).toBe(0);
    expect(result.cachedCharacters).toBeGreaterThan(0);
    expect(result.voices[0]?.voiceId).toBe('en-US-Chirp3-HD-Charon');
    expect(synthMock).not.toHaveBeenCalled();
  });

  it('synthesizes using selected Google model family and explicit voice mapping', async () => {
    const dir = await createTempDir('tts-google-');
    const tempMdPath = join(dir, 'lesson.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      tempMdPath,
      `
---
title: Google Build
student: Anna
input_type: dialogue
speaker_labels: ["Alex", "Mara"]
---

:::study-text
Alex: Hello there.
Mara: Great to see you.
:::
    `,
    );
    await writeFixture(
      tempVoiceMapPath,
      `
Alex: en-US-Studio-O
default: en-US-Studio-Q
    `,
    );

    const synthMock = setupGoogleSynthesizeMock();
    const concatSpy = mockConcat();
    const result = await buildStudyTextMp3FromPath(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsProvider: 'google',
      googleTtsModel: 'studio',
    });

    expect(result.provider).toBe('google');
    expect(result.generatedCharacters).toBeGreaterThan(0);
    expect(result.voices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ speaker: 'Alex', voiceId: 'en-US-Studio-O' }),
        expect.objectContaining({ speaker: 'Mara', voiceId: 'en-US-Studio-Q' }),
      ]),
    );
    expect(concatSpy).toHaveBeenCalled();
    expect(synthMock).toHaveBeenCalled();
  });

  it('builds pronunciation shadow sentence audio with Google provider', async () => {
    const dir = await createTempDir('tts-google-');
    const tempMdPath = join(dir, 'lesson.md');
    await writeFixture(
      tempMdPath,
      `
---
title: Pronunciation
student: Anna
input_type: monologue
---

### C. Pronunciation Micro-Focus
- **Mode:** shadow_sentence
- **Shadow sentence:** The weather is beautiful today.
    `,
    );

    const synthMock = setupGoogleSynthesizeMock();
    const result = await buildPronunciationShadowSentenceMp3FromPath(
      tempMdPath,
      'en-US-Neural2-F',
      {
        outPath: dir,
        ttsProvider: 'google',
        googleTtsModel: 'neural2',
      },
    );

    expect(result.provider).toBe('google');
    expect(result.voiceId).toBe('en-US-Neural2-F');
    expect(synthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceName: 'en-US-Neural2-F',
        languageCode: 'en-US',
      }),
      expect.any(Object),
    );
  });
});
