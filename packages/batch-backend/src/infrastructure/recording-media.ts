import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  DEFAULT_RECORDING_UPLOAD_DISK_RESERVE_BYTES,
  DEFAULT_RECORDING_UPLOAD_MAX_BYTES,
} from '@esl-pipeline/contracts';

export { DEFAULT_RECORDING_UPLOAD_DISK_RESERVE_BYTES, DEFAULT_RECORDING_UPLOAD_MAX_BYTES };

export const MAX_RECORDING_BYTES = DEFAULT_RECORDING_UPLOAD_MAX_BYTES;
export const MAX_RECORDING_DURATION_SECONDS = 6000;
export const RECORDING_PREPARATION_VERSION = 'recording-media-v1';

export type RecordingMediaErrorCode =
  | 'file_too_large'
  | 'recording_too_long'
  | 'no_audio'
  | 'corrupt_media'
  | 'unsupported_media'
  | 'multiple_audio_streams'
  | 'insufficient_upload_capacity'
  | 'preparation_failed';

export class RecordingMediaError extends Error {
  constructor(
    public readonly code: RecordingMediaErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'RecordingMediaError';
  }
}

export interface SpooledRecordingUpload {
  path: string;
  bytes: number;
  sha256: string;
  cleanup(): Promise<void>;
}

export interface RecordingFilesystemStats {
  bavail: bigint;
  bsize: bigint;
}

export type RecordingFilesystemStat = (
  temporaryDirectory: string,
) => Promise<RecordingFilesystemStats>;

/**
 * A point-in-time local admission check. It intentionally makes no cross-request reservation;
 * concurrent uploads can still consume the same observed free space.
 */
export async function ensureRecordingUploadCapacity(params: {
  temporaryDirectory?: string;
  maxBytes?: number;
  reserveBytes?: number;
  statfs?: RecordingFilesystemStat;
}): Promise<void> {
  const temporaryDirectory = params.temporaryDirectory ?? os.tmpdir();
  const maxBytes = params.maxBytes ?? MAX_RECORDING_BYTES;
  const reserveBytes = params.reserveBytes ?? DEFAULT_RECORDING_UPLOAD_DISK_RESERVE_BYTES;
  const statfs = params.statfs ?? defaultRecordingFilesystemStat;
  try {
    const stats = await statfs(temporaryDirectory);
    const availableBytes = stats.bavail * stats.bsize;
    const requiredBytes = BigInt(maxBytes) + BigInt(reserveBytes);
    if (availableBytes < requiredBytes) {
      throw new RecordingMediaError(
        'insufficient_upload_capacity',
        'The server does not currently have enough free upload capacity. Try again later.',
      );
    }
  } catch (error) {
    if (error instanceof RecordingMediaError) throw error;
    throw new RecordingMediaError(
      'preparation_failed',
      'The server could not determine upload capacity.',
      { cause: error },
    );
  }
}

export function recordRecordingUploadBytes(params: {
  currentBytes: number;
  chunkBytes: number;
  maxBytes: number;
}): number {
  const bytes = params.currentBytes + params.chunkBytes;
  if (bytes > params.maxBytes) {
    throw new RecordingMediaError(
      'file_too_large',
      `Recording exceeds maximum size of ${params.maxBytes} bytes.`,
    );
  }
  return bytes;
}

/**
 * The route-owned upload boundary. It consumes a multipart file once and leaves a
 * bounded, independently cleanable local artifact; it never constructs a file-sized Buffer.
 */
