import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const convertMock = vi.fn();

  class HoistedElevenLabsError extends Error {
    statusCode?: number;
    body?: unknown;

    constructor(opts: { message?: string; statusCode?: number; body?: unknown } = {}) {
      super(opts.message ?? 'ElevenLabs error');
      this.name = 'ElevenLabsError';
      this.statusCode = opts.statusCode;
      this.body = opts.body;
    }
  }

  class HoistedElevenLabsTimeoutError extends Error {
    constructor(message = 'Request timed out') {
      super(message);
      this.name = 'ElevenLabsTimeoutError';
    }
  }

  return { convertMock, HoistedElevenLabsError, HoistedElevenLabsTimeoutError };
});

vi.mock('@elevenlabs/elevenlabs-js', () => ({
  ElevenLabsClient: class {
    textToDialogue = {
      convert: mocks.convertMock,
    };

    constructor(_opts: unknown) {
      // noop
    }
  },
  ElevenLabsError: mocks.HoistedElevenLabsError,
  ElevenLabsTimeoutError: mocks.HoistedElevenLabsTimeoutError,
}));

import {
  buildDialogueHash,
  chunkDialogueInputs,
  synthesizeDialogue,
  synthesizeDialogueChunk,
} from '../src/dialogue.js';
import * as ffmpeg from '../src/ffmpeg.js';
import type { DialogueInput, DialogueSynthesisOptions } from '../src/types.js';

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

describe('chunkDialogueInputs', () => {
  it('returns empty array for empty input', () => {
    expect(chunkDialogueInputs([])).toEqual([]);
  });

  it('splits inputs by maxInputs and maxChars', () => {
    const inputs: DialogueInput[] = [
      { text: 'a'.repeat(3000), voiceId: 'voice1' },
      { text: 'b'.repeat(3000), voiceId: 'voice2' },
      { text: 'small', voiceId: 'voice3' },
    ];

    const byChars = chunkDialogueInputs(inputs, 100, 5000);
    expect(byChars).toHaveLength(2);

    const byCount = chunkDialogueInputs(
      Array.from({ length: 150 }, (_, idx) => ({ text: `Line ${idx}`, voiceId: 'voice1' })),
      100,
      99999,
    );
    expect(byCount).toHaveLength(2);
    expect(byCount[0]?.totalChunks).toBe(2);
    expect(byCount[1]?.chunkIndex).toBe(1);
  });

  it('accepts legacy voice_id payloads for compatibility', () => {
    const legacy = [{ text: 'Hello', voice_id: 'legacy_voice' }] as unknown as DialogueInput[];
    const chunks = chunkDialogueInputs(legacy);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.inputs[0]).toEqual({ text: 'Hello', voiceId: 'legacy_voice' });
  });
});

describe('buildDialogueHash', () => {
  it('is deterministic and sensitive to synthesis options', () => {
    const inputs: DialogueInput[] = [
      { text: 'Hello', voiceId: 'voice1' },
      { text: 'Hi', voiceId: 'voice2' },
    ];

    const base = buildDialogueHash(inputs, { modelId: 'eleven_v3', outputFormat: 'mp3_22050_32' });
    const same = buildDialogueHash(inputs, { modelId: 'eleven_v3', outputFormat: 'mp3_22050_32' });
    const differentFormat = buildDialogueHash(inputs, {
      modelId: 'eleven_v3',
      outputFormat: 'mp3_44100_128',
    });

    expect(base).toBe(same);
    expect(base).toHaveLength(64);
    expect(base).not.toBe(differentFormat);
  });
});

