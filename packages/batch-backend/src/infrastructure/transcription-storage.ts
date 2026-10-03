import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';

import type { SttSubmissionSource } from '@esl-pipeline/stt-core';

import { logger } from './logger.js';
import { S3StorageAdapter } from './s3-storage-adapter.js';
import { createStorageConfigService, StorageConfigurationService } from './storage-config.js';

const LOCAL_URI_PREFIX = 'local://';
const S3_URI_PREFIX = 's3://';

/** Fifteen minutes covers ordinary provider fetch latency without retaining a durable URL. */
export const DEFAULT_PROVIDER_SUBMISSION_URL_EXPIRY_SECONDS = 15 * 60;

export interface StorageWriteResult {
  uri: string;
  bytes: number;
  sha256: string;
}

export interface PutAudioOptions {
  workspaceId: string;
  recordingId: string;
  /** Immutable writer identity. A candidate is adopted by database state only. */
  candidateId?: string;
  inputPath?: string;
  stream?: Readable;
  extension?: string;
  /** Pre-registered immutable candidate location, if this write has upload-attempt authority. */
  targetUri?: string;
}

export interface PutTranscriptOptions {
  transcriptId: string;
  text: string;
}

export interface PutRawResponseOptions {
  transcriptId: string;
  json: unknown;
}

export interface PutPromptPackageOptions {
  promptPackageId: string;
  text: string;
}

export interface PutDraftOptions {
  format?: import('@esl-pipeline/contracts').AssignmentFormat;
  draftId: string;
  text: string;
}

export interface TranscriptionStorage {
  getAudioUri?(
    options: Pick<PutAudioOptions, 'workspaceId' | 'recordingId' | 'candidateId' | 'extension'>,
  ): string;
  putAudio(options: PutAudioOptions): Promise<StorageWriteResult>;
  putTranscript(options: PutTranscriptOptions): Promise<StorageWriteResult>;
  putRawResponse(options: PutRawResponseOptions): Promise<StorageWriteResult>;
  putPromptPackage(options: PutPromptPackageOptions): Promise<StorageWriteResult>;
  putDraft(options: PutDraftOptions): Promise<StorageWriteResult>;
  getText(uri: string): Promise<string>;
  getStream(uri: string): Promise<Readable>;
  getProviderSubmissionSource?(uri: string): Promise<SttSubmissionSource>;
  delete(uri: string): Promise<void>;
}

export class TranscriptionStorageSubmissionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TranscriptionStorageSubmissionError';
  }
}

export class RecordingAudioOwnershipError extends Error {
  constructor() {
    super('The retained audio URI does not belong to the claimed recording.');
    this.name = 'RecordingAudioOwnershipError';
  }
}

export function assertRecordingOwnedAudioUri(
  uri: string,
  workspaceId: string,
  recordingId: string,
): void {
  const objectPath = isLocalUri(uri) ? parseLocalUri(uri) : isS3Uri(uri) ? parseS3Uri(uri).key : '';
  const segments = objectPath.replaceAll('\\', '/').split('/');
  const ownerIndex = segments.lastIndexOf('workspaces');
  const ownedTail = ownerIndex >= 0 ? segments.slice(ownerIndex) : [];
  const validOwner =
    ownedTail[0] === 'workspaces' &&
    ownedTail[1] === workspaceId &&
    ownedTail[2] === 'recordings' &&
    ownedTail[3] === recordingId;
  const remainder = ownedTail.slice(4);
  const validWorkspaceObject =
    (remainder.length === 1 && /^audio\.[A-Za-z0-9]+$/u.test(remainder[0] ?? '')) ||
    (remainder.length === 3 &&
      remainder[0] === 'candidates' &&
      Boolean(remainder[1]) &&
      /^audio\.[A-Za-z0-9]+$/u.test(remainder[2] ?? ''));
  // Before migration 0049, recording audio used recordings/{recordingId}.{ext}.
  // Recording IDs are global UUID primary keys; S3 may also have a configured
  // prefix before that exact two-segment legacy tail.
  const legacyRecordingsIndex = segments.lastIndexOf('recordings');
  const legacyFilename = segments.at(-1) ?? '';
  const validLegacyObject =
    legacyRecordingsIndex === segments.length - 2 &&
    (isS3Uri(uri) || legacyRecordingsIndex === 0) &&
    legacyFilename.startsWith(`${recordingId}.`) &&
    /^[A-Za-z0-9]+$/u.test(legacyFilename.slice(recordingId.length + 1));
  const validObject = (validOwner && validWorkspaceObject) || validLegacyObject;
  if (!validObject || segments.some((segment) => segment === '..')) {
    throw new RecordingAudioOwnershipError();
  }
}