export async function spoolRecordingUpload(params: {
  input: Readable;
  temporaryDirectory?: string;
  maxBytes?: number;
  diskReserveBytes?: number;
  statfs?: RecordingFilesystemStat;
}): Promise<SpooledRecordingUpload> {
  const temporaryDirectory = params.temporaryDirectory ?? os.tmpdir();
  const maxBytes = params.maxBytes ?? MAX_RECORDING_BYTES;
  await fs.mkdir(temporaryDirectory, { recursive: true });
  await ensureRecordingUploadCapacity({
    temporaryDirectory,
    maxBytes,
    reserveBytes: params.diskReserveBytes,
    statfs: params.statfs,
  });
  const outputPath = path.join(temporaryDirectory, `recording-upload-${randomUUID()}.part`);
  const hash = createHash('sha256');
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer | string, encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      try {
        bytes = recordRecordingUploadBytes({
          currentBytes: bytes,
          chunkBytes: buffer.length,
          maxBytes,
        });
      } catch (error) {
        callback(error as Error);
        return;
      }
      hash.update(buffer);
      callback(null, buffer);
    },
  });

  try {
    await pipeline(params.input, counter, createWriteStream(outputPath, { flags: 'wx' }));
    return {
      path: outputPath,
      bytes,
      sha256: hash.digest('hex'),
      cleanup: () => removeTemporaryFile(outputPath),
    };
  } catch (error) {
    params.input.destroy();
    await removeTemporaryFile(outputPath);
    throw error;
  }
}

async function defaultRecordingFilesystemStat(
  temporaryDirectory: string,
): Promise<RecordingFilesystemStats> {
  const stats = await fs.statfs(temporaryDirectory, { bigint: true });
  return { bavail: stats.bavail, bsize: stats.bsize };
}

export interface RecordingMediaFacts {
  container: string;
  audioStreams: number;
  hasVideo: boolean;
  durationSeconds: number | null;
  audioCodec: string | null;
  channels: number | null;
  channelLayout: string | null;
  integrity: 'ok' | 'corrupt';
}

export interface RecordingMediaProcess {
  run(
    command: string,
    args: readonly string[],
    deadlineMs: number,
  ): Promise<{ stdout: string; stderr: string }>;
}

const PROCESS_OUTPUT_LIMIT = 128 * 1024;
const MEDIA_PROCESS_DEADLINE_MS = 30_000;

export const recordingMediaProcess: RecordingMediaProcess = {
  async run(command, args, deadlineMs) {
    return runBoundedMediaProcess(command, args, deadlineMs);
  },
};

export async function probeRecordingMedia(params: {
  inputPath: string;
  process?: RecordingMediaProcess;
  deadlineMs?: number;
}): Promise<RecordingMediaFacts> {
  const process = params.process ?? recordingMediaProcess;
  let stdout: string;
  try {
    ({ stdout } = await process.run(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=format_name,duration:stream=codec_type,codec_name,channels,channel_layout,duration',
        '-of',
        'json',
        params.inputPath,
      ],
      params.deadlineMs ?? MEDIA_PROCESS_DEADLINE_MS,
    ));
  } catch (error) {
    throw toProbeError(error);
  }

  try {
    const parsed = JSON.parse(stdout) as {
      format?: { format_name?: string; duration?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        channels?: number;
        channel_layout?: string;
        duration?: string;
      }>;
    };
    const streams = parsed.streams ?? [];
    const audio = streams.filter((stream) => stream.codec_type === 'audio');
    const selected = audio[0];
    const duration = parseDuration(parsed.format?.duration ?? selected?.duration);
    const container = await normalizeProbedContainer(
      parsed.format?.format_name ?? '',
      params.inputPath,
    );
    return {
      container,
      audioStreams: audio.length,
      hasVideo: streams.some((stream) => stream.codec_type === 'video'),
      durationSeconds: duration,
      audioCodec: selected?.codec_name?.toLowerCase() ?? null,
      channels: selected?.channels ?? null,
      channelLayout: selected?.channel_layout ?? null,
      integrity: 'ok',
    };
  } catch (error) {
    throw new RecordingMediaError('corrupt_media', 'Media probe returned invalid facts.', {
      cause: error,
    });
  }
}

export async function verifyRecordingAudioIntegrity(params: {
  inputPath: string;
  process?: RecordingMediaProcess;
  deadlineMs?: number;
}): Promise<void> {
  const process = params.process ?? recordingMediaProcess;
  try {
    await process.run(
      'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-xerror',
        '-i',
        params.inputPath,
        '-map',
        '0:a:0',
        '-vn',
        '-f',
        'null',
        '-',
      ],
      params.deadlineMs ?? MEDIA_PROCESS_DEADLINE_MS,
    );
  } catch (error) {
    throw new RecordingMediaError('corrupt_media', 'The recording is corrupt or truncated.', {
      cause: error,
    });
  }
}

