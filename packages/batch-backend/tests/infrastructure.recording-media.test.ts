import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_RECORDING_UPLOAD_DISK_RESERVE_BYTES,
  DEFAULT_RECORDING_UPLOAD_MAX_BYTES,
  ensureRecordingUploadCapacity,
  MAX_RECORDING_BYTES,
  MAX_RECORDING_DURATION_SECONDS,
  prepareRecordingMedia,
  probeRecordingMedia,
  RECORDING_PREPARATION_VERSION,
  RecordingMediaError,
  recordRecordingUploadBytes,
  spoolRecordingUpload,
  validateRecordingMedia,
  validateTrustedSplitChannels,
} from '../src/infrastructure/recording-media.js';
import { shouldReuseCachedTranscriptForFingerprint } from '../src/transport/extended-routes/recording-provider-cache.js';

const execFile = promisify(execFileCallback);
// This is deliberately an architectural streaming regression size, not the
// product upload cap. It exercises enough chunks to catch whole-file collectors
// without turning a unit test into a multi-gigabyte disk write.
const STREAMING_MEMORY_REGRESSION_BYTES = 100 * 1024 * 1024;
const statfsWithUploadCapacity = async () => ({
  bavail:
    BigInt(DEFAULT_RECORDING_UPLOAD_MAX_BYTES) +
    BigInt(DEFAULT_RECORDING_UPLOAD_DISK_RESERVE_BYTES),
  bsize: 1n,
});

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function tempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-recording-media-'));
  tempDirectories.push(directory);
  return directory;
}

