import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { pickVoiceForSpeaker } from '../src/assign.js';
import * as assign from '../src/assign.js';
import { buildStudyTextMp3 } from '../src/index.js';
import { resolveSpeakerVoices } from '../src/speakerAssignment.js';

describe('tts elevenlabs gender-aware voice selection', () => {
  it('male -> prefers male even when neutral would score higher', async () => {
    const catalog = {
      voices: [
        { id: 'neutral_1', name: 'Neutral', labels: { gender: 'neutral', accent: 'american' } },
        { id: 'male_1', name: 'Male', labels: { gender: 'male', accent: 'british' } },
      ],
    };

    const picked = await pickVoiceForSpeaker(
      'Mark',
      { gender: 'male', role: 'student', accent: 'american' },
      { catalog: catalog as any },
    );

    expect(picked?.id).toBe('male_1');
  });

  it('male -> falls back to neutral when no male voice exists (never female if avoidable)', async () => {
    const catalog = {
      voices: [
        { id: 'female_1', name: 'Female', labels: { gender: 'female', accent: 'american' } },
        { id: 'neutral_1', name: 'Neutral', labels: { gender: 'neutral', accent: 'american' } },
      ],
    };

    const picked = await pickVoiceForSpeaker(
      'Mark',
      { gender: 'male', role: 'student', accent: 'american' },
      { catalog: catalog as any },
    );

    expect(picked?.id).toBe('neutral_1');
  });

  it('neutral -> prefers neutral, but falls back to any gender if no neutral exists', async () => {
    const catalogWithNeutral = {
      voices: [
        { id: 'male_1', name: 'Male', labels: { gender: 'male', use_case: 'narration' } },
        { id: 'neutral_1', name: 'Neutral', labels: { gender: 'neutral', use_case: 'social' } },
      ],
    };

    const pickedNeutral = await pickVoiceForSpeaker(
      'Alex',
      { gender: 'neutral', role: 'narrator' },
      { catalog: catalogWithNeutral as any },
    );
    expect(pickedNeutral?.id).toBe('neutral_1');

    const catalogWithoutNeutral = {
      voices: [{ id: 'male_1', name: 'Male', labels: { gender: 'male', use_case: 'narration' } }],
    };

    const pickedAny = await pickVoiceForSpeaker(
      'Alex',
      { gender: 'neutral', role: 'narrator' },
      { catalog: catalogWithoutNeutral as any },
    );
    expect(pickedAny?.id).toBe('male_1');
  });

  it('maps dialogue-role aliases to canonical scoring hints', async () => {
    const catalog = {
      voices: [
        { id: 'voice_social', name: 'Social', labels: { gender: 'female', use_case: 'social' } },
        { id: 'voice_formal', name: 'Formal', labels: { gender: 'female', use_case: 'news' } },
      ],
    };

    const picked = await pickVoiceForSpeaker(
      'Front Desk',
      { gender: 'female', role: 'receptionist' as any },
      { catalog: catalog as any },
    );

    expect(picked?.id).toBe('voice_formal');
  });

  it('treats unknown explicit role as zero role score (no mode fallback role bias)', async () => {
    const assignments = await resolveSpeakerVoices({
      speakers: ['Ava'],
      profiles: [
        {
          id: 'Ava',
          role: 'alien ambassador' as any,
          style: 'professional',
        },
      ],
      voiceMap: { auto: true },
      catalog: {
        voices: [
          { id: 'voice_social', name: 'Social', labels: { use_case: 'social', descriptive: 'casual' } },
          {
            id: 'voice_formal',
            name: 'Formal',
            labels: { use_case: 'news', descriptive: 'professional' },
          },
        ],
      } as any,
      mode: 'dialogue',
    });

    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.voiceId).toBe('voice_formal');
    expect(assignments[0]?.source).toBe('auto');
  });

  it('cleans markdown speaker formatting so profile gender applies (e.g. \"**Mark:**\")', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-gender-'));
    const tempMdPath = join(dir, 'lesson.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');

    await writeFile(
      tempMdPath,
      `
---
title: Speaker Formatting
student: Anna
level: A1
topic: greetings
input_type: dialogue
speaker_labels: [Mark]
speaker_profiles:
  - id: Mark
    role: student
    gender: male
---

:::study-text
**Mark:** Hello!
:::
      `.trim(),
    );

    await writeFile(
      tempVoiceMapPath,
      `
auto: true
      `.trim(),
    );

    const catalogMock = {
      voices: [
        { id: 'voice_student_neutral', name: 'River', labels: { gender: 'neutral' } },
        { id: 'voice_student_male', name: 'George', labels: { gender: 'male' } },
      ],
    };

    vi.spyOn(assign, 'loadVoicesCatalog').mockResolvedValue(catalogMock as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await buildStudyTextMp3(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      preview: true,
      ttsStrategy: 'tts',
    });

    expect(result.voices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          speaker: 'Mark',
          voiceId: 'voice_student_male',
          source: 'auto',
        }),
      ]),
    );
  });

  it('applies profile gender when study-text uses speaker display_name (id != display_name)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-gender-display-name-'));
    const tempMdPath = join(dir, 'lesson.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');

    await writeFile(
      tempMdPath,
      `
---
title: Speaker Display Name
student: Tolik
level: A1
topic: greetings
input_type: dialogue
speaker_labels: [Narrator]
speaker_profiles:
  - id: Narrator
    display_name: Tolik
    role: student
    gender: male
---

:::study-text
Tolik: Hello!
:::
      `.trim(),
    );

    await writeFile(
      tempVoiceMapPath,
      `
auto: true
      `.trim(),
    );

    const catalogMock = {
      voices: [
        { id: 'voice_student_neutral', name: 'River', labels: { gender: 'neutral' } },
        { id: 'voice_student_male', name: 'George', labels: { gender: 'male' } },
      ],
    };

    vi.spyOn(assign, 'loadVoicesCatalog').mockResolvedValue(catalogMock as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await buildStudyTextMp3(tempMdPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      preview: true,
      ttsStrategy: 'tts',
    });

    expect(result.voices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          speaker: 'Tolik',
          voiceId: 'voice_student_male',
          source: 'auto',
        }),
      ]),
    );
  });
});