export interface PreparedRecordingMedia {
  path: string;
  sha256: string;
  bytes: number;
  /** Bump only when preparation can affect retained bytes or provider-visible media behavior. */
  preparationVersion: typeof RECORDING_PREPARATION_VERSION;
  facts: RecordingMediaFacts;
  extension: string;
  cleanup(): Promise<void>;
}

export async function prepareRecordingMedia(params: {
  sourcePath: string;
  sourceSha256: string;
  sourceBytes: number;
  temporaryDirectory?: string;
  process?: RecordingMediaProcess;
  deadlineMs?: number;
  /** The route passes its configured source-file limit; tests may use a smaller deterministic cap. */
  maxOutputBytes?: number;
}): Promise<PreparedRecordingMedia> {
  const process = params.process ?? recordingMediaProcess;
  const facts = await probeRecordingMedia({
    inputPath: params.sourcePath,
    process,
    deadlineMs: params.deadlineMs,
  });
  const preparation = validateRecordingMedia(facts);
  await verifyRecordingAudioIntegrity({
    inputPath: params.sourcePath,
    process,
    deadlineMs: params.deadlineMs,
  });
  if (preparation.kind === 'direct') {
    return {
      path: params.sourcePath,
      sha256: params.sourceSha256,
      bytes: params.sourceBytes,
      preparationVersion: RECORDING_PREPARATION_VERSION,
      facts,
      extension: preparation.extension,
      cleanup: () => removeTemporaryFile(params.sourcePath),
    };
  }

  const temporaryDirectory = params.temporaryDirectory ?? path.dirname(params.sourcePath);
  const candidatePath = path.join(
    temporaryDirectory,
    `recording-audio-${randomUUID()}${preparation.extension}`,
  );
  try {
    await process.run(
      'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-xerror',
        '-i',
        params.sourcePath,
        '-map',
        '0:a:0',
        '-vn',
        '-c:a',
        'copy',
        candidatePath,
      ],
      params.deadlineMs ?? MEDIA_PROCESS_DEADLINE_MS,
    );
    const outputStats = await fs.stat(candidatePath);
    const maxOutputBytes = params.maxOutputBytes ?? MAX_RECORDING_BYTES;
    if (outputStats.size > maxOutputBytes) {
      throw new RecordingMediaError(
        'file_too_large',
        `Recording exceeds maximum size of ${maxOutputBytes} bytes.`,
      );
    }
    const outputFacts = await probeRecordingMedia({
      inputPath: candidatePath,
      process,
      deadlineMs: params.deadlineMs,
    });
    const outputPolicy = validateRecordingMedia(outputFacts);
    await verifyRecordingAudioIntegrity({
      inputPath: candidatePath,
      process,
      deadlineMs: params.deadlineMs,
    });
    if (
      outputPolicy.kind !== 'direct' ||
      outputFacts.audioCodec !== facts.audioCodec ||
      outputFacts.channels !== facts.channels ||
      outputFacts.durationSeconds === null ||
      facts.durationSeconds === null ||
      Math.abs(outputFacts.durationSeconds - facts.durationSeconds) > 0.1
    ) {
      throw new RecordingMediaError(
        'preparation_failed',
        'Audio stream copy did not preserve media facts.',
      );
    }
    const sha256 = await hashFile(candidatePath);
    await removeTemporaryFile(params.sourcePath);
    return {
      path: candidatePath,
      sha256,
      bytes: outputStats.size,
      preparationVersion: RECORDING_PREPARATION_VERSION,
      facts: outputFacts,
      extension: outputPolicy.extension,
      cleanup: () => removeTemporaryFile(candidatePath),
    };
  } catch (error) {
    await Promise.allSettled([
      removeTemporaryFile(candidatePath),
      removeTemporaryFile(params.sourcePath),
    ]);
    if (error instanceof RecordingMediaError) throw error;
    throw new RecordingMediaError('preparation_failed', 'Could not prepare this recording.', {
      cause: error,
    });
  }
}

