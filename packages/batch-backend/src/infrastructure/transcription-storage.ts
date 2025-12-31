import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { createStorageConfigService, StorageConfigurationService } from './storage-config.js';

const LOCAL_URI_PREFIX = 'local://';

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

export function createTranscriptionStorage(options?: {
  storageConfig?: StorageConfigurationService;
}): TranscriptionStorage {
  const storageConfig = options?.storageConfig ?? createStorageConfigService();

  if (!storageConfig.isFilesystemProvider()) {
    throw new Error(
      `Transcription storage provider "${storageConfig.getProvider()}" is not supported yet`,
    );
  }

  return new FilesystemTranscriptionStorage(storageConfig.getFilesystemConfig().uploadDir);
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

function toLocalUri(relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/');
  return `${LOCAL_URI_PREFIX}${normalized}`;
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