export interface FilesystemTranscriptionStorageDependencies {
  writeAudio?: typeof writeStreamToFile;
  removeAudioTarget?: (targetPath: string) => Promise<void>;
}

export class FilesystemTranscriptionStorage implements TranscriptionStorage {
  private baseDir: string;
  private writeAudio: typeof writeStreamToFile;
  private removeAudioTarget: (targetPath: string) => Promise<void>;

  constructor(baseDir: string, dependencies: FilesystemTranscriptionStorageDependencies = {}) {
    this.baseDir = path.resolve(baseDir);
    this.writeAudio = dependencies.writeAudio ?? writeStreamToFile;
    this.removeAudioTarget = dependencies.removeAudioTarget ?? removeOwnedLocalAudioTarget;
  }

  async putAudio(options: PutAudioOptions): Promise<StorageWriteResult> {
    const extension = resolveAudioExtension(options);
    const relativePath = buildWorkspaceAudioPath(options, extension);
    const uri = toLocalUri(relativePath);
    assertTargetUri(options.targetUri, uri);
    const targetPath = this.resolveRelativePath(relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    if (!options.inputPath && !options.stream) {
      throw new Error('putAudio requires inputPath or stream');
    }

    const inputStream = options.stream ?? createReadStream(options.inputPath!);
    let written: { bytes: number; sha256: string };
    try {
      written = await this.writeAudio(inputStream, targetPath);
    } catch (error) {
      await this.cleanupFailedAudioTarget(targetPath, error);
      throw error;
    }

    return {
      uri,
      bytes: written.bytes,
      sha256: written.sha256,
    };
  }

  getAudioUri(
    options: Pick<PutAudioOptions, 'workspaceId' | 'recordingId' | 'candidateId' | 'extension'>,
  ): string {
    return toLocalUri(buildWorkspaceAudioPath(options, resolveAudioExtension(options)));
  }

  async putTranscript(options: PutTranscriptOptions): Promise<StorageWriteResult> {
    const sha256 = hashText(options.text);
    const relativePath = path.posix.join(
      'transcripts',
      options.transcriptId,
      'content',
      `${sha256}.txt`,
    );
    return this.writeText(relativePath, options.text);
  }

  async putRawResponse(options: PutRawResponseOptions): Promise<StorageWriteResult> {
    const relativePath = path.posix.join('transcripts', `${options.transcriptId}.json`);
    const payload = JSON.stringify(options.json, null, 2);
    return this.writeText(relativePath, payload);
  }

  async putPromptPackage(options: PutPromptPackageOptions): Promise<StorageWriteResult> {
    const relativePath = path.posix.join('prompt-packages', `${options.promptPackageId}.txt`);
    return this.writeText(relativePath, options.text);
  }

  async putDraft(options: PutDraftOptions): Promise<StorageWriteResult> {
    const sha256 = hashText(options.text);
    const relativePath = path.posix.join(
      'drafts',
      options.draftId,
      'content',
      `${sha256}.${options.format === 'assignment_v1' ? 'json' : 'md'}`,
    );
    return this.writeText(relativePath, options.text);
  }

  async getText(uri: string): Promise<string> {
    const filePath = this.resolveUriToPath(uri);
    return fs.readFile(filePath, 'utf8');
  }

  async getStream(uri: string): Promise<Readable> {
    const filePath = this.resolveUriToPath(uri);
    return createReadStream(filePath);
  }

  async getProviderSubmissionSource(uri: string): Promise<SttSubmissionSource> {
    const filePath = this.resolveUriToPath(uri);
    const media = resolveProviderMediaIdentity(filePath);
    let fileStats: Awaited<ReturnType<typeof fs.stat>>;
    try {
      fileStats = await fs.stat(filePath);
    } catch (error) {
      throw new TranscriptionStorageSubmissionError(
        'Could not prepare the retained local audio for provider submission.',
        { cause: error },
      );
    }
    if (!fileStats.isFile()) {
      throw new TranscriptionStorageSubmissionError(
        'The retained local audio is not a regular file.',
      );
    }

    return {
      kind: 'file',
      path: filePath,
      filename: path.basename(filePath),
      contentType: media.contentType,
      contentLength: fileStats.size,
    };
  }

  async delete(uri: string): Promise<void> {
    const filePath = this.resolveUriToPath(uri);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }

  private async writeText(relativePath: string, text: string): Promise<StorageWriteResult> {
    const targetPath = this.resolveRelativePath(relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, text, 'utf8');
    return {
      uri: toLocalUri(relativePath),
      bytes: Buffer.byteLength(text, 'utf8'),
      sha256: hashText(text),
    };
  }

  private resolveUriToPath(uri: string): string {
    const relative = parseLocalUri(uri);
    return this.resolveRelativePath(relative);
  }

  private resolveRelativePath(relativePath: string): string {
    const normalized = path.normalize(relativePath);
    const resolved = path.resolve(this.baseDir, normalized);
    if (!isWithinBaseDir(this.baseDir, resolved)) {
      throw new Error(`Storage URI resolves outside base directory: ${relativePath}`);
    }
    return resolved;
  }

  private async cleanupFailedAudioTarget(targetPath: string, uploadError: unknown): Promise<void> {
    try {
      await this.removeAudioTarget(targetPath);
    } catch (cleanupError) {
      logger.error('Failed to remove owned local audio target after upload failure', {
        event: 'recording_audio_local_upload_cleanup_failed',
        targetPath,
        uploadError: errorMessage(uploadError),
        cleanupError: errorMessage(cleanupError),
      });
    }
  }
}

export class S3TranscriptionStorage implements TranscriptionStorage {
  private adapter: S3StorageAdapter;
  private bucket: string;
  private prefix: string;