async function makeFixture(directory: string, name: string, args: string[]): Promise<string> {
  const output = path.join(directory, name);
  await execFile('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...args, output]);
  return output;
}

describe('recording media boundary', () => {
  it('uses the configured 2 GiB byte boundary without allocating a multi-gigabyte fixture', () => {
    expect(
      recordRecordingUploadBytes({
        currentBytes: DEFAULT_RECORDING_UPLOAD_MAX_BYTES - 1,
        chunkBytes: 1,
        maxBytes: DEFAULT_RECORDING_UPLOAD_MAX_BYTES,
      }),
    ).toBe(DEFAULT_RECORDING_UPLOAD_MAX_BYTES);
    expect(() =>
      recordRecordingUploadBytes({
        currentBytes: DEFAULT_RECORDING_UPLOAD_MAX_BYTES,
        chunkBytes: 1,
        maxBytes: DEFAULT_RECORDING_UPLOAD_MAX_BYTES,
      }),
    ).toThrow(expect.objectContaining({ code: 'file_too_large' }));
  });

  it('admits a configured upload only when the temp filesystem retains its reserve', async () => {
    const directory = await tempDirectory();
    const boundary =
      BigInt(DEFAULT_RECORDING_UPLOAD_MAX_BYTES) +
      BigInt(DEFAULT_RECORDING_UPLOAD_DISK_RESERVE_BYTES);
    const statfs = async () => ({ bavail: boundary, bsize: 1n });

    await expect(
      ensureRecordingUploadCapacity({
        temporaryDirectory: directory,
        maxBytes: DEFAULT_RECORDING_UPLOAD_MAX_BYTES,
        reserveBytes: DEFAULT_RECORDING_UPLOAD_DISK_RESERVE_BYTES,
        statfs,
      }),
    ).resolves.toBeUndefined();

    const accepted = await spoolRecordingUpload({
      input: Readable.from([Buffer.from('small')]),
      temporaryDirectory: directory,
      statfs,
    });
    await accepted.cleanup();
    await expect(fs.readdir(directory)).resolves.toEqual([]);

    await expect(
      spoolRecordingUpload({
        input: Readable.from([Buffer.from('not-written')]),
        temporaryDirectory: directory,
        statfs: async () => ({ bavail: boundary - 1n, bsize: 1n }),
      }),
    ).rejects.toMatchObject({ code: 'insufficient_upload_capacity' });
    await expect(fs.readdir(directory)).resolves.toEqual([]);
  });

  it('fails closed when disk capacity cannot be determined and creates no spool artifact', async () => {
    const directory = await tempDirectory();
    await expect(
      spoolRecordingUpload({
        input: Readable.from([Buffer.from('small')]),
        temporaryDirectory: directory,
        statfs: async () => {
          throw new Error('statfs unavailable');
        },
      }),
    ).rejects.toMatchObject({ code: 'preparation_failed' });
    await expect(fs.readdir(directory)).resolves.toEqual([]);
  });

  it('spools chunks with a hash and never requests the whole file at once', async () => {
    const directory = await tempDirectory();
    const chunks = Array.from({ length: 64 }, (_, index) => Buffer.alloc(16 * 1024, index));
    let observedMaximum = 0;
    const source = Readable.from(
      chunks.map((chunk) => {
        observedMaximum = Math.max(observedMaximum, chunk.length);
        return chunk;
      }),
    );

    const spooled = await spoolRecordingUpload({
      input: source,
      temporaryDirectory: directory,
      statfs: statfsWithUploadCapacity,
    });
    const expectedHasher = createHash('sha256');
    for (const chunk of chunks) expectedHasher.update(chunk);
    const expected = expectedHasher.digest('hex');

    expect(spooled.bytes).toBe(64 * 16 * 1024);
    expect(spooled.sha256).toBe(expected);
    expect(observedMaximum).toBe(16 * 1024);
    await expect(fs.stat(spooled.path)).resolves.toMatchObject({ size: 64 * 16 * 1024 });
    await spooled.cleanup();
    await expect(fs.stat(spooled.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('spools a 100 MiB synthetic source incrementally with a bounded input chunk', async () => {
    const directory = await tempDirectory();
    const chunk = Buffer.alloc(64 * 1024, 7);
    const chunkCount = STREAMING_MEMORY_REGRESSION_BYTES / chunk.length;
    let emitted = 0;
    let largestChunk = 0;
    const source = new Readable({
      highWaterMark: chunk.length,
      read() {
        if (emitted === chunkCount) {
          this.push(null);
          return;
        }
        emitted += 1;
        largestChunk = Math.max(largestChunk, chunk.length);
        this.push(chunk);
      },
    });

    const spooled = await spoolRecordingUpload({
      input: source,
      temporaryDirectory: directory,
      statfs: statfsWithUploadCapacity,
    });

    expect(spooled.bytes).toBe(STREAMING_MEMORY_REGRESSION_BYTES);
    expect(emitted).toBe(chunkCount);
    expect(largestChunk).toBe(64 * 1024);
    expect(source.readableHighWaterMark).toBe(64 * 1024);
    await spooled.cleanup();
    await expect(fs.readdir(directory)).resolves.toEqual([]);
  }, 30_000);

  it('aborts over-limit streams and removes their temporary artifact', async () => {
    const directory = await tempDirectory();
    const source = Readable.from([Buffer.alloc(1024), Buffer.alloc(1)]);

    await expect(
      spoolRecordingUpload({
        input: source,
        temporaryDirectory: directory,
        maxBytes: 1024,
        statfs: statfsWithUploadCapacity,
      }),
    ).rejects.toMatchObject({
      code: 'file_too_large',
    } satisfies Partial<RecordingMediaError>);
    await expect(fs.readdir(directory)).resolves.toEqual([]);
  });

  it('removes the partial spool when the request stream disconnects', async () => {
    const directory = await tempDirectory();
    const source = new Readable({
      read() {
        this.push(Buffer.alloc(1024));
        this.destroy(new Error('client disconnected'));
      },
    });

    await expect(
      spoolRecordingUpload({
        input: source,
        temporaryDirectory: directory,
        statfs: statfsWithUploadCapacity,
      }),
    ).rejects.toThrow('client disconnected');
    await expect(fs.readdir(directory)).resolves.toEqual([]);
  });

  it('allows only the fixed direct-audio combinations and enforces duration independently', () => {
    expect(() =>
      validateRecordingMedia({
        container: 'wav',
        audioStreams: 1,
        hasVideo: false,
        durationSeconds: MAX_RECORDING_DURATION_SECONDS,
        audioCodec: 'pcm_s16le',
        channels: 2,
        channelLayout: 'stereo',
        integrity: 'ok',
      }),
    ).not.toThrow();

    expect(() =>
      validateRecordingMedia({
        container: 'wav',
        audioStreams: 1,
        hasVideo: false,
        durationSeconds: MAX_RECORDING_DURATION_SECONDS + 0.001,
        audioCodec: 'pcm_s16le',
        channels: 2,
        channelLayout: 'stereo',
        integrity: 'ok',
      }),
    ).toThrow(expect.objectContaining({ code: 'recording_too_long' }));

    expect(() =>
      validateRecordingMedia({
        container: 'webm',
        audioStreams: 1,
        hasVideo: false,
        durationSeconds: 12,
        audioCodec: 'aac',
        channels: 2,
        channelLayout: 'stereo',
        integrity: 'ok',
      }),
    ).toThrow(expect.objectContaining({ code: 'unsupported_media' }));

    expect(() =>
      validateRecordingMedia({
        container: 'ogg',
        audioStreams: 2,
        hasVideo: false,
        durationSeconds: 12,
        audioCodec: 'opus',
        channels: 2,
        channelLayout: 'stereo',
        integrity: 'ok',
      }),
    ).toThrow(expect.objectContaining({ code: 'multiple_audio_streams' }));

    expect(() =>
      validateRecordingMedia({
        container: 'mp4',
        audioStreams: 0,
        hasVideo: true,
        durationSeconds: 1,
        audioCodec: null,
        channels: null,
        channelLayout: null,
        integrity: 'ok',
      }),
    ).toThrow(expect.objectContaining({ code: 'no_audio' }));
    expect(() =>
      validateRecordingMedia({
        container: 'ogg',
        audioStreams: 1,
        hasVideo: false,
        durationSeconds: 1,
        audioCodec: 'vorbis',
        channels: 2,
        channelLayout: 'stereo',
        integrity: 'ok',
      }),
    ).toThrow(expect.objectContaining({ code: 'unsupported_media' }));
    expect(() =>
      validateRecordingMedia({
        container: 'webm',
        audioStreams: 2,
        hasVideo: true,
        durationSeconds: 1,
        audioCodec: 'opus',
        channels: 2,
        channelLayout: 'stereo',
        integrity: 'ok',
      }),
    ).toThrow(expect.objectContaining({ code: 'multiple_audio_streams' }));
    expect(() =>
      validateRecordingMedia({
        container: 'mp4',
        audioStreams: 1,
        hasVideo: true,
        durationSeconds: 1,
        audioCodec: 'mp3',
        channels: 2,
        channelLayout: 'stereo',
        integrity: 'ok',
      }),
    ).toThrow(expect.objectContaining({ code: 'unsupported_media' }));
    expect(() =>
      validateRecordingMedia({
        container: 'mp3',
        audioStreams: 1,
        hasVideo: false,
        durationSeconds: 1,
        audioCodec: 'mp3',
        channels: 2,
        channelLayout: 'stereo',
        integrity: 'corrupt',
      }),
    ).toThrow(expect.objectContaining({ code: 'corrupt_media' }));
  });

  it('keeps supported direct audio byte-identical after probe and full selected-stream decode', async () => {
    const directory = await tempDirectory();
    const source = await makeFixture(directory, 'direct.ogg', [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.1',
      '-c:a',
      'libopus',
      '-f',
      'ogg',
    ]);
    const bytes = await fs.readFile(source);
    const prepared = await prepareRecordingMedia({
      sourcePath: source,
      sourceSha256: createHash('sha256').update(bytes).digest('hex'),
      sourceBytes: bytes.length,
      temporaryDirectory: directory,
    });

    expect(prepared.path).toBe(source);
    expect(prepared.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(prepared.extension).toBe('.ogg');
    expect(prepared.preparationVersion).toBe(RECORDING_PREPARATION_VERSION);
    await prepared.cleanup();
  }, 15_000);

  it('accepts every direct-audio family without rewriting its candidate bytes', async () => {
    const directory = await tempDirectory();
    const fixtures = [
      [
        'direct.mp3',
        ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', '-c:a', 'libmp3lame'],
        '.mp3',
      ],
      [
        'direct.wav',
        ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', '-c:a', 'pcm_s16le'],
        '.wav',
      ],
      [
        'direct.aac',
        ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', '-c:a', 'aac', '-f', 'adts'],
        '.aac',
      ],
      [
        'direct.m4a',
        ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', '-c:a', 'aac', '-f', 'ipod'],
        '.m4a',
      ],
      [
        'direct.ogg',
        ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', '-c:a', 'libopus', '-f', 'ogg'],
        '.ogg',
      ],
      [
        'direct.webm',
        ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', '-c:a', 'libopus', '-f', 'webm'],
        '.webm',
      ],
    ] as const;

    for (const [name, args, extension] of fixtures) {
      const source = await makeFixture(directory, name, [...args]);
      const bytes = await fs.readFile(source);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const prepared = await prepareRecordingMedia({
        sourcePath: source,
        sourceSha256: sha256,
        sourceBytes: bytes.length,
        temporaryDirectory: directory,
      });

      expect(prepared.path).toBe(source);
      expect(prepared.extension).toBe(extension);
      expect(prepared.sha256).toBe(sha256);
      expect(prepared.bytes).toBe(bytes.length);
      await prepared.cleanup();
      await expect(fs.stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  }, 60_000);

  it('maps failed and timed-out probes plus selected-stream decode failure to corrupt_media', async () => {
    const directory = await tempDirectory();
    const source = path.join(directory, 'source.bin');
    await fs.writeFile(source, 'synthetic');
    const failureCases = [
      {
        name: 'probe failure',
        process: {
          run: async () => {
            throw new Error('ffprobe exited');
          },
        },
      },
      {
        name: 'probe timeout',
        process: {
          run: async () => {
            throw new Error('ffprobe timed out');
          },
        },
      },
      {
        name: 'integrity failure',
        process: {
          run: async (command: string) => {
            if (command === 'ffmpeg') throw new Error('ffmpeg exited');
            return {
              stdout: JSON.stringify({
                format: { format_name: 'mp3', duration: '1' },
                streams: [{ codec_type: 'audio', codec_name: 'mp3', channels: 1 }],
              }),
              stderr: '',
            };
          },
        },
      },
    ] as const;

    for (const testCase of failureCases) {
      await expect(
        prepareRecordingMedia({
          sourcePath: source,
          sourceSha256: 'a'.repeat(64),
          sourceBytes: 9,
          process: testCase.process,
        }),
      ).rejects.toMatchObject({ code: 'corrupt_media' });
    }
    // The route owns the direct source until its finally block; this models that owner explicitly.
    await fs.unlink(source);
    await expect(fs.readdir(directory)).resolves.toEqual([]);
  });

  it('rejects generated no-audio, multi-audio, unsupported, and truncated media with stable codes', async () => {
    const directory = await tempDirectory();
    const noAudio = await makeFixture(directory, 'no-audio.mp4', [
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=16x16:d=0.1',
      '-an',
      '-c:v',
      'mpeg4',
    ]);
    const multipleAudio = await makeFixture(directory, 'multiple-audio.mp4', [
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=16x16:d=0.1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=880:duration=0.1',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-map',
      '2:a:0',
      '-shortest',
      '-c:v',
      'mpeg4',
      '-c:a',
      'aac',
    ]);
    const unsupported = await makeFixture(directory, 'unsupported.flac', [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.1',
      '-c:a',
      'flac',
    ]);
    const validMp3 = await makeFixture(directory, 'valid.mp3', [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.1',
      '-c:a',
      'libmp3lame',
    ]);
    const truncated = path.join(directory, 'truncated.mp3');
    const validBytes = await fs.readFile(validMp3);
    await fs.writeFile(truncated, validBytes.subarray(0, 32));

    for (const [sourcePath, code] of [
      [noAudio, 'no_audio'],
      [multipleAudio, 'multiple_audio_streams'],
      [unsupported, 'unsupported_media'],
      [truncated, 'corrupt_media'],
    ] as const) {
      const bytes = await fs.readFile(sourcePath);
      await expect(
        prepareRecordingMedia({
          sourcePath,
          sourceSha256: createHash('sha256').update(bytes).digest('hex'),
          sourceBytes: bytes.length,
          temporaryDirectory: directory,
        }),
      ).rejects.toMatchObject({ code });
      await fs.unlink(sourcePath);
    }
    await fs.unlink(validMp3);
    await expect(fs.readdir(directory)).resolves.toEqual([]);
  }, 45_000);

  it('requires the durable preparation version in the transcript cache fingerprint', () => {
    const base = {
      effectiveProvider: 'elevenlabs' as const,
      audioTopology: 'mixed_recording' as const,
      sttRequestProfile: 'mixed-recording-elevenlabs-scribe-v2-v1',
      mode: 'timeline' as const,
      model: 'scribe_v2',
      language: 'auto',
      preparationVersion: RECORDING_PREPARATION_VERSION,
      transcript: {
        sttProvider: 'elevenlabs' as const,
        mode: 'timeline' as const,
        model: 'scribe_v2',
        language: 'auto',
        summaryJson: {
          audioTopology: 'mixed_recording',
          sttRequestProfile: 'mixed-recording-elevenlabs-scribe-v2-v1',
          mediaPreparationVersion: RECORDING_PREPARATION_VERSION,
        },
      },
    };

    expect(shouldReuseCachedTranscriptForFingerprint(base)).toBe(true);
    expect(
      shouldReuseCachedTranscriptForFingerprint({
        ...base,
        preparationVersion: 'recording-media-v2',
      }),
    ).toBe(false);
    expect(
      shouldReuseCachedTranscriptForFingerprint({
        ...base,
        transcript: {
          ...base.transcript,
          summaryJson: {
            audioTopology: 'mixed_recording',
            sttRequestProfile: 'mixed-recording-elevenlabs-scribe-v2-v1',
          },
        },
      }),
    ).toBe(false);
  });

  it('stream-copies only the audio from allowed MP4/AAC video and removes the source video', async () => {
    const directory = await tempDirectory();
    const source = await makeFixture(directory, 'source.mp4', [
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=16x16:d=0.2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.2',
      '-shortest',
      '-c:v',
      'mpeg4',
      '-c:a',
      'aac',
    ]);
    const sourceBytes = await fs.readFile(source);
    const prepared = await prepareRecordingMedia({
      sourcePath: source,
      sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
      sourceBytes: sourceBytes.length,
      temporaryDirectory: directory,
    });

    expect(prepared.extension).toBe('.m4a');
    expect(prepared.facts).toMatchObject({ hasVideo: false, audioCodec: 'aac', channels: 1 });
    await expect(fs.stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(probeRecordingMedia({ inputPath: prepared.path })).resolves.toMatchObject({
      hasVideo: false,
      audioCodec: 'aac',
      channels: 1,
    });
    await prepared.cleanup();
  }, 30_000);

  it('stream-copies the other approved video families and leaves no source video', async () => {
    const directory = await tempDirectory();
    const fixtures = [
      [
        'source.mov',
        [
          '-f',
          'lavfi',
          '-i',
          'color=c=black:s=16x16:d=0.1',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:duration=0.1',
          '-shortest',
          '-c:v',
          'mpeg4',
          '-c:a',
          'aac',
        ],
        '.m4a',
        'aac',
      ],
      [
        'source.webm',
        [
          '-f',
          'lavfi',
          '-i',
          'color=c=black:s=16x16:d=0.1',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:duration=0.1',
          '-shortest',
          '-c:v',
          'libvpx',
          '-c:a',
          'libopus',
        ],
        '.webm',
        'opus',
      ],
    ] as const;

    for (const [name, args, extension, codec] of fixtures) {
      const source = await makeFixture(directory, name, [...args]);
      const sourceBytes = await fs.readFile(source);
      const prepared = await prepareRecordingMedia({
        sourcePath: source,
        sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
        sourceBytes: sourceBytes.length,
        temporaryDirectory: directory,
      });

      expect(prepared.extension).toBe(extension);
      expect(prepared.facts).toMatchObject({ hasVideo: false, audioCodec: codec, channels: 1 });
      await expect(fs.stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
      await prepared.cleanup();
    }
  }, 45_000);

  it('removes video source and candidate when extraction or output re-probe fails', async () => {
    const directory = await tempDirectory();
    const source = path.join(directory, 'source.mp4');
    await fs.writeFile(source, 'synthetic');
    const facts = JSON.stringify({
      format: { format_name: 'mp4', duration: '1' },
      streams: [
        { codec_type: 'video' },
        { codec_type: 'audio', codec_name: 'aac', channels: 2, channel_layout: 'stereo' },
      ],
    });
    const extractionFailure = {
      run: async (_command: string, args: readonly string[]) => {
        if (args.includes('-c:a')) throw new Error('copy failed');
        return { stdout: facts, stderr: '' };
      },
    };

    await expect(
      prepareRecordingMedia({
        sourcePath: source,
        sourceSha256: 'a'.repeat(64),
        sourceBytes: 9,
        process: extractionFailure,
      }),
    ).rejects.toMatchObject({ code: 'preparation_failed' });
    await expect(fs.readdir(directory)).resolves.toEqual([]);

    const realSource = await makeFixture(directory, 'retry.mp4', [
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=16x16:d=0.1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.1',
      '-shortest',
      '-c:v',
      'mpeg4',
      '-c:a',
      'aac',
    ]);
    const realBytes = await fs.readFile(realSource);
    const reProbeFailure = {
      run: async (command: string, args: readonly string[], deadlineMs: number) => {
        if (command === 'ffprobe' && args.at(-1) !== realSource)
          throw new Error('output probe failed');
        return (await import('../src/infrastructure/recording-media.js')).recordingMediaProcess.run(
          command,
          args,
          deadlineMs,
        );
      },
    };
    await expect(
      prepareRecordingMedia({
        sourcePath: realSource,
        sourceSha256: createHash('sha256').update(realBytes).digest('hex'),
        sourceBytes: realBytes.length,
        temporaryDirectory: directory,
        process: reProbeFailure,
      }),
    ).rejects.toMatchObject({ code: 'corrupt_media' });
    await expect(fs.readdir(directory)).resolves.toEqual([]);
  }, 30_000);

  it('rejects an extracted artifact above its bounded output limit and cleans both artifacts', async () => {
    const directory = await tempDirectory();
    const source = await makeFixture(directory, 'bounded.mp4', [
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=16x16:d=0.1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.1',
      '-shortest',
      '-c:v',
      'mpeg4',
      '-c:a',
      'aac',
    ]);
    const sourceBytes = await fs.readFile(source);

    await expect(
      prepareRecordingMedia({
        sourcePath: source,
        sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
        sourceBytes: sourceBytes.length,
        temporaryDirectory: directory,
        maxOutputBytes: 1,
      }),
    ).rejects.toMatchObject({ code: 'file_too_large' });
    await expect(fs.readdir(directory)).resolves.toEqual([]);
  }, 30_000);

  it('accepts only explicit trusted stereo and leaves ordinary media policy independent', () => {
    expect(() =>
      validateTrustedSplitChannels({ channels: 2, channelLayout: 'stereo' }),
    ).not.toThrow();
    expect(() => validateTrustedSplitChannels({ channels: 1, channelLayout: 'mono' })).toThrow(
      expect.objectContaining({ code: 'unsupported_media' }),
    );
    expect(() => validateTrustedSplitChannels({ channels: 2, channelLayout: null })).toThrow(
      expect.objectContaining({ code: 'unsupported_media' }),
    );
    expect(() => validateTrustedSplitChannels({ channels: 4, channelLayout: '4.0' })).toThrow(
      expect.objectContaining({ code: 'unsupported_media' }),
    );
    expect(() =>
      validateRecordingMedia({
        container: 'ogg',
        audioStreams: 1,
        hasVideo: false,
        durationSeconds: 1,
        audioCodec: 'opus',
        channels: 1,
        channelLayout: 'mono',
        integrity: 'ok',
      }),
    ).not.toThrow();
  });

  it('classifies Matroska/WebM only from the EBML DocType', async () => {
    const directory = await tempDirectory();
    const probeProcess = {
      run: async () => ({
        stdout: JSON.stringify({
          format: { format_name: 'matroska,webm', duration: '1' },
          streams: [{ codec_type: 'audio', codec_name: 'opus', channels: 2 }],
        }),
        stderr: '',
      }),
    };
    const webm = path.join(directory, 'genuine.webm');
    const matroska = path.join(directory, 'deceptive.mkv');
    await fs.writeFile(webm, ebmlHeader('webm'));
    await fs.writeFile(
      matroska,
      Buffer.concat([ebmlHeader('matroska'), Buffer.from('webm metadata')]),
    );

    const webmFacts = await probeRecordingMedia({ inputPath: webm, process: probeProcess });
    const matroskaFacts = await probeRecordingMedia({ inputPath: matroska, process: probeProcess });

    expect(webmFacts).toMatchObject({ container: 'webm' });
    expect(() => validateRecordingMedia(webmFacts)).not.toThrow();
    expect(matroskaFacts).toMatchObject({ container: 'matroska' });
    expect(() => validateRecordingMedia(matroskaFacts)).toThrow(
      expect.objectContaining({ code: 'unsupported_media' }),
    );
  });

  it('rejects a real Matroska/Opus fixture even when metadata says webm', async () => {
    const directory = await tempDirectory();
    const source = await makeFixture(directory, 'deceptive.mkv', [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.1',
      '-c:a',
      'libopus',
      '-metadata',
      'title=webm',
      '-f',
      'matroska',
    ]);
    const bytes = await fs.readFile(source);

    await expect(probeRecordingMedia({ inputPath: source })).resolves.toMatchObject({
      container: 'matroska',
      audioCodec: 'opus',
    });
    await expect(
      prepareRecordingMedia({
        sourcePath: source,
        sourceSha256: createHash('sha256').update(bytes).digest('hex'),
        sourceBytes: bytes.length,
      }),
    ).rejects.toMatchObject({ code: 'unsupported_media' });
    await fs.unlink(source);
  }, 15_000);

  it('rejects malformed or truncated EBML headers instead of guessing WebM', async () => {
    const directory = await tempDirectory();
    const truncated = path.join(directory, 'truncated.webm');
    await fs.writeFile(truncated, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x8a, 0x42, 0x82, 0x84]));

    await expect(
      probeRecordingMedia({
        inputPath: truncated,
        process: {
          run: async () => ({
            stdout: JSON.stringify({
              format: { format_name: 'matroska,webm', duration: '1' },
              streams: [{ codec_type: 'audio', codec_name: 'opus', channels: 2 }],
            }),
            stderr: '',
          }),
        },
      }),
    ).rejects.toMatchObject({ code: 'corrupt_media' });
  });
});

function ebmlHeader(docType: string): Buffer {
  const value = Buffer.from(docType, 'ascii');
  const docTypeElement = Buffer.concat([Buffer.from([0x42, 0x82, 0x80 | value.length]), value]);
  return Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80 | docTypeElement.length]),
    docTypeElement,
  ]);
}
