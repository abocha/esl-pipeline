import { createHash } from 'node:crypto';

import { sanitizeS3KeyPrefix } from './address.js';

export type ArtifactKind = 'audio-chunk' | 'audio-final' | 'html';

const ARTIFACT_KIND_TO_DIR: Record<ArtifactKind, string> = {
  'audio-chunk': 'audio/chunks',
  'audio-final': 'audio/final',
  html: 'materials/html/artifacts',
};

export function hashArtifactContent(content: string | Buffer | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export function buildArtifactKey(
  kind: ArtifactKind,
  hash: string,
  options: { prefix?: string; extension?: string } = {},
): string {
  const dir = ARTIFACT_KIND_TO_DIR[kind];
  const extension = normalizeExtension(options.extension ?? defaultExtension(kind));
  const prefix = sanitizeS3KeyPrefix(options.prefix);
  const basePath = `${dir}/${hash}.${extension}`;
  return prefix ? `${prefix}/${basePath}` : basePath;
}

function defaultExtension(kind: ArtifactKind): string {
  return kind === 'html' ? 'html' : 'mp3';
}

function normalizeExtension(extension: string): string {
  return extension.replace(/^\./, '').toLowerCase();
}
