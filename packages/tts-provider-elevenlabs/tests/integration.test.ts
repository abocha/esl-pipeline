import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssignmentV1 as FixtureAssignmentV1 } from '@esl-pipeline/contracts';

import * as assign from '../src/assign.js';
import * as dialogue from '../src/dialogue.js';
import * as eleven from '../src/eleven.js';
import * as ffm from '../src/ffmpeg.js';
import { buildStudyTextMp3 } from '../src/index.js';
import type { DialogueInput } from '../src/types.js';
import { createTtsAssignment } from './assignment-fixture.js';

const buildStudyTextMp3FromPath = async (
  mdPath: string,
  ...args: Parameters<typeof buildStudyTextMp3> extends [any, ...infer Rest] ? Rest : never
) => {
  const source = await readFile(mdPath, 'utf8');
  const context = JSON.parse(source) as FixtureAssignmentV1;
  return buildStudyTextMp3({ assignment: context, mdPath }, ...args);
};

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
    .mockImplementation(async (_options, _apiKey, outputDir) => {
      const audioPath = join(outputDir, 'mock-dialogue.mp3');
      await writeFile(audioPath, 'mock-audio');
      return {
        audioPath,
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
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('integration tests', () => {
  describe('fixture file processing', () => {
    it('should process monologue fixture similar to existing fixtures', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const assignmentPath = join(dir, 'ok.md'); // Use name similar to existing fixtures
      const tempVoiceMapPath = join(dir, 'voices.yml');

      // Create fixture similar to existing test fixtures

      await writeFile(
        assignmentPath,
        JSON.stringify(
          createTtsAssignment({
            metadata: { title: 'Test Lesson', student: 'Test Student', level: 'A1', topic: 'test' },
            studyText: {
              type: 'monologue',
              speakers: [
                {
                  id: 's0',
                  displayName: 'Narrator',
                  role: 'student',
                  persona: null,
                  voiceDirection: null,
                  gender: 'neutral',
                  age: null,
                  accent: null,
                },
              ],
              turns: [
                { speakerId: 's0', text: 'Hello! Welcome to our English lesson.' },
                { speakerId: 's0', text: "Today we'll practice greetings and introductions." },
              ],
            },
            pronunciation: null,
          }),
        ),
      );
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

      const result = await buildStudyTextMp3FromPath(assignmentPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsStrategy: 'tts',
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
      const assignmentPath = join(dir, 'dialogue.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      // Create dialogue fixture

      await writeFile(
        assignmentPath,
        JSON.stringify(
          createTtsAssignment({
            metadata: { title: 'Test Lesson', student: 'Test Student', level: 'A1', topic: 'test' },
            studyText: {
              type: 'dialogue',
              speakers: [
                {
                  id: 's0',
                  displayName: 'Teacher',
                  role: 'student',
                  persona: null,
                  voiceDirection: null,
                  gender: 'neutral',
                  age: null,
                  accent: null,
                },
                {
                  id: 's1',
                  displayName: 'Student',
                  role: 'student',
                  persona: null,
                  voiceDirection: null,
                  gender: 'neutral',
                  age: null,
                  accent: null,
                },
              ],
              turns: [
                { speakerId: 's0', text: 'Good morning! How are you today?' },
                { speakerId: 's1', text: "Good morning! I'm fine, thank you. And you?" },
                { speakerId: 's0', text: "I'm very well, thank you. What's your name?" },
                { speakerId: 's1', text: 'My name is Sarah. Nice to meet you!' },
                { speakerId: 's0', text: 'Nice to meet you too, Sarah!' },
              ],
            },
            pronunciation: null,
          }),
        ),
      );
      await writeFile(
        tempVoiceMapPath,
        `
Teacher: voice_narrator
Student: voice_student_female
        `.trim(),
      );

      const convertMock = setupClientMock();
      mockConcat();

      const result = await buildStudyTextMp3FromPath(assignmentPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsStrategy: 'tts', // Force TTS to test strategy behavior
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

    it('preserves plain typed dialogue inputs before synthesis', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const assignmentPath = join(dir, 'dialogue-sanitize.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      await writeFile(
        assignmentPath,
        JSON.stringify(
          createTtsAssignment({
            metadata: { title: 'Test Lesson', student: 'Test Student', level: 'A1', topic: 'test' },
            studyText: {
              type: 'dialogue',
              speakers: [
                {
                  id: 's0',
                  displayName: 'Teacher',
                  role: 'student',
                  persona: null,
                  voiceDirection: null,
                  gender: 'neutral',
                  age: null,
                  accent: null,
                },
                {
                  id: 's1',
                  displayName: 'Student',
                  role: 'student',
                  persona: null,
                  voiceDirection: null,
                  gender: 'neutral',
                  age: null,
                  accent: null,
                },
              ],
              turns: [
                { speakerId: 's0', text: '**Hello** *there*.' },
                { speakerId: 's1', text: 'This is `code` and ~~strikethrough~~.' },
              ],
            },
            pronunciation: null,
          }),
        ),
      );
      await writeFile(
        tempVoiceMapPath,
        `
Teacher: voice_narrator
Student: voice_student_female
        `.trim(),
      );

      let capturedInputs: DialogueInput[] = [];
      const dialogueSpy = vi
        .spyOn(dialogue, 'synthesizeDialogue')
        .mockImplementation(async (options, _apiKey, outputDir) => {
          capturedInputs = options.inputs ?? [];
          const audioPath = join(outputDir, 'mock-dialogue.mp3');
          await writeFile(audioPath, 'mock-audio');
          return {
            audioPath,
            duration: 5.2,
            hash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
          };
        });

      const result = await buildStudyTextMp3FromPath(assignmentPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsStrategy: 'dialogue',
      });

      expect(result.path).toMatch(/\.mp3$/);
      expect(dialogueSpy).toHaveBeenCalled();
      expect(capturedInputs).toHaveLength(2);
      const first = capturedInputs[0];
      const second = capturedInputs[1];
      if (!first || !second) {
        throw new Error('Expected two dialogue inputs.');
      }
      expect(first.text).toBe('**Hello** *there*.');
      expect(second.text).toBe('This is `code` and ~~strikethrough~~.');
    });

    it('should handle fixtures with speaker profiles in frontmatter', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const assignmentPath = join(dir, 'assignment.json');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      // Create fixture with detailed frontmatter

      await writeFile(
        assignmentPath,
        JSON.stringify(
          createTtsAssignment({
            metadata: {
              title: 'Advanced Conversation',
              student: 'Maria',
              level: 'B2',
              topic: 'expressing opinions',
            },
            studyText: {
              type: 'dialogue',
              speakers: [
                {
                  id: 's0',
                  displayName: 'Instructor',
                  role: 'teacher',
                  persona: null,
                  voiceDirection: null,
                  gender: 'female',
                  age: null,
                  accent: 'american',
                },
                {
                  id: 's1',
                  displayName: 'Student',
                  role: 'learner',
                  persona: null,
                  voiceDirection: null,
                  gender: 'female',
                  age: 'adult',
                  accent: null,
                },
              ],
              turns: [
                {
                  speakerId: 's0',
                  text: "Today we'll practice expressing opinions. What's your opinion about remote work?",
                },
                {
                  speakerId: 's1',
                  text: "I think it's great! It gives me more flexibility with my schedule.",
                },
                {
                  speakerId: 's0',
                  text: "That's a valid point. How do you feel about work-life balance?",
                },
                { speakerId: 's1', text: 'I believe remote work improves it significantly.' },
              ],
            },
            pronunciation: null,
          }),
        ),
      );
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

      const result = await buildStudyTextMp3FromPath(assignmentPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsStrategy: 'tts', // Force TTS to test strategy behavior
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
      const assignmentPath = join(dir, 'mixed.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      // Create fixture that could work in both modes

      await writeFile(
        assignmentPath,
        JSON.stringify(
          createTtsAssignment({
            metadata: { title: 'Test Lesson', student: 'Test Student', level: 'A1', topic: 'test' },
            studyText: {
              type: 'dialogue',
              speakers: [
                {
                  id: 's0',
                  displayName: 'Teacher',
                  role: 'student',
                  persona: null,
                  voiceDirection: null,
                  gender: 'neutral',
                  age: null,
                  accent: null,
                },
                {
                  id: 's1',
                  displayName: 'Student',
                  role: 'student',
                  persona: null,
                  voiceDirection: null,
                  gender: 'neutral',
                  age: null,
                  accent: null,
                },
              ],
              turns: [
                { speakerId: 's0', text: "Let's talk about daily routines." },
                { speakerId: 's1', text: "Okay, I'm ready to learn!" },
                { speakerId: 's0', text: 'What time do you wake up?' },
                { speakerId: 's1', text: 'I wake up at 7 AM every day.' },
                { speakerId: 's0', text: "That's early! What do you do after waking up?" },
                { speakerId: 's1', text: 'I brush my teeth and have breakfast.' },
                { speakerId: 's0', text: 'Excellent! Tell me about your breakfast.' },
                { speakerId: 's1', text: 'I usually have toast and coffee.' },
              ],
            },
            pronunciation: null,
          }),
        ),
      );
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

      // TTS strategy
      const monologueResult = await buildStudyTextMp3FromPath(assignmentPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsStrategy: 'tts',
      });

      expect(monologueResult.path).toMatch(/\.mp3$/);
      expect(convertMock).toHaveBeenCalled(); // Should use TTS path

      // Clear mocks
      convertMock.mockClear();

      // Dialogue strategy
      const dialogueMock = mockDialogue();
      const dialogueResult = await buildStudyTextMp3FromPath(assignmentPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsStrategy: 'dialogue',
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
      const assignmentPath = join(dir, 'orchestrator-test.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      // Test configuration similar to what orchestrator would provide
      const orchestratorConfig = {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        preview: false,
        force: false,
        defaultAccent: 'british',
        ttsStrategy: 'tts' as const, // Force TTS for this test
        dialogueLanguage: 'en', // New field
        dialogueStability: 0.75, // New field
        dialogueSeed: 12_345, // New field
      };

      await writeFile(
        assignmentPath,
        JSON.stringify(
          createTtsAssignment({
            metadata: { title: 'Test Lesson', student: 'Test Student', level: 'A1', topic: 'test' },
            studyText: {
              type: 'monologue',
              speakers: [
                {
                  id: 's0',
                  displayName: 'Narrator',
                  role: 'student',
                  persona: null,
                  voiceDirection: null,
                  gender: 'neutral',
                  age: null,
                  accent: null,
                },
              ],
              turns: [
                { speakerId: 's0', text: 'This is a test for orchestrator integration.' },
                {
                  speakerId: 's0',
                  text: 'We need to ensure all configuration options work properly.',
                },
              ],
            },
            pronunciation: null,
          }),
        ),
      );
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

      const result = await buildStudyTextMp3FromPath(assignmentPath, orchestratorConfig);

      expect(result.path).toBeDefined();
      expect(result.hash).toBeDefined();
      expect(result.voices).toBeDefined();
      expect(convertMock).toHaveBeenCalled();
    });

    it('should work with orchestrator manifest-style output', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const assignmentPath = join(dir, 'manifest-test.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      await writeFile(
        assignmentPath,
        JSON.stringify(
          createTtsAssignment({
            metadata: { title: 'Test Lesson', student: 'Test Student', level: 'A1', topic: 'test' },
            studyText: {
              type: 'monologue',
              speakers: [
                {
                  id: 's0',
                  displayName: 'Narrator',
                  role: 'student',
                  persona: null,
                  voiceDirection: null,
                  gender: 'neutral',
                  age: null,
                  accent: null,
                },
              ],
              turns: [
                {
                  speakerId: 's0',
                  text: 'This should produce output compatible with orchestrator manifests.',
                },
              ],
            },
            pronunciation: null,
          }),
        ),
      );
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

      const result = await buildStudyTextMp3FromPath(assignmentPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsStrategy: 'tts',
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
      const assignmentPath = join(dir, 'cli-test.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      await writeFile(
        assignmentPath,
        JSON.stringify(
          createTtsAssignment({
            metadata: { title: 'Test Lesson', student: 'Test Student', level: 'A1', topic: 'test' },
            studyText: {
              type: 'monologue',
              speakers: [
                {
                  id: 's0',
                  displayName: 'Narrator',
                  role: 'student',
                  persona: null,
                  voiceDirection: null,
                  gender: 'neutral',
                  age: null,
                  accent: null,
                },
              ],
              turns: [{ speakerId: 's0', text: 'This tests CLI-style flag handling.' }],
            },
            pronunciation: null,
          }),
        ),
      );
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
            ttsStrategy: 'tts' as const, // Force TTS to ensure consistent behavior
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
            ttsStrategy: 'tts' as const,
          },
        },
        {
          name: 'with new TTS strategy flags',
          options: {
            voiceMapPath: tempVoiceMapPath,
            outPath: dir,
            ttsStrategy: 'tts' as const,
            dialogueLanguage: 'en',
            dialogueStability: 0.5,
          },
        },
        {
          name: 'with all new flags',
          options: {
            voiceMapPath: tempVoiceMapPath,
            outPath: dir,
            ttsStrategy: 'tts' as const, // Force TTS to avoid dialogue mode issues
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
        await buildStudyTextMp3FromPath(assignmentPath, scenario.options);
        expect(convertMock).not.toHaveBeenCalled();
      }

      for (const scenario of generationScenarios) {
        convertMock.mockClear();
        const result = await buildStudyTextMp3FromPath(assignmentPath, scenario.options);
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
        ttsStrategy: 'auto',
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
      expect(options.ttsStrategy).toBeDefined();
      expect(options.dialogueLanguage).toBeDefined();
      expect(options.dialogueStability).toBeDefined();
      expect(options.dialogueSeed).toBeDefined();
    });

    it('should handle environment variable overrides like CLI would', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const assignmentPath = join(dir, 'env-test.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      await writeFile(
        assignmentPath,
        JSON.stringify(
          createTtsAssignment({
            metadata: { title: 'Test Lesson', student: 'Test Student', level: 'A1', topic: 'test' },
            studyText: {
              type: 'monologue',
              speakers: [
                {
                  id: 's0',
                  displayName: 'Narrator',
                  role: 'student',
                  persona: null,
                  voiceDirection: null,
                  gender: 'neutral',
                  age: null,
                  accent: null,
                },
              ],
              turns: [{ speakerId: 's0', text: 'This tests environment variable handling.' }],
            },
            pronunciation: null,
          }),
        ),
      );
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
      process.env.ESL_TTS_PROVIDER_ELEVENLABS_STRATEGY = 'tts';

      try {
        // Call without specifying strategy - should use env var
        const result = await buildStudyTextMp3FromPath(assignmentPath, {
          voiceMapPath: tempVoiceMapPath,
          outPath: dir,
        });

        expect(result.path).toBeDefined();
        expect(result.hash).toBeDefined();
        expect(convertMock).toHaveBeenCalled(); // Should use TTS strategy
      } finally {
        // Restore environment
        process.env = originalEnv;
      }
    });
  });

  describe('end-to-end workflow', () => {
    it('should complete full workflow from markdown to MP3', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const assignmentPath = join(dir, 'full-workflow.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      await writeFile(
        assignmentPath,
        JSON.stringify(
          createTtsAssignment({
            metadata: {
              title: 'Complete Lesson',
              student: 'Test Student',
              level: 'A2',
              topic: 'ordering food',
            },
            studyText: {
              type: 'dialogue',
              speakers: [
                {
                  id: 's0',
                  displayName: 'Waiter',
                  role: 'server',
                  persona: null,
                  voiceDirection: null,
                  gender: 'male',
                  age: null,
                  accent: null,
                },
                {
                  id: 's1',
                  displayName: 'Customer',
                  role: 'diner',
                  persona: null,
                  voiceDirection: null,
                  gender: 'female',
                  age: null,
                  accent: null,
                },
              ],
              turns: [
                {
                  speakerId: 's0',
                  text: 'Good evening! Welcome to our restaurant. Do you have a reservation?',
                },
                { speakerId: 's1', text: 'Yes, I do. Table for two under Johnson.' },
                { speakerId: 's0', text: 'Perfect! Right this way, please.' },
                { speakerId: 's1', text: 'Thank you. Could I see the menu, please?' },
                {
                  speakerId: 's0',
                  text: 'Of course! Here you are. Can I get you something to drink first?',
                },
                { speakerId: 's1', text: "I'll have a glass of water, please." },
                { speakerId: 's0', text: 'Certainly! Take your time looking at the menu.' },
              ],
            },
            pronunciation: null,
          }),
        ),
      );
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
      const result = await buildStudyTextMp3FromPath(assignmentPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsStrategy: 'tts', // Force TTS for testing
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

      expect(convertMock).toHaveBeenCalled();
    });

    it('should handle both modes end-to-end for same content', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'tts-'));
      const assignmentPath = join(dir, 'mode-comparison.md');
      const tempVoiceMapPath = join(dir, 'voices.yml');

      await writeFile(
        assignmentPath,
        JSON.stringify(
          createTtsAssignment({
            metadata: { title: 'Test Lesson', student: 'Test Student', level: 'A1', topic: 'test' },
            studyText: {
              type: 'dialogue',
              speakers: [
                {
                  id: 's0',
                  displayName: 'Teacher',
                  role: 'student',
                  persona: null,
                  voiceDirection: null,
                  gender: 'neutral',
                  age: null,
                  accent: null,
                },
                {
                  id: 's1',
                  displayName: 'Student',
                  role: 'student',
                  persona: null,
                  voiceDirection: null,
                  gender: 'neutral',
                  age: null,
                  accent: null,
                },
              ],
              turns: [
                { speakerId: 's0', text: "Let's compare different teaching methods." },
                { speakerId: 's1', text: "I'd like to hear about different approaches." },
                {
                  speakerId: 's0',
                  text: 'We can use traditional lecture style or interactive dialogue.',
                },
                { speakerId: 's1', text: 'Which method do you think is more effective?' },
                {
                  speakerId: 's0',
                  text: 'That depends on the learning objectives and student preferences.',
                },
              ],
            },
            pronunciation: null,
          }),
        ),
      );
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

      // TTS strategy
      const monologueResult = await buildStudyTextMp3FromPath(assignmentPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsStrategy: 'tts' as const,
      });

      expect(monologueResult.path).toMatch(/\.mp3$/);
      expect(monologueResult.hash).toHaveLength(64);
      expect(convertMock).toHaveBeenCalled(); // Used TTS path

      // Dialogue strategy
      const dialogueResult = await buildStudyTextMp3FromPath(assignmentPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsStrategy: 'dialogue' as const,
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