export type RecordingMediaPreparation =
  | { kind: 'direct'; extension: string }
  | { kind: 'extract'; extension: '.m4a' | '.webm' };

/** Policy-only validator: facts must have been obtained from probe/decode, never client metadata. */
export function validateRecordingMedia(facts: RecordingMediaFacts): RecordingMediaPreparation {
  if (facts.integrity !== 'ok') {
    throw new RecordingMediaError('corrupt_media', 'The recording is corrupt or truncated.');
  }
  if (facts.audioStreams === 0 || !facts.audioCodec) {
    throw new RecordingMediaError('no_audio', 'The uploaded media contains no audio stream.');
  }
  if (facts.audioStreams > 1) {
    throw new RecordingMediaError(
      'multiple_audio_streams',
      'The uploaded media contains more than one audio stream.',
    );
  }
  if (facts.durationSeconds === null || !Number.isFinite(facts.durationSeconds)) {
    throw new RecordingMediaError(
      'corrupt_media',
      'The recording duration could not be determined.',
    );
  }
  if (facts.durationSeconds > MAX_RECORDING_DURATION_SECONDS) {
    throw new RecordingMediaError(
      'recording_too_long',
      `Recording exceeds maximum duration of ${MAX_RECORDING_DURATION_SECONDS} seconds.`,
    );
  }

  const container = normalizeContainer(facts.container);
  const codec = facts.audioCodec.toLowerCase();
  if (facts.hasVideo) {
    if ((container === 'mov,mp4,m4a,3gp,3g2,mj2' || container === 'mp4') && codec === 'aac') {
      return { kind: 'extract', extension: '.m4a' };
    }
    if (container === 'webm' && codec === 'opus') return { kind: 'extract', extension: '.webm' };
    throw new RecordingMediaError(
      'unsupported_media',
      'This video/audio combination is not supported.',
    );
  }

  if (container === 'mp3' && codec === 'mp3') return { kind: 'direct', extension: '.mp3' };
  // Existing deterministic WAV fixtures and the previous planned working format use PCM s16le.
  if ((container === 'wav' || container === 'wavpipe') && codec === 'pcm_s16le') {
    return { kind: 'direct', extension: '.wav' };
  }
  if (container === 'aac' && codec === 'aac') return { kind: 'direct', extension: '.aac' };
  if ((container === 'mov,mp4,m4a,3gp,3g2,mj2' || container === 'mp4') && codec === 'aac') {
    return { kind: 'direct', extension: '.m4a' };
  }
  if (container === 'ogg' && codec === 'opus') return { kind: 'direct', extension: '.ogg' };
  if (container === 'webm' && codec === 'opus') return { kind: 'direct', extension: '.webm' };
  throw new RecordingMediaError(
    'unsupported_media',
    'This media container and codec are not supported.',
  );
}

export function validateTrustedSplitChannels(params: {
  channels: number | null;
  channelLayout: string | null;
}): void {
  if (params.channels !== 2 || params.channelLayout !== 'stereo') {
    throw new RecordingMediaError(
      'unsupported_media',
      'Trusted split-channel recordings require an explicitly ordered stereo source.',
    );
  }
}

function normalizeContainer(container: string): string {
  return container.trim().toLowerCase();
}

async function normalizeProbedContainer(container: string, inputPath: string): Promise<string> {
  const normalized = normalizeContainer(container);
  if (normalized === 'matroska,webm') {
    const file = await fs.open(inputPath, 'r');
    const header = Buffer.allocUnsafe(4096);
    try {
      const { bytesRead } = await file.read(header, 0, header.length, 0);
      const docType = parseEbmlDocType(header.subarray(0, bytesRead));
      if (docType === 'webm' || docType === 'matroska') return docType;
      throw new RecordingMediaError(
        'unsupported_media',
        `Unsupported EBML DocType: ${JSON.stringify(docType)}.`,
      );
    } finally {
      await file.close();
    }
  }
  return normalized;
}

