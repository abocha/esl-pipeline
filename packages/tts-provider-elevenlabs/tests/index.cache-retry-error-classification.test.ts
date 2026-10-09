import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import * as eleven from '../src/eleven.js';
import { createTtsAssignment } from './assignment-fixture.js';
import {
  buildStudyTextMp3FromPath,
  createTempDir,
  mockConcat,
  mockDialogue,
  setupClientMock,
  setupTtsTestSuite,
  writeBasicMonologueFixture,
  writeFixture,
} from './index.test-harness.js';

setupTtsTestSuite();

describe('tts elevenlabs integration', () => {
  it('retries retryable provider statuses before failing with provider_rate_limit', async () => {
    const dir = await createTempDir('tts-');
    const { assignmentPath, tempVoiceMapPath } = await writeBasicMonologueFixture(dir);
    const rateLimitError = Object.assign(new Error('too many requests'), { status: 429 });
    const convertMock = vi.fn().mockRejectedValue(rateLimitError);
    vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
      textToSpeech: { convert: convertMock },
    } as any);
    mockConcat();

    await expect(
      buildStudyTextMp3FromPath(assignmentPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsStrategy: 'tts',
      }),
    ).rejects.toThrow(
      /Failed to synthesize line with voice "voice_id_default" \[provider_rate_limit\]/,
    );
    expect(convertMock).toHaveBeenCalledTimes(3);
  });

  it('keeps provider_contract_error category for 5xx while preserving retry ladder behavior', async () => {
    const dir = await createTempDir('tts-');
    const { assignmentPath, tempVoiceMapPath } = await writeBasicMonologueFixture(dir);
    const serverError = Object.assign(new Error('upstream server issue'), { status: 500 });
    const convertMock = vi.fn().mockRejectedValue(serverError);
    vi.spyOn(eleven, 'getElevenClient').mockReturnValue({
      textToSpeech: { convert: convertMock },
    } as any);
    mockConcat();

    await expect(
      buildStudyTextMp3FromPath(assignmentPath, {
        voiceMapPath: tempVoiceMapPath,
        outPath: dir,
        ttsStrategy: 'tts',
      }),
    ).rejects.toThrow(
      /Failed to synthesize line with voice "voice_id_default" \[provider_contract_error\]/,
    );
    expect(convertMock).toHaveBeenCalledTimes(3);
  });

  it('reuses generated audio when file already exists', async () => {
    const dir = await createTempDir('tts-');
    const assignmentPath = join(dir, 'assignment.json');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      assignmentPath,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'Test Lesson', student: 'Anna', level: 'A1', topic: 'greetings' },
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
            turns: [{ speakerId: 's0', text: 'This is a monologue line.' }],
          },
          pronunciation: null,
        }),
      ),
    );
    await writeFixture(
      tempVoiceMapPath,
      `
default: voice_id_default
    `,
    );

    const convertMock = setupClientMock();
    const concatSpy = mockConcat();
    await buildStudyTextMp3FromPath(assignmentPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'tts',
    });
    expect(convertMock).toHaveBeenCalledTimes(1);

    convertMock.mockClear();
    const result = await buildStudyTextMp3FromPath(assignmentPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'tts',
    });
    expect(result.hash).toHaveLength(64);
    expect(convertMock).not.toHaveBeenCalled();
    expect(concatSpy).toHaveBeenCalled();

    convertMock.mockClear();
    const forcedResult = await buildStudyTextMp3FromPath(assignmentPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'tts',
      force: true,
    });
    expect(forcedResult.path).toBe(result.path);
    expect(convertMock).toHaveBeenCalledTimes(1);
  });

  it('reuses monologue chunk cache when final file is missing', async () => {
    const dir = await createTempDir('tts-');
    const assignmentPath = join(dir, 'lesson-chunk-cache.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      assignmentPath,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'Chunk Cache', student: 'Anna', level: 'B1', topic: 'test' },
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
                text: 'This is a monologue line that should be chunk-cached and reused across runs.',
              },
            ],
          },
          pronunciation: null,
        }),
      ),
    );
    await writeFixture(
      tempVoiceMapPath,
      `
default: voice_id_default
    `,
    );

    const convertMock = setupClientMock();
    mockConcat();
    const first = await buildStudyTextMp3FromPath(assignmentPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'tts',
    });
    expect(convertMock).toHaveBeenCalledTimes(1);

    await unlink(first.path);
    convertMock.mockClear();

    await buildStudyTextMp3FromPath(assignmentPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'tts',
    });
    expect(convertMock).not.toHaveBeenCalled();
  });

  it('reuses generated dialogue audio when file already exists and force=false', async () => {
    const dir = await createTempDir('tts-');
    const assignmentPath = join(dir, 'dialogue-cache.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      assignmentPath,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'Dialogue Cache', student: 'Anna', level: 'B1', topic: 'test' },
          studyText: {
            type: 'dialogue',
            speakers: [
              {
                id: 's0',
                displayName: 'Alex',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'neutral',
                age: null,
                accent: null,
              },
              {
                id: 's1',
                displayName: 'Mara',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'neutral',
                age: null,
                accent: null,
              },
            ],
            turns: [
              { speakerId: 's0', text: 'Hi there.' },
              { speakerId: 's1', text: 'Hello.' },
            ],
          },
          pronunciation: null,
        }),
      ),
    );
    await writeFixture(
      tempVoiceMapPath,
      `
Alex: voice_id_1
Mara: voice_id_2
default: voice_id_default
    `,
    );

    const dialogueSpy = mockDialogue();
    const first = await buildStudyTextMp3FromPath(assignmentPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'dialogue',
    });
    expect(first.hash).toHaveLength(64);
    expect(dialogueSpy).toHaveBeenCalledTimes(1);

    dialogueSpy.mockClear();
    const second = await buildStudyTextMp3FromPath(assignmentPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'dialogue',
      force: false,
    });
    expect(second.path).toBe(first.path);
    expect(dialogueSpy).not.toHaveBeenCalled();
  });

  it('regenerates dialogue audio when force=true', async () => {
    const dir = await createTempDir('tts-');
    const assignmentPath = join(dir, 'dialogue-force.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      assignmentPath,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'Dialogue Force', student: 'Anna', level: 'B1', topic: 'test' },
          studyText: {
            type: 'dialogue',
            speakers: [
              {
                id: 's0',
                displayName: 'Alex',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'neutral',
                age: null,
                accent: null,
              },
              {
                id: 's1',
                displayName: 'Mara',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'neutral',
                age: null,
                accent: null,
              },
            ],
            turns: [
              { speakerId: 's0', text: 'Hi there.' },
              { speakerId: 's1', text: 'Hello.' },
            ],
          },
          pronunciation: null,
        }),
      ),
    );
    await writeFixture(
      tempVoiceMapPath,
      `
Alex: voice_id_1
Mara: voice_id_2
default: voice_id_default
    `,
    );

    const dialogueSpy = mockDialogue();
    await buildStudyTextMp3FromPath(assignmentPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'dialogue',
    });
    expect(dialogueSpy).toHaveBeenCalledTimes(1);

    dialogueSpy.mockClear();
    await buildStudyTextMp3FromPath(assignmentPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'dialogue',
      force: true,
    });
    expect(dialogueSpy).toHaveBeenCalledTimes(1);
  });

  it('does not reuse dialogue cache when outputFormat changes', async () => {
    const dir = await createTempDir('tts-');
    const assignmentPath = join(dir, 'dialogue-format-cache.md');
    const tempVoiceMapPath = join(dir, 'voices.yml');
    await writeFixture(
      assignmentPath,
      JSON.stringify(
        createTtsAssignment({
          metadata: { title: 'Dialogue Format Cache', student: 'Anna', level: 'B1', topic: 'test' },
          studyText: {
            type: 'dialogue',
            speakers: [
              {
                id: 's0',
                displayName: 'Alex',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'neutral',
                age: null,
                accent: null,
              },
              {
                id: 's1',
                displayName: 'Mara',
                role: 'student',
                persona: null,
                voiceDirection: null,
                gender: 'neutral',
                age: null,
                accent: null,
              },
            ],
            turns: [
              { speakerId: 's0', text: 'Hi there.' },
              { speakerId: 's1', text: 'Hello.' },
            ],
          },
          pronunciation: null,
        }),
      ),
    );
    await writeFixture(
      tempVoiceMapPath,
      `
Alex: voice_id_1
Mara: voice_id_2
default: voice_id_default
    `,
    );

    const dialogueSpy = mockDialogue();
    await buildStudyTextMp3FromPath(assignmentPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'dialogue',
      outputFormat: 'mp3_22050_32',
    });
    expect(dialogueSpy).toHaveBeenCalledTimes(1);

    dialogueSpy.mockClear();
    await buildStudyTextMp3FromPath(assignmentPath, {
      voiceMapPath: tempVoiceMapPath,
      outPath: dir,
      ttsStrategy: 'dialogue',
      force: false,
      outputFormat: 'mp3_44100_128',
    });
    expect(dialogueSpy).toHaveBeenCalledTimes(1);
  });
});
