import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { parseMarkdownContext } from '@esl-pipeline/pmd';

import * as assign from '../src/assign.js';
import { pickVoiceForSpeaker } from '../src/assign.js';
import { buildStudyTextMp3 } from '../src/index.js';
import { resolveSpeakerVoices } from '../src/speakerAssignment.js';

const buildStudyTextMp3FromPath = async (
  mdPath: string,
  ...args: Parameters<typeof buildStudyTextMp3> extends [any, ...infer Rest] ? Rest : never
) => {
  const markdown = await readFile(mdPath, 'utf8');
  const context = parseMarkdownContext(markdown);
  return buildStudyTextMp3({ context, mdPath }, ...args);
};

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

  it('maps dialogue-role aliases into the peer-dialogue scoring path', async () => {
    const catalog = {
      voices: [
        {
          id: 'voice_dialogue',
          name: 'Dialogue',
          labels: { gender: 'female', use_case: 'conversational', descriptive: 'casual' },
        },
        {
          id: 'voice_narrative',
          name: 'Narrative',
          labels: { gender: 'female', use_case: 'narrative_story', descriptive: 'formal' },
        },
      ],
    };

    const picked = await pickVoiceForSpeaker(
      'Front Desk',
      { gender: 'female', role: 'receptionist' as any },
      { catalog: catalog as any },
    );

    expect(picked?.id).toBe('voice_dialogue');
  });

  it('treats teacher and student dialogue roles the same for study-text voice scoring', async () => {
    const catalog = {
      voices: [
        {
          id: 'voice_dialogue',
          name: 'Dialogue',
          labels: { gender: 'female', use_case: 'conversational', descriptive: 'casual' },
        },
        {
          id: 'voice_narrative',
          name: 'Narrative',
          labels: { gender: 'female', use_case: 'narrative_story', descriptive: 'formal' },
        },
      ],
    };

    const studentPick = await pickVoiceForSpeaker(
      'Ava',
      { gender: 'female', role: 'student', style: 'social' },
      { catalog: catalog as any },
    );
    const teacherPick = await pickVoiceForSpeaker(
      'Ava',
      { gender: 'female', role: 'teacher', style: 'social' },
      { catalog: catalog as any },
    );

    expect(studentPick?.id).toBe('voice_dialogue');
    expect(teacherPick?.id).toBe('voice_dialogue');
  });

  it('maps legacy thoughtful style hints onto catalog-backed calm or mature voices', async () => {
    const catalog = {
      voices: [
        {
          id: 'voice_thoughtful',
          name: 'Thoughtful',
          labels: { gender: 'male', use_case: 'narrative_story', descriptive: 'mature' },
        },
        {
          id: 'voice_hyped',
          name: 'Hyped',
          labels: { gender: 'male', use_case: 'social_media', descriptive: 'upbeat' },
        },
      ],
    };

    const picked = await pickVoiceForSpeaker(
      'Mark',
      { gender: 'male', role: 'student', style: 'thoughtful' },
      { catalog: catalog as any },
    );

    expect(picked?.id).toBe('voice_thoughtful');
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
          {
            id: 'voice_social',
            name: 'Social',
            labels: { use_case: 'social', descriptive: 'casual' },
          },
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

    const result = await buildStudyTextMp3FromPath(tempMdPath, {
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

    const result = await buildStudyTextMp3FromPath(tempMdPath, {
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