describe('synthesizeDialogueChunk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ESL_TTS_PROVIDER_ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_TOKEN;
  });

  it('validates missing credentials and empty chunk', async () => {
    const opts: DialogueSynthesisOptions = { inputs: [] };
    await expect(synthesizeDialogueChunk([], opts, '')).rejects.toThrow('Cannot synthesize empty dialogue chunk');

    const chunk: DialogueInput[] = [{ text: 'Hello', voiceId: 'voice1' }];
    await expect(synthesizeDialogueChunk(chunk, { inputs: chunk }, '')).rejects.toThrow(
      'Missing ESL_TTS_PROVIDER_ELEVENLABS_API_KEY',
    );
  });

  it('calls SDK textToDialogue.convert with camelCase payload', async () => {
    const chunk: DialogueInput[] = [
      { text: 'Hello', voiceId: 'voice1' },
      { text: 'Hi', voiceId: 'voice2' },
    ];
    mocks.convertMock.mockResolvedValueOnce(streamFromText('audio'));

    const result = await synthesizeDialogueChunk(
      chunk,
      {
        inputs: chunk,
        modelId: 'eleven_v3',
        languageCode: 'en',
        stability: 0.55,
        seed: 7,
        applyTextNormalization: 'on',
      },
      'test-key',
    );

    expect(result.toString()).toContain('audio');
    expect(mocks.convertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: chunk,
        modelId: 'eleven_v3',
        languageCode: 'en',
        settings: { stability: 0.55 },
        seed: 7,
        applyTextNormalization: 'on',
      }),
      expect.objectContaining({ timeoutInSeconds: 60, maxRetries: 2 }),
    );
  });

  it('wraps provider errors with actionable context', async () => {
    const chunk: DialogueInput[] = [{ text: 'Hello', voiceId: 'voice1' }];
    mocks.convertMock.mockRejectedValueOnce(
      new mocks.HoistedElevenLabsError({
        message: 'Unprocessable entity',
        statusCode: 422,
        body: { detail: 'Invalid voiceId' },
      }),
    );

    await expect(synthesizeDialogueChunk(chunk, { inputs: chunk }, 'test-key')).rejects.toThrow(
      /Text-to-Dialogue synthesis failed \[invalid_voice_id\]: HTTP 422:/,
    );
  });

  it('maps timeout errors to provider_timeout', async () => {
    const chunk: DialogueInput[] = [{ text: 'Hello', voiceId: 'voice1' }];
    mocks.convertMock.mockRejectedValueOnce(
      new mocks.HoistedElevenLabsTimeoutError('Request timed out'),
    );

    await expect(synthesizeDialogueChunk(chunk, { inputs: chunk }, 'test-key')).rejects.toThrow(
      /Text-to-Dialogue synthesis failed \[provider_timeout\]: Request timed out/,
    );
  });
});

describe('synthesizeDialogue', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.ESL_TTS_PROVIDER_ELEVENLABS_SILENCE_TAIL_SECONDS = '0';
    tempDir = await mkdtemp(join(tmpdir(), 'dialogue-test-'));
    vi.spyOn(ffmpeg, 'concatMp3Segments').mockImplementation(async (_segments, outFile) => {
      await writeFile(outFile, 'concatenated-audio');
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.ESL_TTS_PROVIDER_ELEVENLABS_SILENCE_TAIL_SECONDS;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes a single-chunk dialogue file', async () => {
    const inputs: DialogueInput[] = [{ text: 'Hello', voiceId: 'voice1' }];
    mocks.convertMock.mockResolvedValueOnce(streamFromText('single-chunk-audio'));

    const result = await synthesizeDialogue({ inputs }, 'test-key', tempDir);
    const audio = await readFile(result.audioPath, 'utf8');

    expect(result.hash).toHaveLength(64);
    expect(audio).toContain('single-chunk-audio');
    expect(ffmpeg.concatMp3Segments).not.toHaveBeenCalled();
  });

  it('chunks, concatenates, and keeps chunk cache files for reuse', async () => {
    const inputs: DialogueInput[] = Array.from({ length: 150 }, (_, idx) => ({
      text: `Line ${idx}`,
      voiceId: idx % 2 === 0 ? 'voice1' : 'voice2',
    }));
    mocks.convertMock.mockResolvedValue(streamFromText('chunk-audio'));

    const result = await synthesizeDialogue({ inputs }, 'test-key', tempDir);
    const files = await readdir(tempDir);

    expect(ffmpeg.concatMp3Segments).toHaveBeenCalledTimes(1);
    expect(result.audioPath.endsWith('.mp3')).toBe(true);
    expect(files.some((name) => name.includes('-chunk'))).toBe(true);
  });

  it('cleans up files when synthesis fails', async () => {
    const inputs: DialogueInput[] = [{ text: 'Hello', voiceId: 'voice1' }];
    mocks.convertMock.mockRejectedValueOnce(new Error('boom'));

    await expect(synthesizeDialogue({ inputs }, 'test-key', tempDir)).rejects.toThrow();

    const files = await readdir(tempDir);
    expect(files.filter((name) => name.endsWith('.mp3'))).toHaveLength(0);
  });
});
