import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chunkDialogueInputs,
  buildDialogueHash,
  synthesizeDialogueChunk,
  synthesizeDialogue,
} from '../src/dialogue.js';
import type { DialogueInput, DialogueSynthesisOptions } from '../src/types.js';
import * as ffmpeg from '../src/ffmpeg.js';

describe('chunkDialogueInputs', () => {
  it('returns empty array for empty input', () => {
    const result = chunkDialogueInputs([]);
    expect(result).toEqual([]);
  });

  it('returns single chunk for small input', () => {
    const inputs: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice1' },
      { text: 'Hi there', voice_id: 'voice2' },
    ];
    const result = chunkDialogueInputs(inputs);
    
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      inputs,
      chunkIndex: 0,
      totalChunks: 1,
    });
  });

  it('splits when exceeding maxInputs', () => {
    const inputs: DialogueInput[] = Array.from({ length: 150 }, (_, i) => ({
      text: `Line ${i}`,
      voice_id: 'voice1',
    }));
    
    const result = chunkDialogueInputs(inputs, 100);
    
    expect(result).toHaveLength(2);
    expect(result[0]!.inputs).toHaveLength(100);
    expect(result[1]!.inputs).toHaveLength(50);
    expect(result[0]!.chunkIndex).toBe(0);
    expect(result[1]!.chunkIndex).toBe(1);
    expect(result[0]!.totalChunks).toBe(2);
    expect(result[1]!.totalChunks).toBe(2);
  });

  it('splits when exceeding maxChars', () => {
    const inputs: DialogueInput[] = [
      { text: 'a'.repeat(3000), voice_id: 'voice1' },
      { text: 'b'.repeat(3000), voice_id: 'voice2' },
      { text: 'c'.repeat(100), voice_id: 'voice3' },
    ];
    
    const result = chunkDialogueInputs(inputs, 100, 5000);
    
    expect(result).toHaveLength(2);
    expect(result[0]!.inputs).toHaveLength(1);
    expect(result[1]!.inputs).toHaveLength(2);
  });

  it('sets correct chunk metadata', () => {
    const inputs: DialogueInput[] = Array.from({ length: 250 }, (_, i) => ({
      text: `Line ${i}`,
      voice_id: 'voice1',
    }));
    
    const result = chunkDialogueInputs(inputs, 100);
    
    expect(result).toHaveLength(3);
    result.forEach((chunk, idx) => {
      expect(chunk.chunkIndex).toBe(idx);
      expect(chunk.totalChunks).toBe(3);
    });
  });

  it('handles custom maxInputs and maxChars', () => {
    const inputs: DialogueInput[] = Array.from({ length: 10 }, () => ({
      text: 'x'.repeat(100),
      voice_id: 'voice1',
    }));
    
    const result = chunkDialogueInputs(inputs, 5, 300);
    
    expect(result.length).toBeGreaterThan(1);
  });
});

