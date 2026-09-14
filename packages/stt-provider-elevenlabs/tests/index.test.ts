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
  it.each([
    [undefined, 2, 'missing_start'],
    [null, 2, 'missing_start'],
    [1, undefined, 'missing_end'],
    [NaN, 2, 'non_finite_start'],
    [1, Infinity, 'non_finite_end'],
    [-1, 2, 'negative_start'],
    [2, 1, 'reversed_timing'],
  ])('records pre-merge lexical provenance for %s, %s as %s', async (start, end, issue) => {
    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({
        speechToText: {
          convert: async () => ({
            text: 'TRANSCRIPT_SECRET',
            privateField: 'PROVIDER_SECRET',
            words: [
              { text: ' ', type: 'spacing' },
              { text: '[sound]', type: 'audio_event' },
              { text: '!', type: 'punctuation' },
              { text: 'TRANSCRIPT_SECRET', type: 'word', speaker_id: 'speaker_0', start, end },
              { text: 'OTHER_SECRET', type: 'ARBITRARY_PROVIDER_KIND', start: 3, end: 3 },
            ],
          }),
        },
      }),
    });
    const result = await provider.transcribe({
      context: {
        recordingId: 'provenance',
        storageUri: 's3://bucket/audio.wav',
        getStream: async () => Readable.from(['unused']),
        getSubmissionSource: async () => ({
          kind: 'url',
          url: 'https://storage.example.test/audio.wav',
        }),
      },
      config: { apiKey: 'test' },
    });
    expect(result.summary?.elevenLabsPreMergeTiming).toEqual({
      indexBasis: 'provider_words_zero_based',
      lexicalTokenCount: 2,
      invalidTimingTokenCount: 1,
      firstInvalidTokenIndex: 3,
      firstInvalidTimingIssue: issue,
    });
    expect(JSON.stringify(result.summary)).not.toMatch(/SECRET|ARBITRARY_PROVIDER_KIND|https:/);
  });

  it('does not coalesce far-backward disjoint provider intervals', async () => {
    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({
        speechToText: {
          convert: async () => ({
            text: 'Hello again hi',
            words: [
              { text: 'Hello', type: 'word', speaker_id: 'speaker_0', start: 10, end: 11 },
              { text: 'again', type: 'word', speaker_id: 'speaker_0', start: 0, end: 1 },
              { text: 'hi', type: 'word', speaker_id: 'speaker_1', start: 12, end: 13 },
            ],
          }),
        },
      }),
    });
    const result = await provider.transcribe({
      context: {
        recordingId: 'provenance',
        storageUri: 's3://bucket/audio.wav',
        getStream: async () => Readable.from(['unused']),
        getSubmissionSource: async () => ({
          kind: 'url',
          url: 'https://storage.example.test/audio.wav',
        }),
      },
      config: { apiKey: 'test' },
    });
    expect(result.summary?.elevenLabsPreMergeTiming).toEqual({
      indexBasis: 'provider_words_zero_based',
      lexicalTokenCount: 3,
      invalidTimingTokenCount: 0,
    });
    expect(result.segments).toEqual([
      { text: 'again', speaker: 0, start: 0, end: 1 },
      { text: 'Hello', speaker: 0, start: 10, end: 11 },
      { text: 'hi', speaker: 1, start: 12, end: 13 },
    ]);
  });

  it('retains and coalesces same-speaker runs of point-timed lexical tokens', async () => {
    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({
        speechToText: {
          convert: async () => ({
            text: 'У тебя yes Hi',
            words: [
              { text: 'У', type: 'word', speaker_id: 'speaker_0', start: 11.01, end: 11.01 },
              { text: 'тебя', type: 'word', speaker_id: 'speaker_0', start: 11.01, end: 11.01 },
              { text: 'yes', type: 'word', speaker_id: 'speaker_0', start: 11.01, end: 11.01 },
              { text: 'Hi', type: 'word', speaker_id: 'speaker_1', start: 11.01, end: 11.01 },
            ],
          }),
        },
      }),
    });

    const result = await provider.transcribe({
      context: {
        recordingId: 'rec-point-timing',
        storageUri: 's3://bucket/audio.wav',
        getStream: async () => Readable.from(['unused']),
        getSubmissionSource: async () => ({
          kind: 'url',
          url: 'https://storage.example.test/audio.wav',
        }),
      },
      config: { apiKey: 'test' },
    });

    expect(result.summary?.elevenLabsPreMergeTiming).toEqual({
      indexBasis: 'provider_words_zero_based',
      lexicalTokenCount: 4,
      invalidTimingTokenCount: 0,
    });
    expect(result.segments).toEqual([
      { text: 'У тебя yes', speaker: 0, start: 11.01, end: 11.01 },
      { text: 'Hi', speaker: 1, start: 11.01, end: 11.01 },
    ]);
  });

  it.each([
    [undefined, 3],
    [null, 3],
    [2, undefined],
    [2, null],
    [2, 1],
  ])(
    'preserves malformed lexical timing (%s, %s) through the installed SDK and turn merging',
    async (start, end) => {
      const guardedFetch = vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              language_code: 'eng',
              language_probability: 1,
              text: 'Hello bad hi',
              words: [
                {
                  text: 'Hello',
                  type: 'word',
                  speaker_id: 'speaker_0',
                  start: 1,
                  end: 1.5,
                  logprob: 0,
                },
                { text: 'bad', type: 'word', speaker_id: 'speaker_0', start, end, logprob: 0 },
                { text: 'hi', type: 'word', speaker_id: 'speaker_1', start: 4, end: 5, logprob: 0 },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      );
      const result = await createElevenLabsSttProvider().transcribe({
        context: {
          recordingId: 'rec-timing',
          storageUri: 's3://bucket/audio.wav',
          async getStream() {
            return Readable.from(['audio']);
          },
          async getSubmissionSource() {
            return { kind: 'url' as const, url: 'https://storage.example.test/audio.wav' };
          },
          providerTransport: { fetch: guardedFetch, signal: new AbortController().signal },
        },
        config: { apiKey: 'test' },
      });
      expect(guardedFetch).toHaveBeenCalledTimes(1);
      expect(result.segments).toHaveLength(3);
      expect(result.segments).toContainEqual({
        text: 'bad',
        speaker: 0,
        start: start ?? undefined,
        end: end ?? undefined,
      });
      // Missing start moves provider word 1 to normalized index 0; it is not repaired to zero.
      if (start == null) expect(result.segments[0]?.text).toBe('bad');
      expect(result.rawResponse).toMatchObject({ text: 'Hello bad hi' });
    },
  );

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

  it('preserves audio events while coalescing only the surrounding Scribe speech turns', async () => {
    const convert = vi.fn(async () => ({
      text: 'Hello there! [applause] [laughter] Again hi',
      words: [
        { text: 'Hello', type: 'word', speakerId: 'speaker_0', start: 0, end: 0.4 },
        { text: ' ', type: 'spacing', start: 0.4, end: 0.4 },
        { text: 'there', type: 'word', speakerId: 'speaker_0', start: 0.5, end: 0.8 },
        { text: '!', type: 'punctuation', start: 0.8, end: 0.8 },
        {
          text: '[applause]',
          type: 'audio_event',
          speakerId: 'speaker_0',
          start: 0.9,
          end: 1.2,
        },
        { text: '[laughter]', type: 'audio_event', start: 1.25, end: 1.3 },
        { text: 'Again', type: 'word', speakerId: 'speaker_0', start: 1.3, end: 1.6 },
        { text: 'hi', type: 'word', speakerId: 'speaker_1', start: 1.7, end: 2 },
      ],
    }));
    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({ speechToText: { convert } }),
    });

    const result = await provider.transcribe({
      context: {
        recordingId: 'rec-token-kinds',
        storageUri: 'local://audio.wav',
        async getStream() {
          return Readable.from(Buffer.from('audio'));
        },
        async getSubmissionSource() {
          return { kind: 'url' as const, url: 'https://storage.example.test/audio.wav' };
        },
      },
      config: { apiKey: 'test' },
    });

    expect(result.text).toBe('Hello there! [applause] [laughter] Again hi');
    expect(result.segments).toEqual([
      { text: 'Hello there!', speaker: 0, start: 0, end: 0.8 },
      {
        text: '[applause]',
        kind: 'non_speech',
        speaker: 0,
        start: 0.9,
        end: 1.2,
      },
      { text: '[laughter]', kind: 'non_speech', start: 1.25, end: 1.3 },
      { text: 'Again', speaker: 0, start: 1.3, end: 1.6 },
      { text: 'hi', speaker: 1, start: 1.7, end: 2 },
    ]);
  });

  it('preserves unattributed lexical speech for structural rejection', async () => {
    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({
        speechToText: {
          async convert() {
            return {
              text: 'Hello there',
              words: [
                { text: 'Hello', type: 'word', speakerId: 'speaker_0', start: 0, end: 0.4 },
                { text: 'there', type: 'word', start: 0.5, end: 0.9 },
              ],
            };
          },
        },
      }),
    });

    const result = await provider.transcribe({
      context: {
        recordingId: 'rec-unattributed-speech',
        storageUri: 'local://audio.wav',
        async getStream() {
          return Readable.from(Buffer.from('audio'));
        },
        async getSubmissionSource() {
          return { kind: 'url' as const, url: 'https://storage.example.test/audio.wav' };
        },
      },
      config: { apiKey: 'test' },
    });

    expect(result.segments).toContainEqual({
      text: 'there',
      speaker: undefined,
      start: 0.5,
      end: 0.9,
    });
  });

  it('exposes the complete URL-backed provider response for worker-owned raw storage', async () => {
    const signedUrl =
      'https://storage.example.test/audio.wav?X-Amz-Signature=SIGNED_URL_SECRET_123&X-Amz-Security-Token=TEMP_TOKEN_SECRET_456';
    const response = {
      language_code: 'eng',
      language_probability: 1,
      text: 'Hello hi',
      words: [
        { text: 'Hello', speakerId: 'speaker_1', start: 0.1, end: 0.3 },
        { text: 'hi', speakerId: 'speaker_0', start: 0.5, end: 0.7 },
      ],
      provider_echo: signedUrl,
      diagnostics: { nested_secret: 'TEMP_TOKEN_SECRET_456' },
    };
    const convert = vi.fn(async (_request: Record<string, unknown>) => response);
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
    expect(result.rawResponse).toBe(response);
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

  it.each([
    ['current', { detail: { status: 'insufficient_credits', message: 'PROVIDER_SECRET' } }],
    ['legacy', { message_type: 'quota_exceeded', error: 'PROVIDER_SECRET' }],
  ])(
    'classifies the %s account-credit code without retaining provider text',
    async (_kind, body) => {
      const rawError = Object.assign(new Error('PROVIDER_SECRET'), {
        body,
        statusCode: 402,
      });
      const provider = createElevenLabsSttProvider({
        clientFactory: () => ({
          speechToText: { convert: vi.fn().mockRejectedValue(rawError) },
        }),
      });

      const thrown = await provider
        .transcribe({
          context: {
            recordingId: 'rec-provider-account',
            storageUri: 's3://bucket/audio.wav',
            getStream: async () => Readable.from(['unused']),
            getSubmissionSource: async () => ({
              kind: 'url' as const,
              url: 'https://storage.example.test/audio.wav',
            }),
          },
          config: { apiKey: 'test' },
        })
        .catch((error: unknown) => error);

      expect(thrown).toMatchObject({ code: 'PROVIDER_ACCOUNT_UNAVAILABLE', status: 402 });
      expect(JSON.stringify(thrown)).not.toContain('PROVIDER_SECRET');
    },
  );

  it('does not infer account unavailability from arbitrary 4xx response text', async () => {
    const rawError = Object.assign(new Error('insufficient_credits'), {
      body: { detail: { message: 'insufficient_credits' } },
      statusCode: 402,
    });
    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({
        speechToText: { convert: vi.fn().mockRejectedValue(rawError) },
      }),
    });

    const thrown = await provider
      .transcribe({
        context: {
          recordingId: 'rec-provider-rejection',
          storageUri: 's3://bucket/audio.wav',
          getStream: async () => Readable.from(['unused']),
          getSubmissionSource: async () => ({
            kind: 'url' as const,
            url: 'https://storage.example.test/audio.wav',
          }),
        },
        config: { apiKey: 'test' },
      })
      .catch((error: unknown) => error);

    expect(thrown).toMatchObject({ code: 'PROVIDER_PERMANENT_REJECTION', status: 402 });
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