  constructor(config: StorageConfigurationService) {
    const s3Config = config.getS3Config();
    this.bucket = s3Config.bucket;
    this.prefix = normalizePrefix(s3Config.pathPrefix);
    this.adapter = new S3StorageAdapter({ ...s3Config, pathPrefix: undefined });
  }

  async putAudio(options: PutAudioOptions): Promise<StorageWriteResult> {
    const extension = resolveAudioExtension(options);
    const relativePath = buildWorkspaceAudioPath(options, extension);
    const targetKey = this.buildKey(relativePath);
    const uri = toS3Uri(this.bucket, targetKey);
    assertTargetUri(options.targetUri, uri);

    if (!options.inputPath && !options.stream) {
      throw new Error('putAudio requires inputPath or stream');
    }

    const inputStream = options.stream ?? createReadStream(options.inputPath!);
    let written: { bytes: number; sha256: string };
    try {
      written = await writeStreamToS3({
        adapter: this.adapter,
        key: targetKey,
        input: inputStream,
        mimeType: resolveAudioMimeType(extension),
      });
    } catch (error) {
      await this.cleanupFailedAudioTarget(targetKey, error);
      throw error;
    }

    return {
      uri,
      bytes: written.bytes,
      sha256: written.sha256,
    };
  }

  getAudioUri(
    options: Pick<PutAudioOptions, 'workspaceId' | 'recordingId' | 'candidateId' | 'extension'>,
  ): string {
    return toS3Uri(
      this.bucket,
      this.buildKey(buildWorkspaceAudioPath(options, resolveAudioExtension(options))),
    );
  }

  async putTranscript(options: PutTranscriptOptions): Promise<StorageWriteResult> {
    const sha256 = hashText(options.text);
    const relativePath = path.posix.join(
      'transcripts',
      options.transcriptId,
      'content',
      `${sha256}.txt`,
    );
    return this.writeText(relativePath, options.text, 'text/plain');
  }

  async putRawResponse(options: PutRawResponseOptions): Promise<StorageWriteResult> {
    const relativePath = path.posix.join('transcripts', `${options.transcriptId}.json`);
    const payload = JSON.stringify(options.json, null, 2);
    return this.writeText(relativePath, payload, 'application/json');
  }

  async putPromptPackage(options: PutPromptPackageOptions): Promise<StorageWriteResult> {
    const relativePath = path.posix.join('prompt-packages', `${options.promptPackageId}.txt`);
    return this.writeText(relativePath, options.text, 'text/plain');
  }

  async putDraft(options: PutDraftOptions): Promise<StorageWriteResult> {
    const sha256 = hashText(options.text);
    const relativePath = path.posix.join(
      'drafts',
      options.draftId,
      'content',
      `${sha256}.${options.format === 'assignment_v1' ? 'json' : 'md'}`,
    );
    return this.writeText(
      relativePath,
      options.text,
      options.format === 'assignment_v1' ? 'application/json' : 'text/markdown',
    );
  }