/** Reads only the bounded EBML header needed to establish the container DocType. */
function parseEbmlDocType(header: Buffer): string {
  const ebmlHeader = readEbmlElementId(header, 0);
  if (ebmlHeader.value !== 0x1a45dfa3) {
    throw new RecordingMediaError('corrupt_media', 'EBML header is missing or malformed.');
  }
  const headerSize = readEbmlDataSize(header, ebmlHeader.length);
  const headerStart = ebmlHeader.length + headerSize.length;
  const headerEnd = headerStart + headerSize.value;
  if (headerEnd > header.length) {
    throw new RecordingMediaError('corrupt_media', 'EBML header is truncated.');
  }

  let offset = headerStart;
  let docType: string | null = null;
  while (offset < headerEnd) {
    const elementId = readEbmlElementId(header, offset);
    const elementSize = readEbmlDataSize(header, offset + elementId.length);
    const valueStart = offset + elementId.length + elementSize.length;
    const valueEnd = valueStart + elementSize.value;
    if (valueEnd > headerEnd) {
      throw new RecordingMediaError('corrupt_media', 'EBML header element is truncated.');
    }
    if (elementId.value === 0x4282) {
      if (docType !== null) {
        throw new RecordingMediaError('corrupt_media', 'EBML header has multiple DocType values.');
      }
      docType = header.subarray(valueStart, valueEnd).toString('ascii');
    }
    offset = valueEnd;
  }

  if (docType === null) {
    throw new RecordingMediaError('corrupt_media', 'EBML header does not declare a DocType.');
  }
  return docType;
}

function readEbmlElementId(buffer: Buffer, offset: number): { value: number; length: number } {
  const first = buffer[offset];
  const length = ebmlVintLength(first);
  if (length === null || length > 4 || offset + length > buffer.length) {
    throw new RecordingMediaError('corrupt_media', 'EBML element ID is malformed or truncated.');
  }
  let value = 0;
  for (let index = 0; index < length; index += 1) {
    value = value * 256 + buffer[offset + index]!;
  }
  return { value, length };
}

function readEbmlDataSize(buffer: Buffer, offset: number): { value: number; length: number } {
  const first = buffer[offset];
  const length = ebmlVintLength(first);
  if (first === undefined || length === null || offset + length > buffer.length) {
    throw new RecordingMediaError('corrupt_media', 'EBML element size is malformed or truncated.');
  }
  let value = first & (0xff >>> length);
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + buffer[offset + index]!;
  }
  if (value === 2 ** (7 * length) - 1) {
    throw new RecordingMediaError('corrupt_media', 'EBML header uses an unknown-sized element.');
  }
  return { value, length };
}

function ebmlVintLength(first: number | undefined): number | null {
  if (first === undefined || first === 0) return null;
  for (let length = 1; length <= 8; length += 1) {
    if (first & (0x80 >> (length - 1))) return length;
  }
  return null;
}

function parseDuration(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function toProbeError(error: unknown): RecordingMediaError {
  if (error instanceof RecordingMediaError) return error;
  return new RecordingMediaError('corrupt_media', 'Media probe failed.', { cause: error });
}

async function hashFile(filePath: string): Promise<string> {
  const file = await fs.open(filePath, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let position = 0;
    for (;;) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return hash.digest('hex');
  } finally {
    await file.close();
  }
}

async function runBoundedMediaProcess(
  command: string,
  args: readonly string[],
  deadlineMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, [...args], { shell: false, windowsHide: true });
    } catch (error) {
      reject(error);
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else
        resolve({
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        });
    };
    const append = (target: Buffer[], chunk: Buffer, current: number): number => {
      const next = current + chunk.length;
      if (next > PROCESS_OUTPUT_LIMIT) {
        child.kill('SIGKILL');
        finish(new Error(`${command} output exceeded limit.`));
        return current;
      }
      target.push(chunk);
      return next;
    };
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`${command} timed out.`));
    }, deadlineMs);
    child.stdout.on('data', (chunk: Buffer) => {
      if (!settled) stdoutBytes = append(stdout, chunk, stdoutBytes);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (!settled) stderrBytes = append(stderr, chunk, stderrBytes);
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code === 0) finish();
      else finish(new Error(`${command} exited with code ${code ?? 'unknown'}.`));
    });
  });
}

export async function removeTemporaryFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error: unknown) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }
}
