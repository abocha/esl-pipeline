import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { buildStudyTextMp3 } from '../src/index.js';
import * as ffm from '../src/ffmpeg.js';
import * as eleven from '../src/eleven.js';
import * as assign from '../src/assign.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const encoder = new TextEncoder();

const makeMockStream = (payload: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });

const writeFixture = async (filePath: string, contents: string) => {
  await writeFile(filePath, contents.trim());
};

const catalogMock = {
  voices: [
    {
      id: 'voice_narrator',
      name: 'NarratorVoice',
      category: 'premade',
      labels: {
        gender: 'female',
        use_case: 'narration',
        accent: 'american',
        age: 'adult',
        descriptive: 'professional',
      },
    },
    {
      id: 'voice_student_female',
      name: 'ChloeVoice',
      category: 'premade',
      labels: {
        gender: 'female',
        use_case: 'conversational',
        accent: 'british',
        age: 'young',
        descriptive: 'social',
      },
    },
  ],
};

const setupClientMock = () => {
  const convertMock = vi.fn(async (_voiceId: string, request: any) =>
    makeMockStream(request?.text ?? 'audio')
  );
  vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
    textToSpeech: { convert: convertMock },
  } as any);
  return convertMock;
};

const mockConcat = () =>
  vi.spyOn(ffm, 'concatMp3Segments').mockImplementation(async (_segments, outFile) => {
    await writeFile(outFile, 'mock-audio');
  });

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(assign, 'loadVoicesCatalog').mockResolvedValue(catalogMock as any);
  vi.spyOn(ffm, 'resolveFfmpegPath').mockResolvedValue('ffmpeg');
  vi.spyOn(ffm, 'synthSilenceMp3').mockImplementation(async (outFile: string) => {
    await writeFile(outFile, 'silence');
  });
  vi.spyOn(ffm, 'setMp3TitleMetadata').mockResolvedValue();
  // Mock console.log to suppress TTS mode selection messages
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('backward compatibility', () => {
  describe('default behavior unchanged', () => {
    it('should work with original function signature without new parameters', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');
      
      await writeFixture(
        tempMdPath,
        `
---
title: Test Lesson
student: Anna
level: A1
topic: greetings
input_type: monologue
speaker_labels: [Narrator]
speaker_profiles:
  - id: Narrator
    role: narrator
    gender: female
---

# Warm-up

:::study-text
This is a monologue line.
:::
        `
      );
      
      await writeFixture(
        tempVoiceMapPath,
        `
default: voice_id_default
        `
      );

      const convertMock = setupClientMock();
      mockConcat();
      
      // Call with original signature only
      const result = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
      });
      
      expect(result.path.endsWith('.mp3')).toBe(true);
      expect(result.hash).toHaveLength(64);
      expect(convertMock).toHaveBeenCalledTimes(1);
      expect(result.voices).toHaveLength(1);
      expect(result.voices[0]).toMatchObject({
        speaker: 'Narrator',
        voiceId: 'voice_id_default',
        source: 'default',
      });
    });

    it('should default to monologue mode for monologue content when no mode specified', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');
      
      await writeFixture(
        tempMdPath,
        `
---
title: Test Lesson
student: Anna
input_type: monologue
speaker_labels: [Narrator]
speaker_profiles:
  - id: Narrator
    role: narrator
    gender: female
---

# Warm-up

:::study-text
This is a single monologue line.
:::
        `
      );
      
      await writeFixture(
        tempVoiceMapPath,
        `
default: voice_id_default
        `
      );

      const convertMock = setupClientMock();
      mockConcat();
      
      // Should default to monologue for monologue content
      const result = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
      });
      
      // Should use monologue mode (single TTS call)
      expect(convertMock).toHaveBeenCalledTimes(1);
      expect(result.path).toMatch(/\.mp3$/);
    });

    it('should use existing preview mode without changes', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');
      
      await writeFixture(
        tempMdPath,
        `
---
title: Preview Test
student: Anna
speaker_labels: [Narrator]
speaker_profiles:
  - id: Narrator
    role: narrator
    gender: female
---

# Warm-up

:::study-text
This line should not be synthesized in preview mode.
:::
        `
      );
      
      await writeFixture(
        tempVoiceMapPath,
        `
default: voice_id_default
        `
      );

      const convertMock = setupClientMock();
      
      // Original preview behavior should be unchanged
      const result = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        preview: true, // Original preview flag
      });
      
      expect(result.path).toMatch(/\.mp3$/);
      expect(result.voices).toHaveLength(1);
      expect(convertMock).not.toHaveBeenCalled(); // Preview should not synthesize
    });
  });

  describe('API signature compatibility', () => {
    it('should accept original BuildStudyTextOptions without new fields', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');
      
      await writeFixture(
        tempMdPath,
        `
---
title: API Test
student: Test
speaker_labels: [Narrator]
speaker_profiles:
  - id: Narrator
    role: narrator
---

:::study-text
Test line.
:::
        `
      );
      
      await writeFixture(
        tempVoiceMapPath,
        `
default: voice_id_default
        `
      );

      const convertMock = setupClientMock();
      mockConcat();
      
      // Call with original interface structure only
      const result = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        preview: false,
        force: false,
        defaultAccent: 'american',
        ffmpegPath: '/usr/bin/ffmpeg',
        outputFormat: 'mp3_22050_32',
      });
      
      expect(result.path).toBeDefined();
      expect(result.hash).toBeDefined();
      expect(result.voices).toBeDefined();
      expect(result.voices[0]).toMatchObject({
        speaker: 'Narrator',
        voiceId: 'voice_id_default',
        source: 'default',
      });
    });

    it('should return same result structure as original implementation', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');
      
      await writeFixture(
        tempMdPath,
        `
---
title: Structure Test
student: Anna
speaker_labels: [Narrator]
speaker_profiles:
  - id: Narrator
    role: narrator
---

:::study-text
Test line for structure verification.
:::
        `
      );
      
      await writeFixture(
        tempVoiceMapPath,
        `
default: voice_id_default
        `
      );

      const convertMock = setupClientMock();
      mockConcat();
      
      const result = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
      });
      
      // Verify original result structure
      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('voices');
      expect(result).toHaveProperty('duration');
      expect(typeof result.path).toBe('string');
      expect(typeof result.hash).toBe('string');
      expect(typeof result.duration).toBe('number');
      expect(Array.isArray(result.voices)).toBe(true);
      expect(result.voices[0]).toHaveProperty('speaker');
      expect(result.voices[0]).toHaveProperty('voiceId');
      expect(result.voices[0]).toHaveProperty('source');
    });

    it('should maintain original error behavior for missing voice mapping', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');
      
      await writeFixture(
        tempMdPath,
        `
---
title: Error Test
student: Test
speaker_labels: [Alex]
speaker_profiles:
  - id: Alex
    role: student
---

:::study-text
Alex: This should cause an error since Alex is not mapped.
:::
        `
      );
      
      // Voice map with no Alex mapping - but this now has better fallback behavior
      await writeFixture(
        tempVoiceMapPath,
        `
# No Alex mapping, only default
default: voice_id_default
        `
      );

      const convertMock = setupClientMock();
      mockConcat();
      
      // With improved fallback, this should now work (using default voice for unmapped speakers)
      // But we test that it still handles missing voices gracefully
      const result = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
      });
      
      expect(result.path).toBeDefined();
      expect(result.voices).toHaveLength(1);
      expect(result.voices[0]).toMatchObject({
        speaker: 'Alex',
        voiceId: 'voice_id_default', // Should fall back to default
        source: 'default',
      });
      
      // TTS should still be called since we have a valid voice assignment now
      expect(convertMock).toHaveBeenCalled();
    });
  });

  describe('voice mapping system compatibility', () => {
    it('should work with existing voice.yml configurations', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');
      
      await writeFixture(
        tempMdPath,
        `
---
title: Voice Map Test
student: Anna
speaker_labels: ["Alex", "Mara"]
speaker_profiles:
  - id: Alex
    role: student
    gender: male
  - id: Mara
    role: student
    gender: female
---

:::study-text
Alex: Hello there!
Mara: Hi Alex!
:::
        `
      );
      
      // Use existing voice mapping format
      await writeFixture(
        tempVoiceMapPath,
        `
Alex: voice_id_alex
Mara: voice_id_mara
default: voice_id_default
        `
      );

      const convertMock = setupClientMock();
      mockConcat();
      
      const result = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsMode: 'monologue', // Force monologue to test original behavior
      });
      
      expect(result.voices).toHaveLength(2);
      expect(result.voices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ speaker: 'Alex', voiceId: 'voice_id_alex', source: 'voiceMap' }),
          expect.objectContaining({ speaker: 'Mara', voiceId: 'voice_id_mara', source: 'voiceMap' }),
        ])
      );
      expect(convertMock).toHaveBeenCalledTimes(2);
    });

    it('should work with auto voice detection', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');
      
      await writeFixture(
        tempMdPath,
        `
---
title: Auto Voice Test
student: Test
speaker_labels: ["Narrator", "Student"]
speaker_profiles:
  - id: Narrator
    role: narrator
    gender: female
    style: professional
  - id: Student
    role: student
    gender: male
---

:::study-text
Narrator: Welcome to the lesson.
Student: I'm ready to learn.
:::
        `
      );
      
      // Use auto detection format (existing)
      await writeFixture(
        tempVoiceMapPath,
        `
auto: true
        `
      );

      const convertMock = setupClientMock();
      mockConcat();
      
      const result = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsMode: 'monologue', // Force monologue to test original behavior
      });
      
      expect(result.voices).toHaveLength(2);
      expect(result.voices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ speaker: 'Narrator', voiceId: 'voice_narrator', source: 'auto' }),
          expect.objectContaining({ speaker: 'Student', voiceId: 'voice_student_female', source: 'auto' }),
        ])
      );
    });

    it('should maintain speaker detection behavior', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'letter.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');
      
      await writeFixture(
        tempMdPath,
        `
---
title: Speaker Detection Test
student: Alex
speaker_labels: [Alex]
speaker_profiles:
  - id: Alex
    role: student
---

:::study-text
Alex: Hey there,

I wanted to share some thoughts.

This should all be attributed to Alex.

Talk soon,
Alex
:::
        `
      );
      
      await writeFixture(
        tempVoiceMapPath,
        `
Alex: voice_id_alex
default: voice_id_default
        `
      );

      const result = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        preview: true,
      });

      // Should maintain original continuation line attribution
      expect(result.voices).toHaveLength(1);
      expect(result.voices[0]).toMatchObject({
        speaker: 'Alex',
        voiceId: 'voice_id_alex',
        source: 'voiceMap',
      });
    });
  });

  describe('environment variable compatibility', () => {
    it('should work without new environment variables', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');
      
      await writeFixture(
        tempMdPath,
        `
---
title: Env Test
student: Test
speaker_labels: [Narrator]
speaker_profiles:
  - id: Narrator
    role: narrator
---

:::study-text
Test line.
:::
        `
      );
      
      await writeFixture(
        tempVoiceMapPath,
        `
default: voice_id_default
        `
      );

      const convertMock = setupClientMock();
      mockConcat();
      
      // Clear any new environment variables that might be set
      delete process.env.ELEVENLABS_TTS_MODE;
      
      const result = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
      });
      
      expect(result.path).toBeDefined();
      expect(convertMock).toHaveBeenCalled();
    });

    it('should handle environment variables gracefully when not set', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');
      
      await writeFixture(
        tempMdPath,
        `
---
title: Graceful Test
student: Test
speaker_labels: [Narrator]
speaker_profiles:
  - id: Narrator
    role: narrator
---

:::study-text
Test line for graceful handling.
:::
        `
      );
      
      await writeFixture(
        tempVoiceMapPath,
        `
default: voice_id_default
        `
      );

      const convertMock = setupClientMock();
      mockConcat();
      
      // Ensure environment variables that didn't exist before are not set
      const originalEnv = { ...process.env };
      delete process.env.ELEVENLABS_TTS_MODE;
      delete process.env.ELEVENLABS_DIALOGUE_LANGUAGE;
      delete process.env.ELEVENLABS_DIALOGUE_STABILITY;
      delete process.env.ELEVENLABS_DIALOGUE_SEED;
      
      try {
        const result = await buildStudyTextMp3(tempMdPath, {
          voiceMapPath: tempVoiceMapPath,
          outPath: dir,
        });
        
        expect(result.path).toBeDefined();
        expect(convertMock).toHaveBeenCalled();
      } finally {
        // Restore environment
        process.env = originalEnv;
      }
    });
  });

  describe('fixture file compatibility', () => {
    it('should process existing test fixtures without changes', async () => {
      // Test with a fixture similar to existing ones
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'fixture.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');
      
      // Use a format similar to existing fixtures
      await writeFixture(
        tempMdPath,
        `
# Test Lesson

:::study-text
This is a test lesson with basic content.
:::
        `
      );
      
      await writeFixture(
        tempVoiceMapPath,
        `
default: voice_id_default
        `
      );

      const convertMock = setupClientMock();
      mockConcat();
      
      const result = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
      });
      
      expect(result.path).toMatch(/\.mp3$/);
      expect(result.hash).toHaveLength(64);
      expect(convertMock).toHaveBeenCalled();
    });
  });
});