  async getText(uri: string): Promise<string> {
    const stream = await this.getStream(uri);
    const buffer = await streamToBuffer(stream);
    return buffer.toString('utf8');
  }

  async getStream(uri: string): Promise<Readable> {
    const { bucket, key } = parseS3Uri(uri);
    this.ensureBucket(bucket, uri);
    return this.adapter.getObjectStream(key);
  }

  async getProviderSubmissionSource(uri: string): Promise<SttSubmissionSource> {
    const { bucket, key } = parseS3Uri(uri);
    this.ensureBucket(bucket, uri);
    resolveProviderMediaIdentity(key);

    try {
      const url = await this.adapter.generatePresignedUrl(key, {
        expiresIn: DEFAULT_PROVIDER_SUBMISSION_URL_EXPIRY_SECONDS,
      });
      if (!url) {
        throw new Error('S3 presigner returned an empty URL.');
      }
      return { kind: 'url', url };
    } catch {
      throw new TranscriptionStorageSubmissionError(
        'Could not prepare the retained S3 audio for provider submission.',
      );
    }
  }

  async delete(uri: string): Promise<void> {
    const { bucket, key } = parseS3Uri(uri);
    this.ensureBucket(bucket, uri);
    await this.adapter.deleteFile(key);
  }

  private async writeText(
    relativePath: string,
    text: string,
    mimeType: string,
  ): Promise<StorageWriteResult> {
    const targetKey = this.buildKey(relativePath);
    const buffer = Buffer.from(text, 'utf8');
    await this.adapter.uploadFile(targetKey, buffer, mimeType, buffer.length);
    return {
      uri: toS3Uri(this.bucket, targetKey),
      bytes: buffer.length,
      sha256: hashText(text),
    };
  }

  private buildKey(relativePath: string): string {
    const normalized = relativePath.replaceAll('\\', '/');
    return this.prefix ? `${this.prefix}/${normalized}` : normalized;
  }

  private ensureBucket(bucket: string, uri: string): void {
    if (bucket !== this.bucket) {
      throw new Error(`Storage URI bucket mismatch: ${uri}`);
    }
  }