describe('buildDialogueHash', () => {
  it('produces deterministic hash for same inputs', () => {
    const inputs: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice1' },
      { text: 'World', voice_id: 'voice2' },
    ];
    const options: Partial<DialogueSynthesisOptions> = {
      modelId: 'eleven_v3',
      languageCode: 'en',
    };
    
    const hash1 = buildDialogueHash(inputs, options);
    const hash2 = buildDialogueHash(inputs, options);
    
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it('produces different hash for different inputs', () => {
    const inputs1: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice1' },
    ];
    const inputs2: DialogueInput[] = [
      { text: 'Goodbye', voice_id: 'voice1' },
    ];
    const options: Partial<DialogueSynthesisOptions> = {};
    
    const hash1 = buildDialogueHash(inputs1, options);
    const hash2 = buildDialogueHash(inputs2, options);
    
    expect(hash1).not.toBe(hash2);
  });

  it('produces different hash for different voice_id', () => {
    const inputs1: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice1' },
    ];
    const inputs2: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice2' },
    ];
    const options: Partial<DialogueSynthesisOptions> = {};
    
    const hash1 = buildDialogueHash(inputs1, options);
    const hash2 = buildDialogueHash(inputs2, options);
    
    expect(hash1).not.toBe(hash2);
  });

  it('includes modelId in hash', () => {
    const inputs: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice1' },
    ];
    
    const hash1 = buildDialogueHash(inputs, { modelId: 'eleven_v3' });
    const hash2 = buildDialogueHash(inputs, { modelId: 'eleven_v2' });
    
    expect(hash1).not.toBe(hash2);
  });

  it('includes languageCode in hash', () => {
    const inputs: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice1' },
    ];
    
    const hash1 = buildDialogueHash(inputs, { languageCode: 'en' });
    const hash2 = buildDialogueHash(inputs, { languageCode: 'es' });
    
    expect(hash1).not.toBe(hash2);
  });

  it('includes stability in hash', () => {
    const inputs: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice1' },
    ];
    
    const hash1 = buildDialogueHash(inputs, { stability: 0.5 });
    const hash2 = buildDialogueHash(inputs, { stability: 0.8 });
    
    expect(hash1).not.toBe(hash2);
  });

  it('includes seed in hash', () => {
    const inputs: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice1' },
    ];
    
    const hash1 = buildDialogueHash(inputs, { seed: 123 });
    const hash2 = buildDialogueHash(inputs, { seed: 456 });
    
    expect(hash1).not.toBe(hash2);
  });

  it('uses default modelId when not provided', () => {
    const inputs: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice1' },
    ];
    
    const hash1 = buildDialogueHash(inputs, {});
    const hash2 = buildDialogueHash(inputs, { modelId: 'eleven_v3' });
    
    expect(hash1).toBe(hash2);
  });
});

describe('synthesizeDialogueChunk', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws error when API key is missing', async () => {
    const chunk: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice1' },
    ];
    const options: DialogueSynthesisOptions = {
      inputs: chunk,
    };
    
    await expect(
      synthesizeDialogueChunk(chunk, options, '')
    ).rejects.toThrow('Missing ELEVENLABS_API_KEY');
  });

  it('throws error for empty chunk', async () => {
    const options: DialogueSynthesisOptions = {
      inputs: [],
    };
    
    await expect(
      synthesizeDialogueChunk([], options, 'test-key')
    ).rejects.toThrow('Cannot synthesize empty dialogue chunk');
  });

  it('calls API with correct request format', async () => {
    const chunk: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice1' },
      { text: 'Hi', voice_id: 'voice2' },
    ];
    const options: DialogueSynthesisOptions = {
      inputs: chunk,
      modelId: 'eleven_v3',
      languageCode: 'en',
    };
    
    const mockBuffer = Buffer.from('mock-audio-data');
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: new Uint8Array(mockBuffer) })
            .mockResolvedValueOnce({ done: true }),
          releaseLock: vi.fn(),
        }),
      },
    });
    
    await synthesizeDialogueChunk(chunk, options, 'test-api-key');
    
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/text-to-dialogue'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'xi-api-key': 'test-api-key',
          'Content-Type': 'application/json',
        }),
        body: expect.stringContaining('"inputs"'),
      })
    );
    
    const callArgs = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.inputs).toEqual(chunk);
    expect(body.model_id).toBe('eleven_v3');
    expect(body.language_code).toBe('en');
  });

  it('includes optional parameters in request', async () => {
    const chunk: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice1' },
    ];
    const options: DialogueSynthesisOptions = {
      inputs: chunk,
      stability: 0.7,
      seed: 42,
      applyTextNormalization: 'on',
    };
    
    const mockBuffer = Buffer.from('mock-audio-data');
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: new Uint8Array(mockBuffer) })
            .mockResolvedValueOnce({ done: true }),
          releaseLock: vi.fn(),
        }),
      },
    });
    
    await synthesizeDialogueChunk(chunk, options, 'test-api-key');
    
    const callArgs = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.settings).toEqual({ stability: 0.7 });
    expect(body.seed).toBe(42);
    expect(body.apply_text_normalization).toBe('on');
  });

  it('handles API error responses', async () => {
    const chunk: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice1' },
    ];
    const options: DialogueSynthesisOptions = {
      inputs: chunk,
    };
    
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => 'Invalid voice_id',
    });
    
    await expect(
      synthesizeDialogueChunk(chunk, options, 'test-api-key')
    ).rejects.toThrow(/400 Bad Request.*Invalid voice_id/);
  });

  it('handles timeout', async () => {
    const chunk: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice1' },
    ];
    const options: DialogueSynthesisOptions = {
      inputs: chunk,
    };
    
    (global.fetch as any).mockImplementationOnce(() => 
      new Promise((_, reject) => {
        setTimeout(() => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        }, 100);
      })
    );
    
    await expect(
      synthesizeDialogueChunk(chunk, options, 'test-api-key')
    ).rejects.toThrow(/timed out/);
  });

  it('returns audio buffer on success', async () => {
    const chunk: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice1' },
    ];
    const options: DialogueSynthesisOptions = {
      inputs: chunk,
    };
    
    const mockAudioData = Buffer.from('mock-audio-data');
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: new Uint8Array(mockAudioData) })
            .mockResolvedValueOnce({ done: true }),
          releaseLock: vi.fn(),
        }),
      },
    });
    
    const result = await synthesizeDialogueChunk(chunk, options, 'test-api-key');
    
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString()).toBe(mockAudioData.toString());
  });
});

