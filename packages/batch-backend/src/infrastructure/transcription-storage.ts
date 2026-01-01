import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';

import { S3StorageAdapter } from './s3-storage-adapter.js';
import { createStorageConfigService, StorageConfigurationService } from './storage-config.js';

const LOCAL_URI_PREFIX = 'local://';
const S3_URI_PREFIX = 's3://';

export interface StorageWriteResult {
  uri: string;
  bytes: number;
  sha256?: string;
}

export interface PutAudioOptions {
  recordingId: string;
  inputPath?: string;
  stream?: Readable;
  extension?: string;
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
  draftId: string;
  text: string;
}

export interface TranscriptionStorage {
  putAudio(options: PutAudioOptions): Promise<StorageWriteResult>;
  putTranscript(options: PutTranscriptOptions): Promise<StorageWriteResult>;
  putRawResponse(options: PutRawResponseOptions): Promise<StorageWriteResult>;
  putPromptPackage(options: PutPromptPackageOptions): Promise<StorageWriteResult>;
  putDraft(options: PutDraftOptions): Promise<StorageWriteResult>;
  getText(uri: string): Promise<string>;
  getStream(uri: string): Promise<Readable>;
  delete(uri: string): Promise<void>;
}

export class FilesystemTranscriptionStorage implements TranscriptionStorage {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
  }

  async putAudio(options: PutAudioOptions): Promise<StorageWriteResult> {
    const extension = resolveAudioExtension(options);
    const relativePath = path.posix.join('recordings', `${options.recordingId}${extension}`);
    const targetPath = this.resolveRelativePath(relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    if (!options.inputPath && !options.stream) {
      throw new Error('putAudio requires inputPath or stream');
    }

    const inputStream = options.stream ?? createReadStream(options.inputPath!);
    const { bytes, sha256 } = await writeStreamToFile(inputStream, targetPath);

    return {
      uri: toLocalUri(relativePath),
      bytes,
      sha256,
    };
  }

  async putTranscript(options: PutTranscriptOptions): Promise<StorageWriteResult> {
    const relativePath = path.posix.join('transcripts', `${options.transcriptId}.txt`);
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
    const relativePath = path.posix.join('drafts', `${options.draftId}.md`);
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
    const relativePath = path.posix.join('recordings', `${options.recordingId}${extension}`);
    const targetKey = this.buildKey(relativePath);

    if (!options.inputPath && !options.stream) {
      throw new Error('putAudio requires inputPath or stream');
    }

    const inputStream = options.stream ?? createReadStream(options.inputPath!);
    const { bytes, sha256 } = await writeStreamToS3({
      adapter: this.adapter,
      key: targetKey,
      input: inputStream,
      mimeType: resolveAudioMimeType(extension),
    });

    return {
      uri: toS3Uri(this.bucket, targetKey),
      bytes,
      sha256,
    };
  }

  async putTranscript(options: PutTranscriptOptions): Promise<StorageWriteResult> {
    const relativePath = path.posix.join('transcripts', `${options.transcriptId}.txt`);
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
    const relativePath = path.posix.join('drafts', `${options.draftId}.md`);
    return this.writeText(relativePath, options.text, 'text/markdown');
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
    case '.opus': {
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
    default: {
      return 'application/octet-stream';
    }
  }
}

function normalizePrefix(prefix?: string): string {
  if (!prefix) return '';
  return prefix.replace(/^\/+/, '').replace(/\/+$/, '');
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
  if (!uri.startsWith(LOCAL_URI_PREFIX)) {
    throw new Error(`Unsupported storage uri: ${uri}`);
  }
  const relative = uri.slice(LOCAL_URI_PREFIX.length);
  if (!relative) {
    throw new Error(`Invalid storage uri: ${uri}`);
  }
  return relative;
}

function parseS3Uri(uri: string): { bucket: string; key: string } {
  if (!uri.startsWith(S3_URI_PREFIX)) {
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