  private async cleanupFailedAudioTarget(targetKey: string, uploadError: unknown): Promise<void> {
    // buildWorkspaceAudioPath includes the fresh ingest-generated recording ID, so this exact key
    // is exclusively owned by this recording write attempt and can be safely compensated.
    try {
      await this.adapter.deleteFile(targetKey);
    } catch (cleanupError) {
      logger.error('Failed to remove owned S3 audio target after upload failure', {
        event: 'recording_audio_upload_compensation_failed',
        key: targetKey,
        uploadError: errorMessage(uploadError),
        cleanupError: errorMessage(cleanupError),
      });
    }
  }
}

function buildWorkspaceAudioPath(options: PutAudioOptions, extension: string): string {
  const prefix = path.posix.join(
    'workspaces',
    options.workspaceId,
    'recordings',
    options.recordingId,
  );
  return options.candidateId
    ? path.posix.join(prefix, 'candidates', options.candidateId, `audio${extension}`)
    : path.posix.join(prefix, `audio${extension}`);
}

function assertTargetUri(expected: string | undefined, actual: string): void {
  if (expected !== undefined && expected !== actual) {
    throw new Error('Pre-registered audio target does not match the storage candidate location.');
  }
}

export function createTranscriptionStorage(options?: {
  storageConfig?: StorageConfigurationService;
}): TranscriptionStorage {
  const storageConfig = options?.storageConfig ?? createStorageConfigService();

  if (storageConfig.isS3Provider()) {
    return new S3TranscriptionStorage(storageConfig);
  }

  if (storageConfig.isFilesystemProvider()) {
    return new FilesystemTranscriptionStorage(storageConfig.getFilesystemConfig().uploadDir);
  }

  throw new Error(
    `Transcription storage provider "${storageConfig.getProvider()}" is not supported yet`,
  );
}

export function isLocalUri(uri: string): boolean {
  return uri.startsWith(LOCAL_URI_PREFIX);
}

export function isS3Uri(uri: string): boolean {
  return uri.startsWith(S3_URI_PREFIX);
}

export function createTranscriptionStorageForUri(
  uri: string,
  options?: {
    storageConfig?: StorageConfigurationService;
  },
): TranscriptionStorage {
  const storageConfig = options?.storageConfig ?? createStorageConfigService();

  if (isLocalUri(uri)) {
    return new FilesystemTranscriptionStorage(storageConfig.getFilesystemConfig().uploadDir);
  }

  if (isS3Uri(uri)) {
    return new S3TranscriptionStorage(storageConfig);
  }

  return createTranscriptionStorage({ storageConfig });
}

function resolveAudioExtension(options: PutAudioOptions): string {
  if (options.extension) {
    return normalizeExtension(options.extension);
  }

  if (options.inputPath) {
    const ext = path.extname(options.inputPath);
    return normalizeExtension(ext || '.bin');
  }

  return '.bin';
}

function normalizeExtension(extension: string): string {
  if (!extension) return '.bin';
  return extension.startsWith('.') ? extension : `.${extension}`;
}

function resolveAudioMimeType(extension: string): string {
  switch (normalizeExtension(extension).toLowerCase()) {
    case '.opus':
    case '.ogg': {
      return 'audio/ogg';
    }
    case '.mp3': {
      return 'audio/mpeg';
    }
    case '.wav': {
      return 'audio/wav';
    }
    case '.m4a': {
      return 'audio/mp4';
    }
    case '.aac': {
      return 'audio/aac';
    }
    case '.webm': {
      return 'audio/webm';
    }
    default: {
      return 'application/octet-stream';
    }
  }
}

function resolveProviderMediaIdentity(fileOrKey: string): { contentType: string } {
  const extension = path.extname(fileOrKey).toLowerCase();
  switch (extension) {
    case '.mp3':
      return { contentType: 'audio/mpeg' };
    case '.wav':
      return { contentType: 'audio/wav' };
    case '.aac':
      return { contentType: 'audio/aac' };
    case '.m4a':
      return { contentType: 'audio/mp4' };
    case '.ogg':
    case '.opus':
      return { contentType: 'audio/ogg' };
    case '.webm':
      return { contentType: 'audio/webm' };
    default:
      throw new TranscriptionStorageSubmissionError(
        'The retained audio has no supported prepared media identity.',
      );
  }
}

function normalizePrefix(prefix?: string): string {
  if (!prefix) return '';
  return prefix.replace(/^\/+/, '').replace(/\/+$/, '');
}

function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function toLocalUri(relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/');
  return `${LOCAL_URI_PREFIX}${normalized}`;
}

function toS3Uri(bucket: string, key: string): string {
  const normalized = key.replaceAll('\\', '/');
  return `${S3_URI_PREFIX}${bucket}/${normalized}`;
}

function parseLocalUri(uri: string): string {
  if (!isLocalUri(uri)) {
    throw new Error(`Unsupported storage uri: ${uri}`);
  }
  const relative = uri.slice(LOCAL_URI_PREFIX.length);
  if (!relative) {
    throw new Error(`Invalid storage uri: ${uri}`);
  }
  return relative;
}

function parseS3Uri(uri: string): { bucket: string; key: string } {
  if (!isS3Uri(uri)) {
    throw new Error(`Unsupported storage uri: ${uri}`);
  }

  const remainder = uri.slice(S3_URI_PREFIX.length);
  const [bucket, ...parts] = remainder.split('/');
  if (!bucket || parts.length === 0) {
    throw new Error(`Invalid storage uri: ${uri}`);
  }

  const key = parts.join('/');
  if (!key) {
    throw new Error(`Invalid storage uri: ${uri}`);
  }

  return { bucket, key };
}

function isWithinBaseDir(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(baseDir, targetPath);
  if (!relative) return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function removeOwnedLocalAudioTarget(targetPath: string): Promise<void> {
  await fs.rm(targetPath, { force: true });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeStreamToFile(
  input: Readable,
  targetPath: string,
): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash('sha256');
  let bytes = 0;
  const hasher = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      hash.update(buffer);
      callback(null, buffer);
    },
  });

  await pipeline(input, hasher, createWriteStream(targetPath));

  return { bytes, sha256: hash.digest('hex') };
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function writeStreamToS3(options: {
  adapter: S3StorageAdapter;
  key: string;
  input: Readable;
  mimeType: string;
}): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash('sha256');
  let bytes = 0;
  const hasher = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      hash.update(buffer);
      callback(null, buffer);
    },
  });

  const stream = options.input.pipe(hasher);
  await Promise.all([
    options.adapter.uploadFile(options.key, stream, options.mimeType),
    finished(hasher),
  ]);

  return { bytes, sha256: hash.digest('hex') };
}
