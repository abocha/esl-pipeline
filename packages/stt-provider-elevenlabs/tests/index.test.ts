import { openAsBlob } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { describe, expect, it, vi } from 'vitest';

import { createElevenLabsSttProvider } from '../src/index.js';

const TEST_MODULE_PATH = fileURLToPath(import.meta.url);

describe('stt-provider-elevenlabs', () => {
  it('uses the installed SDK transport with the execution abort signal', async () => {
    let receivedSignal: AbortSignal | undefined;
    const controller = new AbortController();
    const guardedFetch = vi.fn<typeof fetch>(async (_input, init) => {
      receivedSignal = init?.signal ?? undefined;
      return new Response(
        JSON.stringify({ language_code: 'eng', language_probability: 1, text: 'Hello', words: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const provider = createElevenLabsSttProvider();

    await provider.transcribe({
      context: {
        recordingId: 'rec-sdk-transport',
        storageUri: 's3://bucket/audio.mp3',
        async getStream() {
          return Readable.from(['audio']);
        },
        async getSubmissionSource() {
          return { kind: 'url' as const, url: 'https://storage.example.test/audio.mp3' };
        },
        providerTransport: { fetch: guardedFetch, signal: controller.signal },
      },
      config: { apiKey: 'test' },
    });

    expect(guardedFetch).toHaveBeenCalledTimes(1);
    expect(receivedSignal).toBeDefined();
    controller.abort();
    expect(receivedSignal?.aborted).toBe(true);
  });

  it('serializes the SDK sourceUrl field as source_url without a file part', async () => {
    const requests: Request[] = [];
    const client = new ElevenLabsClient({
      apiKey: 'test',
      maxRetries: 0,
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(
          JSON.stringify({
            language_code: 'eng',
            language_probability: 1,
            text: 'Hello',
            words: [],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      },
    });

    await client.speechToText.convert({
      sourceUrl: 'https://storage.example.test/audio.mp3?X-Amz-Signature=test-secret',
      modelId: 'scribe_v2',
    });

    const form = await requests[0]!.formData();
    expect(form.get('source_url')).toBe(
      'https://storage.example.test/audio.mp3?X-Amz-Signature=test-secret',
    );
    expect(form.get('file')).toBeNull();
    expect(form.get('cloud_storage_url')).toBeNull();
  });

  it('passes a file-backed Blob through the SDK without a stream collector', async () => {
    const requests: Request[] = [];
    let form: FormData | undefined;
    const sourcePath = TEST_MODULE_PATH;
    const sourceStats = await fs.stat(sourcePath);
    const sourceBlob = await openAsBlob(sourcePath, { type: 'audio/wav' });
    const client = new ElevenLabsClient({
      apiKey: 'test',
      maxRetries: 0,
      fetch: async (input, init) => {
        form = init?.body as FormData;
        requests.push(new Request(input, init));
        return new Response(
          JSON.stringify({
            language_code: 'eng',
            language_probability: 1,
            text: 'Hello',
            words: [],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      },
    });

    await client.speechToText.convert({
      file: {
        data: sourceBlob,
        filename: 'audio.wav',
        contentType: 'audio/wav',
        contentLength: sourceStats.size,
      },
      modelId: 'scribe_v2',
    });

    const request = requests[0]!;
    expect(request.body).toBeInstanceOf(ReadableStream);
    expect(request.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
    expect(form).toBeInstanceOf(FormData);
    const file = form?.get('file');
    expect(file).toBeInstanceOf(File);
    expect(file).toMatchObject({
      name: 'audio.wav',
      type: 'audio/wav',
      size: sourceStats.size,
    });
  });

  it('keeps a large local source file-backed at the provider boundary', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'elevenlabs-source-'));
    const sourcePath = path.join(directory, 'audio.m4a');
    const sourceSize = 128 * 1024 * 1024;
    const handle = await fs.open(sourcePath, 'w');
    try {
      await handle.truncate(sourceSize);
    } finally {
      await handle.close();
    }

    let chunkCount = 0;
    let maxChunkBytes = 0;
    let totalBodyBytes = 0;
    const client = new ElevenLabsClient({
      apiKey: 'test',
      maxRetries: 0,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const reader = request.body?.getReader();
        if (!reader) throw new Error('Expected a multipart request body.');
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            chunkCount += 1;
            maxChunkBytes = Math.max(maxChunkBytes, chunk.value.byteLength);
            totalBodyBytes += chunk.value.byteLength;
          }
        } finally {
          reader.releaseLock();
        }

        return new Response(
          JSON.stringify({
            language_code: 'eng',
            language_probability: 1,
            text: 'Hello',
            words: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const provider = createElevenLabsSttProvider({
      clientFactory: () =>
        client as unknown as {
          speechToText: { convert: (args: Record<string, unknown>) => Promise<unknown> };
        },
    });
    const arrayBufferSpy = vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(() => {
      throw new Error('The file-backed upload must not use Blob.arrayBuffer().');
    });

    try {
      const result = await provider.transcribe({
        context: {
          recordingId: 'rec-large',
          storageUri: 'local://audio.m4a',
          async getStream() {
            return Readable.from(Buffer.from('must not be read'));
          },
          async getSubmissionSource() {
            return {
              kind: 'file' as const,
              path: sourcePath,
              filename: 'audio.m4a',
              contentType: 'audio/mp4',
              contentLength: sourceSize,
            };
          },
        },
        config: {
          apiKey: 'test',
        },
      });

      expect(result.text).toBe('Hello');
      expect(chunkCount).toBeGreaterThan(1);
      expect(maxChunkBytes).toBeLessThan(sourceSize / 4);
      expect(totalBodyBytes).toBeGreaterThan(sourceSize);
      expect(arrayBufferSpy).not.toHaveBeenCalled();
    } finally {
      arrayBufferSpy.mockRestore();
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('uses exactly one diarized Scribe v2 request for mixed audio', async () => {
    const convert = vi.fn(async (_request: Record<string, unknown>) => ({
      text: 'Hello hi',
      words: [
        { text: 'Hello', speakerId: 'speaker_1', start: 0.1, end: 0.3 },
        { text: 'hi', speakerId: 'speaker_0', start: 0.5, end: 0.7 },
      ],
    }));

    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({
        speechToText: {
          convert,
        },
      }),
    });

    const result = await provider.transcribe({
      context: {
        recordingId: 'rec-1',
        storageUri: 'local://audio.wav',
        async getStream() {
          return Readable.from(Buffer.from('audio'));
        },
        async getSubmissionSource() {
          return {
            kind: 'url' as const,
            url: 'https://storage.example.test/audio.wav?X-Amz-Signature=secret',
          };
        },
      },
      config: {
        apiKey: 'test',
      },
    });

    expect(result.fallbackUsed).toBe(false);
    expect(result.provider).toBe('elevenlabs');
    expect(result.segments.length).toBeGreaterThan(1);
    expect(result.segments[0]?.speaker).toBe(1);
    expect(result.segments[1]?.speaker).toBe(0);
    expect(convert).toHaveBeenCalledTimes(1);
    expect(convert).toHaveBeenCalledWith({
      sourceUrl: 'https://storage.example.test/audio.wav?X-Amz-Signature=secret',
      modelId: 'scribe_v2',
      useMultiChannel: false,
      diarize: true,
      numSpeakers: 2,
      timestampsGranularity: 'word',
      noVerbatim: false,
    });
    expect(convert.mock.calls[0]?.[0]).not.toHaveProperty('file');
  });

  it('does not expose arbitrary URL-backed provider response fields', async () => {
    const signedUrl =
      'https://storage.example.test/audio.wav?X-Amz-Signature=SIGNED_URL_SECRET_123&X-Amz-Security-Token=TEMP_TOKEN_SECRET_456';
    const convert = vi.fn(async (_request: Record<string, unknown>) => ({
      language_code: 'eng',
      language_probability: 1,
      text: 'Hello hi',
      words: [
        { text: 'Hello', speakerId: 'speaker_1', start: 0.1, end: 0.3 },
        { text: 'hi', speakerId: 'speaker_0', start: 0.5, end: 0.7 },
      ],
      provider_echo: signedUrl,
      diagnostics: { nested_secret: 'TEMP_TOKEN_SECRET_456' },
    }));
    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({ speechToText: { convert } }),
    });

    const result = await provider.transcribe({
      context: {
        recordingId: 'rec-url-success',
        storageUri: 's3://bucket/audio.wav',
        async getStream() {
          return Readable.from(Buffer.from('audio'));
        },
        async getSubmissionSource() {
          return { kind: 'url' as const, url: signedUrl };
        },
      },
      config: { apiKey: 'test' },
    });

    expect(result.text).toBe('Hello hi');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]?.speaker).toBe(1);
    expect(result.segments[1]?.speaker).toBe(0);
    expect(result.rawResponse).toBeNull();
    const serializedResult = JSON.stringify(result);
    expect(serializedResult).not.toContain(signedUrl);
    expect(serializedResult).not.toContain('SIGNED_URL_SECRET_123');
    expect(serializedResult).not.toContain('TEMP_TOKEN_SECRET_456');
  });

  it('rejects URL-backed normalized results containing exact submitted credential material', async () => {
    const signedUrl =
      'https://storage.example.test/audio.wav?X-Amz-Signature=SIGNED_URL_SECRET_123&X-Amz-Security-Token=TEMP_TOKEN_SECRET_456';
    const convert = vi.fn(async (_request: Record<string, unknown>) => ({
      language_code: 'eng',
      language_probability: 1,
      text: 'TEMP_TOKEN_SECRET_456',
      words: [{ text: 'SIGNED_URL_SECRET_123', speakerId: 'speaker_0', start: 0.1, end: 0.3 }],
    }));
    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({ speechToText: { convert } }),
    });

    let thrown: unknown;
    try {
      await provider.transcribe({
        context: {
          recordingId: 'rec-url-contaminated',
          storageUri: 's3://bucket/audio.wav',
          async getStream() {
            return Readable.from(Buffer.from('audio'));
          },
          async getSubmissionSource() {
            return { kind: 'url' as const, url: signedUrl };
          },
        },
        config: { apiKey: 'test' },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(TypeError);
    const safeError = thrown as Error & { cause?: unknown };
    expect(safeError.message).toBe('ElevenLabs source URL submission failed.');
    expect(safeError.message).not.toContain(signedUrl);
    expect(safeError.message).not.toContain('SIGNED_URL_SECRET_123');
    expect(safeError.message).not.toContain('TEMP_TOKEN_SECRET_456');
    expect(safeError.stack).not.toContain(signedUrl);
    expect(safeError.stack).not.toContain('SIGNED_URL_SECRET_123');
    expect(safeError.stack).not.toContain('TEMP_TOKEN_SECRET_456');
    expect(safeError.cause).toBeUndefined();
    expect(JSON.stringify(safeError)).not.toContain('SIGNED_URL_SECRET_123');
    expect(JSON.stringify(safeError)).not.toContain('TEMP_TOKEN_SECRET_456');
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it('uses the file-backed source and prepared media identity for local audio', async () => {
    const convert = vi.fn(async (_request: Record<string, unknown>) => ({
      text: 'Hello hi',
      words: [
        { text: 'Hello', speakerId: 'speaker_1', start: 0.1, end: 0.3 },
        { text: 'hi', speakerId: 'speaker_0', start: 0.5, end: 0.7 },
      ],
    }));
    const getStream = vi.fn(async () => Readable.from(Buffer.from('must not be read')));

    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({
        speechToText: {
          convert,
        },
      }),
    });

    const sourcePath = TEST_MODULE_PATH;
    const sourceStats = await fs.stat(sourcePath);

    await provider.transcribe({
      context: {
        recordingId: 'rec-local',
        storageUri: 'local://workspaces/w/recordings/rec-local/audio.wav',
        getStream,
        async getSubmissionSource() {
          return {
            kind: 'file' as const,
            path: sourcePath,
            filename: 'audio.wav',
            contentType: 'audio/wav',
            contentLength: sourceStats.size,
          };
        },
      },
      config: {
        apiKey: 'test',
      },
    });

    expect(getStream).not.toHaveBeenCalled();
    expect(convert).toHaveBeenCalledTimes(1);
    const request = convert.mock.calls[0]?.[0];
    if (!request) throw new Error('Expected ElevenLabs request.');
    expect(request).toMatchObject({
      file: {
        filename: 'audio.wav',
        contentType: 'audio/wav',
        contentLength: sourceStats.size,
      },
      modelId: 'scribe_v2',
      useMultiChannel: false,
      diarize: true,
      numSpeakers: 2,
      timestampsGranularity: 'word',
      noVerbatim: false,
    });
    expect(request).not.toHaveProperty('sourceUrl');
    expect(request).not.toHaveProperty('file.path');
    expect(request.file).toMatchObject({ data: expect.any(Blob) });
    expect((request.file as { data: Blob }).data.type).toBe('audio/wav');
  });

  it('does not make a fallback request when the one mixed request fails', async () => {
    const convert = vi.fn().mockRejectedValueOnce(new Error('provider unavailable'));

    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({
        speechToText: {
          convert,
        },
      }),
    });

    await expect(
      provider.transcribe({
        context: {
          recordingId: 'rec-1',
          storageUri: 'local://audio.wav',
          async getStream() {
            return Readable.from(Buffer.from('audio'));
          },
          async getSubmissionSource() {
            return { kind: 'url' as const, url: 'https://storage.example.test/audio.wav' };
          },
        },
        config: {
          apiKey: 'test',
        },
      }),
    ).rejects.toThrow('ElevenLabs source URL submission failed.');
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it('sanitizes reflected signed URL details before URL submission errors escape', async () => {
    const signedUrl =
      'https://storage.example.test/audio.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=SIGNED_URL_SECRET_123';
    const rawCause = new Error(`cause reflected ${signedUrl}`);
    const rawError = new Error(`provider rejected ${signedUrl}`);
    const providerCodeSecret = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    Object.assign(rawError, {
      body: { message: `body reflected ${signedUrl}` },
      status: 503,
      code: providerCodeSecret,
    });
    Object.defineProperty(rawError, 'cause', { value: rawCause, enumerable: true });
    rawError.stack = `Error: stack reflected ${signedUrl}`;

    const convert = vi.fn().mockRejectedValue(rawError);
    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({
        speechToText: {
          convert,
        },
      }),
    });

    let thrown: unknown;
    try {
      await provider.transcribe({
        context: {
          recordingId: 'rec-url-error',
          storageUri: 's3://bucket/audio.mp3',
          async getStream() {
            return Readable.from(Buffer.from('audio'));
          },
          async getSubmissionSource() {
            return { kind: 'url' as const, url: signedUrl };
          },
        },
        config: { apiKey: 'test' },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBe(rawError);
    const safeError = thrown as Error & { status?: number; code?: string; cause?: unknown };
    expect(safeError.message).not.toContain(signedUrl);
    expect(safeError.message).not.toContain('X-Amz-Signature');
    expect(safeError.message).not.toContain('SIGNED_URL_SECRET_123');
    expect(safeError.stack).not.toContain(signedUrl);
    expect(safeError.stack).not.toContain('X-Amz-Signature');
    expect(safeError.stack).not.toContain('SIGNED_URL_SECRET_123');
    expect(safeError.cause).toBeUndefined();
    const enumerableError = JSON.stringify(safeError);
    expect(enumerableError).not.toContain(signedUrl);
    expect(enumerableError).not.toContain('X-Amz-Signature');
    expect(enumerableError).not.toContain('SIGNED_URL_SECRET_123');
    expect(safeError.status).toBe(503);
    expect(safeError.code).toBe('PROVIDER_RETRYABLE_HTTP');
    expect(JSON.stringify(safeError)).not.toContain(providerCodeSecret);
    expect(provider.classifyProviderError).toBeUndefined();
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it('does not invoke ElevenLabs when provider source preparation fails', async () => {
    const convert = vi.fn(async (_request: Record<string, unknown>) => ({
      text: 'should not be returned',
      words: [],
    }));
    const sourceError = new Error('provider source unavailable');
    const getSubmissionSource = vi.fn(async () => {
      throw sourceError;
    });
    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({
        speechToText: {
          convert,
        },
      }),
    });

    await expect(
      provider.transcribe({
        context: {
          recordingId: 'rec-source-failure',
          storageUri: 'local://audio.wav',
          async getStream() {
            return Readable.from(Buffer.from('audio'));
          },
          getSubmissionSource,
        },
        config: {
          apiKey: 'test',
        },
      }),
    ).rejects.toBe(sourceError);

    expect(getSubmissionSource).toHaveBeenCalledTimes(1);
    expect(convert).not.toHaveBeenCalled();
  });

  it('requires api key', async () => {
    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({
        speechToText: {
          async convert() {
            return {};
          },
        },
      }),
    });

    await expect(
      provider.transcribe({
        context: {
          recordingId: 'rec-1',
          storageUri: 'local://audio.wav',
          async getStream() {
            return Readable.from(Buffer.from('audio'));
          },
          async getSubmissionSource() {
            return { kind: 'url' as const, url: 'https://storage.example.test/audio.wav' };
          },
        },
        config: {
          apiKey: '',
        },
      }),
    ).rejects.toThrow(/ELEVENLABS_API_KEY is required/i);
  });
});