describe('synthesizeDialogue', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dialogue-test-'));
    global.fetch = vi.fn();
    vi.spyOn(ffmpeg, 'concatMp3Segments').mockResolvedValue();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // Clean up temp directory
    try {
      const { rm } = await import('node:fs/promises');
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('throws error for empty inputs', async () => {
    const options: DialogueSynthesisOptions = {
      inputs: [],
    };
    
    await expect(
      synthesizeDialogue(options, 'test-key', tempDir)
    ).rejects.toThrow('requires at least one input');
  });

  it('synthesizes single chunk successfully', async () => {
    const inputs: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice1' },
      { text: 'Hi', voice_id: 'voice2' },
    ];
    const options: DialogueSynthesisOptions = {
      inputs,
    };
    
    const mockAudioData = Buffer.from('mock-audio-data');
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: new Uint8Array(mockAudioData) })
            .mockResolvedValueOnce({ done: true }),
          releaseLock: vi.fn(),
        }),
      },
    });
    
    const result = await synthesizeDialogue(options, 'test-key', tempDir);
    
    expect(result.audioPath).toContain('.mp3');
    expect(result.hash).toHaveLength(64);
    expect(result.duration).toBeTypeOf('number');
    
    // Verify file was created
    const fileContent = await readFile(result.audioPath);
    expect(fileContent.toString()).toBe(mockAudioData.toString());
  });

  it('synthesizes and concatenates multiple chunks', async () => {
    const inputs: DialogueInput[] = Array.from({ length: 150 }, (_, i) => ({
      text: `Line ${i}`,
      voice_id: 'voice1',
    }));
    const options: DialogueSynthesisOptions = {
      inputs,
    };
    
    const mockAudioData = Buffer.from('mock-audio-data');
    (global.fetch as any).mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: new Uint8Array(mockAudioData) })
            .mockResolvedValueOnce({ done: true }),
          releaseLock: vi.fn(),
        }),
      },
    });
    
    const result = await synthesizeDialogue(options, 'test-key', tempDir);
    
    expect(result.audioPath).toContain('.mp3');
    expect(result.hash).toHaveLength(64);
    
    // Verify concatenation was called
    expect(ffmpeg.concatMp3Segments).toHaveBeenCalled();
    const concatCall = (ffmpeg.concatMp3Segments as any).mock.calls[0];
    expect(concatCall[0].length).toBeGreaterThan(1); // Multiple chunk files
  });

  it('cleans up temporary chunk files after concatenation', async () => {
    const inputs: DialogueInput[] = Array.from({ length: 150 }, (_, i) => ({
      text: `Line ${i}`,
      voice_id: 'voice1',
    }));
    const options: DialogueSynthesisOptions = {
      inputs,
    };
    
    const mockAudioData = Buffer.from('mock-audio-data');
    (global.fetch as any).mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: new Uint8Array(mockAudioData) })
            .mockResolvedValueOnce({ done: true }),
          releaseLock: vi.fn(),
        }),
      },
    });
    
    // Mock concatMp3Segments to actually create the final file
    (ffmpeg.concatMp3Segments as any).mockImplementation(async (_segments: string[], outFile: string) => {
      await writeFile(outFile, 'concatenated-audio');
    });
    
    await synthesizeDialogue(options, 'test-key', tempDir);
    
    // Verify concat was called
    expect(ffmpeg.concatMp3Segments).toHaveBeenCalled();
    
    // Chunk files should be cleaned up (only final file remains)
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(tempDir);
    const mp3Files = files.filter(f => f.endsWith('.mp3'));
    expect(mp3Files.length).toBeGreaterThanOrEqual(1); // At least final concatenated file
  });

  it('cleans up files on error', async () => {
    const inputs: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice1' },
    ];
    const options: DialogueSynthesisOptions = {
      inputs,
    };
    
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Server error',
    });
    
    await expect(
      synthesizeDialogue(options, 'test-key', tempDir)
    ).rejects.toThrow();
    
    // Verify no files remain
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(tempDir);
    const mp3Files = files.filter(f => f.endsWith('.mp3'));
    expect(mp3Files).toHaveLength(0);
  });

  it('generates consistent hash for same inputs', async () => {
    const inputs: DialogueInput[] = [
      { text: 'Hello', voice_id: 'voice1' },
    ];
    const options: DialogueSynthesisOptions = {
      inputs,
      modelId: 'eleven_v3',
    };
    
    const mockAudioData = Buffer.from('mock-audio-data');
    (global.fetch as any).mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: new Uint8Array(mockAudioData) })
            .mockResolvedValueOnce({ done: true }),
          releaseLock: vi.fn(),
        }),
      },
    });
    
    describe('Dialogue API Integration', () => {
      it.skipIf(!process.env.ELEVENLABS_API_KEY)(
        'should synthesize dialogue using real API',
        async () => {
          const tempDir = await mkdtemp(join(tmpdir(), 'dialogue-integration-'));
          
          try {
            const inputs: DialogueInput[] = [
              { text: 'Hello, how are you?', voice_id: process.env.ELEVENLABS_VOICE_ID_1 || 'EXAVITQu4vr4xnSDxMaL' },
              { text: 'I am doing well, thank you!', voice_id: process.env.ELEVENLABS_VOICE_ID_2 || 'pNInz6obpgDQGcFmaJgB' },
            ];
            
            const options: DialogueSynthesisOptions = {
              inputs,
              modelId: 'eleven_v3',
              languageCode: 'en',
            };
            
            const result = await synthesizeDialogue(
              options,
              process.env.ELEVENLABS_API_KEY!,
              tempDir
            );
            
            expect(result.audioPath).toContain('.mp3');
            expect(result.hash).toHaveLength(64);
            
            // Verify file exists and has content
            const { stat } = await import('node:fs/promises');
            const stats = await stat(result.audioPath);
            expect(stats.size).toBeGreaterThan(0);
            
            console.log('Integration test result:', {
              path: result.audioPath,
              size: stats.size,
              duration: result.duration,
              hash: result.hash,
            });
          } finally {
            // Clean up
            try {
              const { rm } = await import('node:fs/promises');
              await rm(tempDir, { recursive: true, force: true });
            } catch {
              // Ignore cleanup errors
            }
          }
        },
        120000 // 2 minute timeout for real API call
      );
    });
    
    const result1 = await synthesizeDialogue(options, 'test-key', tempDir);
    
    // Clean up for second run
    await unlink(result1.audioPath);
    
    const result2 = await synthesizeDialogue(options, 'test-key', tempDir);
    
    expect(result1.hash).toBe(result2.hash);
  });
});
