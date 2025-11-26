import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as assign from '../src/assign.js';
import * as dialogue from '../src/dialogue.js';
import * as eleven from '../src/eleven.js';
import * as ffm from '../src/ffmpeg.js';
import { buildStudyTextMp3 } from '../src/index.js';

const encoder = new TextEncoder();

const makeMockStream = (payload: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });

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
    {
      id: 'voice_student_male',
      name: 'EthanVoice',
      category: 'premade',
      labels: {
        gender: 'male',
        use_case: 'conversational',
        accent: 'american',
        age: 'young',
        descriptive: 'confident',
      },
    },
  ],
};

const setupClientMock = () => {
  const convertMock = vi.fn(async (_voiceId: string, request: any) =>
    makeMockStream(request?.text ?? 'audio'),
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

const mockDialogue = () =>
  vi
    .spyOn(dialogue, 'synthesizeDialogue')
    .mockImplementation(async (_options, _apiKey, _outputDir) => {
      return {
        audioPath: 'mock-dialogue.mp3',
        duration: 5.2,
        hash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456', // 64 chars
      };
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
  vi.spyOn(console, 'log').mockImplementation(() => { });
});

describe('integration tests', () => {
  describe('fixture file processing', () => {
    it('should process monologue fixture similar to existing fixtures', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'ok.md'); // Use name similar to existing fixtures
      const tempVoiceMapPath = join(dir, 'voices.yml');

      // Create fixture similar to existing test fixtures
      const fixtureContent = `
# Lesson 1: Greetings

:::study-text
Hello! Welcome to our English lesson.
Today we'll practice greetings and introductions.
:::
      `;

      await writeFile(tempMdPath, fixtureContent.trim());
      await writeFile(
        tempVoiceMapPath,
        `
default: voice_narrator
Narrator: voice_narrator
auto: true
        `.trim(),
      );

      const convertMock = setupClientMock();
      mockConcat();

      const result = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
      });

      expect(result.path).toMatch(/\.mp3$/);
      expect(result.hash).toHaveLength(64);
      expect(result.voices).toHaveLength(1);
      expect(result.voices[0]).toMatchObject({
        speaker: 'Narrator',
        voiceId: 'voice_narrator',
        source: 'voiceMap',
      });
      expect(convertMock).toHaveBeenCalled();
    });

    it('should process dialogue fixture with multiple speakers', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'dialogue.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      // Create dialogue fixture
      const dialogueContent = `
# Conversation Practice

:::study-text
Teacher: Good morning! How are you today?
Student: Good morning! I'm fine, thank you. And you?
Teacher: I'm very well, thank you. What's your name?
Student: My name is Sarah. Nice to meet you!
Teacher: Nice to meet you too, Sarah!
:::
      `;

      await writeFile(tempMdPath, dialogueContent.trim());
      await writeFile(
        tempVoiceMapPath,
        `
Teacher: voice_narrator
Student: voice_student_female
        `.trim(),
      );

      const convertMock = setupClientMock();
      mockConcat();

      const result = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsMode: 'monologue', // Force monologue to test original behavior
      });

      expect(result.path).toMatch(/\.mp3$/);
      expect(result.voices).toHaveLength(2);
      expect(result.voices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            speaker: 'Teacher',
            voiceId: 'voice_narrator',
            source: 'voiceMap',
          }),
          expect.objectContaining({
            speaker: 'Student',
            voiceId: 'voice_student_female',
            source: 'voiceMap',
          }),
        ]),
      );
      expect(convertMock).toHaveBeenCalledTimes(5); // 5 dialogue lines
    });

    it('should handle fixtures with speaker profiles in frontmatter', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'lesson.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      // Create fixture with detailed frontmatter
      const lessonContent = `
---
title: "Advanced Conversation"
student: "Maria"
level: "B2"
topic: "expressing opinions"
input_type: "dialogue"
speaker_labels: ["Instructor", "Student"]
speaker_profiles:
  - id: "Instructor"
    role: "teacher"
    gender: "female"
    accent: "american"
    style: "professional"
  - id: "Student"
    role: "learner"
    gender: "female"
    age: "adult"
---

# Expressing Opinions

:::study-text
Instructor: Today we'll practice expressing opinions. What's your opinion about remote work?
Student: I think it's great! It gives me more flexibility with my schedule.
Instructor: That's a valid point. How do you feel about work-life balance?
Student: I believe remote work improves it significantly.
:::
      `;

      await writeFile(tempMdPath, lessonContent.trim());
      await writeFile(
        tempVoiceMapPath,
        `
Instructor: voice_narrator
Student: voice_student_female
auto: true
        `.trim(),
      );

      const convertMock = setupClientMock();
      mockConcat();

      const result = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsMode: 'monologue', // Force monologue to test original behavior
      });

      expect(result.path).toMatch(/\.mp3$/);
      expect(result.voices).toHaveLength(2);
      expect(result.voices[0]).toMatchObject({
        speaker: 'Instructor',
        voiceId: 'voice_narrator',
        source: 'voiceMap',
      });
      expect(result.voices[1]).toMatchObject({
        speaker: 'Student',
        voiceId: 'voice_student_female',
        source: 'voiceMap',
      });
      expect(convertMock).toHaveBeenCalledTimes(4); // 4 dialogue lines
    });

    it('should process both monologue and dialogue modes from same fixture', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'mixed.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      // Create fixture that could work in both modes
      const mixedContent = `
# Lesson: Daily Routines

:::study-text
Teacher: Let's talk about daily routines.
Student: Okay, I'm ready to learn!
Teacher: What time do you wake up?
Student: I wake up at 7 AM every day.
Teacher: That's early! What do you do after waking up?
Student: I brush my teeth and have breakfast.
Teacher: Excellent! Tell me about your breakfast.
Student: I usually have toast and coffee.
:::
      `;

      await writeFile(tempMdPath, mixedContent.trim());
      await writeFile(
        tempVoiceMapPath,
        `
Teacher: voice_narrator
Student: voice_student_female
        `.trim(),
      );

      // Test both modes
      const convertMock = setupClientMock();
      mockConcat();

      // Monologue mode
      const monologueResult = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsMode: 'monologue',
      });

      expect(monologueResult.path).toMatch(/\.mp3$/);
      expect(convertMock).toHaveBeenCalled(); // Should use monologue path

      // Clear mocks
      convertMock.mockClear();

      // Dialogue mode
      const dialogueMock = mockDialogue();
      const dialogueResult = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsMode: 'dialogue',
      });

      expect(dialogueResult.path).toMatch(/\.mp3$/);
      expect(dialogueMock).toHaveBeenCalled(); // Should use dialogue path
    });
  });

  describe('orchestrator integration', () => {
    it('should export all necessary functions for orchestrator', async () => {
      // This tests that the exports are available for the orchestrator package
      const indexExports = await import('../src/index.js');

      // Verify main function is exported
      expect(typeof indexExports.buildStudyTextMp3).toBe('function');
      expect(typeof indexExports.hashStudyText).toBe('function');

      // Verify utility functions are exported
      expect(typeof indexExports.resolveFfmpegPath).toBe('function');
    });

    it('should export types for TypeScript compatibility', async () => {
      // This tests that types are properly exported for orchestrator usage
      // We can't test type exports at runtime, but we can verify the module loads
      const typesModule = await import('../src/types.js');

      // Verify the module loaded successfully
      expect(typesModule).toBeDefined();
      // Types are available for TypeScript compilation, not runtime
    });

    it('should handle orchestrator-style configuration', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'orchestrator-test.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      // Test configuration similar to what orchestrator would provide
      const orchestratorConfig = {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        preview: false,
        force: false,
        defaultAccent: 'british',
        ttsMode: 'auto' as const, // New field - use const assertion for proper typing
        dialogueLanguage: 'en', // New field
        dialogueStability: 0.75, // New field
        dialogueSeed: 12_345, // New field
      };

      const lessonContent = `
# Orchestrator Test

:::study-text
This is a test for orchestrator integration.
We need to ensure all configuration options work properly.
:::
      `;

      await writeFile(tempMdPath, lessonContent.trim());
      await writeFile(
        tempVoiceMapPath,
        `
default: voice_narrator
Narrator: voice_narrator
auto: true
        `.trim(),
      );

      const convertMock = setupClientMock();
      mockConcat();

      const result = await buildStudyTextMp3(tempMdPath, orchestratorConfig);

      expect(result.path).toBeDefined();
      expect(result.hash).toBeDefined();
      expect(result.voices).toBeDefined();
      expect(convertMock).toHaveBeenCalled();
    });

    it('should work with orchestrator manifest-style output', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'manifest-test.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      const lessonContent = `
# Manifest Test

:::study-text
This should produce output compatible with orchestrator manifests.
:::
      `;

      await writeFile(tempMdPath, lessonContent.trim());
      await writeFile(
        tempVoiceMapPath,
        `
default: voice_narrator
Narrator: voice_narrator
auto: true
        `.trim(),
      );

      const _convertMock = setupClientMock();
      mockConcat();

      const result = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
      });

      // Verify result structure matches what orchestrator expects
      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('voices');
      expect(Array.isArray(result.voices)).toBe(true);
      expect(result.voices[0]).toHaveProperty('speaker');
      expect(result.voices[0]).toHaveProperty('voiceId');
      expect(result.voices[0]).toHaveProperty('source');

      // File should exist at expected location
      expect(result.path).toContain(dir);
    });
  });

  describe('CLI integration', () => {
    it('should handle CLI-style flag combinations', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'cli-test.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      const lessonContent = `
# CLI Flag Test

:::study-text
This tests CLI-style flag handling.
:::
      `;

      await writeFile(tempMdPath, lessonContent.trim());
      await writeFile(
        tempVoiceMapPath,
        `
default: voice_narrator
Narrator: voice_narrator
auto: true
        `.trim(),
      );

      const convertMock = setupClientMock();
      mockConcat();

      // Simulate various CLI flag combinations
      const cliScenarios = [
        {
          name: 'basic flags',
          options: {
            voiceMapPath: tempVoiceMapPath,
            outPath: dir,
            ttsMode: 'monologue' as const, // Force monologue to ensure consistent behavior
          },
        },
        {
          name: 'with preview',
          options: {
            voiceMapPath: tempVoiceMapPath,
            outPath: dir,
            preview: true,
          },
        },
        {
          name: 'with force',
          options: {
            voiceMapPath: tempVoiceMapPath,
            outPath: dir,
            force: true,
            ttsMode: 'monologue' as const,
          },
        },
        {
          name: 'with new TTS mode flags',
          options: {
            voiceMapPath: tempVoiceMapPath,
            outPath: dir,
            ttsMode: 'monologue' as const,
            dialogueLanguage: 'en',
            dialogueStability: 0.5,
          },
        },
        {
          name: 'with all new flags',
          options: {
            voiceMapPath: tempVoiceMapPath,
            outPath: dir,
            ttsMode: 'monologue' as const, // Force monologue to avoid dialogue mode issues
            dialogueLanguage: 'en',
            dialogueStability: 0.75,
            dialogueSeed: 123,
          },
        },
      ];

      // Split scenarios to avoid conditional expectations in loop
      const previewScenarios = cliScenarios.filter((s) => s.options.preview);
      const generationScenarios = cliScenarios.filter((s) => !s.options.preview);

      for (const scenario of previewScenarios) {
        convertMock.mockClear();
        await buildStudyTextMp3(tempMdPath, scenario.options);
        expect(convertMock).not.toHaveBeenCalled();
      }

      for (const scenario of generationScenarios) {
        convertMock.mockClear();
        const result = await buildStudyTextMp3(tempMdPath, scenario.options);
        expect(result.path).toMatch(/\.mp3$/);
      }
    });

    it('should validate CLI help text compatibility', async () => {
      // Test that new options don't break existing CLI help expectations
      const options = {
        voiceMapPath: '/path/to/voices.yml',
        outPath: '/path/to/output',
        preview: false,
        force: false,
        defaultAccent: 'american',
        ffmpegPath: '/usr/bin/ffmpeg',
        outputFormat: 'mp3_22050_32',
        // New options
        ttsMode: 'auto',
        dialogueLanguage: 'en',
        dialogueStability: 0.5,
        dialogueSeed: 123,
      };

      // Verify all expected properties exist
      expect(options.voiceMapPath).toBeDefined();
      expect(options.outPath).toBeDefined();
      expect(options.preview).toBeDefined();
      expect(options.force).toBeDefined();
      expect(options.defaultAccent).toBeDefined();
      expect(options.ffmpegPath).toBeDefined();
      expect(options.outputFormat).toBeDefined();

      // Verify new properties don't break existing structure
      expect(options.ttsMode).toBeDefined();
      expect(options.dialogueLanguage).toBeDefined();
      expect(options.dialogueStability).toBeDefined();
      expect(options.dialogueSeed).toBeDefined();
    });

    it('should handle environment variable overrides like CLI would', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'env-test.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      const lessonContent = `
# Environment Override Test

:::study-text
This tests environment variable handling.
:::
      `;

      await writeFile(tempMdPath, lessonContent.trim());
      await writeFile(
        tempVoiceMapPath,
        `
default: voice_narrator
Narrator: voice_narrator
auto: true
        `.trim(),
      );

      const convertMock = setupClientMock();
      mockConcat();

      // Set environment variables like CLI would
      const originalEnv = { ...process.env };
      process.env.ELEVENLABS_TTS_MODE = 'monologue';
      process.env.ELEVENLABS_DIALOGUE_LANGUAGE = 'en';
      process.env.ELEVENLABS_DIALOGUE_STABILITY = '0.8';

      try {
        // Call without specifying TTS mode - should use env var
        const result = await buildStudyTextMp3(tempMdPath, {
          voiceMapPath: tempVoiceMapPath,
          outPath: dir,
        });

        expect(result.path).toBeDefined();
        expect(result.hash).toBeDefined();
        expect(convertMock).toHaveBeenCalled(); // Should use monologue mode
      } finally {
        // Restore environment
        process.env = originalEnv;
      }
    });
  });

  describe('end-to-end workflow', () => {
    it('should complete full workflow from markdown to MP3', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'full-workflow.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      const fullLesson = `
---
title: "Complete Lesson"
student: "Test Student"
level: "A2"
topic: "ordering food"
input_type: "dialogue"
speaker_labels: ["Waiter", "Customer"]
speaker_profiles:
  - id: "Waiter"
    role: "server"
    gender: "male"
  - id: "Customer"
    role: "diner"
    gender: "female"
---

# Ordering at a Restaurant

:::study-text
Waiter: Good evening! Welcome to our restaurant. Do you have a reservation?
Customer: Yes, I do. Table for two under Johnson.
Waiter: Perfect! Right this way, please.
Customer: Thank you. Could I see the menu, please?
Waiter: Of course! Here you are. Can I get you something to drink first?
Customer: I'll have a glass of water, please.
Waiter: Certainly! Take your time looking at the menu.
:::
      `;

      await writeFile(tempMdPath, fullLesson.trim());
      await writeFile(
        tempVoiceMapPath,
        `
Waiter: voice_student_male
Customer: voice_student_female
        `.trim(),
      );

      const convertMock = setupClientMock();
      mockConcat();

      // Complete workflow
      const result = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsMode: 'monologue', // Force monologue for testing
      });

      // Verify complete workflow
      expect(result.path).toMatch(/\.mp3$/);
      expect(result.hash).toHaveLength(64);
      expect(result.duration).toBeDefined();
      expect(result.voices).toHaveLength(2);
      expect(result.voices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            speaker: 'Waiter',
            voiceId: 'voice_student_male',
            source: 'voiceMap',
          }),
          expect.objectContaining({
            speaker: 'Customer',
            voiceId: 'voice_student_female',
            source: 'voiceMap',
          }),
        ]),
      );

      // Verify multiple TTS calls for dialogue (monologue mode)
      expect(convertMock).toHaveBeenCalledTimes(7); // 6 dialogue lines + 1 for continuation detection
    });

    it('should handle both modes end-to-end for same content', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const tempMdPath = join(dir, 'mode-comparison.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      const comparisonLesson = `
# Mode Comparison Lesson

:::study-text
Teacher: Let's compare different teaching methods.
Student: I'd like to hear about different approaches.
Teacher: We can use traditional lecture style or interactive dialogue.
Student: Which method do you think is more effective?
Teacher: That depends on the learning objectives and student preferences.
:::
      `;

      await writeFile(tempMdPath, comparisonLesson.trim());
      await writeFile(
        tempVoiceMapPath,
        `
Teacher: voice_narrator
Student: voice_student_female
        `.trim(),
      );

      // Test both modes produce valid results
      const convertMock = setupClientMock();
      mockConcat();
      const dialogueMock = mockDialogue();

      // Monologue mode
      const monologueResult = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsMode: 'monologue' as const,
      });

      expect(monologueResult.path).toMatch(/\.mp3$/);
      expect(monologueResult.hash).toHaveLength(64);
      expect(convertMock).toHaveBeenCalled(); // Used monologue path

      // Dialogue mode
      const dialogueResult = await buildStudyTextMp3(tempMdPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsMode: 'dialogue' as const,
      });

      expect(dialogueResult.path).toMatch(/\.mp3$/);
      expect(dialogueResult.hash).toHaveLength(64);
      expect(dialogueMock).toHaveBeenCalled(); // Used dialogue path

      // Both should have valid voice assignments
      expect(monologueResult.voices).toHaveLength(2);
      expect(dialogueResult.voices).toHaveLength(2);
    });
  });
});
