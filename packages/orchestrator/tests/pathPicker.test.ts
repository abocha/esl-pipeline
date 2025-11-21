import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative as relativePath } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveDirectoryCandidates, resolveFileCandidates } from '../src/pathPicker.js';

let tempRoot: string;

beforeAll(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'path-picker-'));
  await mkdir(tempRoot, { recursive: true });

  await mkdir(join(tempRoot, 'alpha.d'));
  await mkdir(join(tempRoot, 'beta'));
  await mkdir(join(tempRoot, 'beta', 'nested'), { recursive: true });

  await writeFile(join(tempRoot, 'alpha.d', 'notes.txt'), 'notes');
  await writeFile(join(tempRoot, 'beta', 'input.d'), 'data');
  await writeFile(join(tempRoot, 'readme.md'), '# Lesson');
  await writeFile(join(tempRoot, 'song.mp3'), 'audio');
});

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

const relList = (paths: { absolute: string }[]) =>
  paths.map((entry) => relativePath(tempRoot, entry.absolute)).sort();

describe('resolveDirectoryCandidates', () => {
  it('filters directories by suffix', async () => {
    const candidates = await resolveDirectoryCandidates({
      cwd: tempRoot,
      rootStrategy: 'cwd',
      mode: 'suffix',
      suffix: '.d',
    });
    expect(relList(candidates)).toEqual(['alpha.d']);
  });

  it('filters directories by contained files', async () => {
    const candidates = await resolveDirectoryCandidates({
      cwd: tempRoot,
      rootStrategy: 'cwd',
      mode: 'contains',
      contains: 'input.d',
    });
    expect(relList(candidates)).toEqual(['beta']);
  });
});

describe('resolveFileCandidates', () => {
  it('filters files by extension', async () => {
    const candidates = await resolveFileCandidates({
      cwd: tempRoot,
      rootStrategy: 'cwd',
      extensions: ['.md'],
    });
    expect(relList(candidates)).toEqual(['readme.md']);
  });

  it('filters files by glob pattern', async () => {
    const candidates = await resolveFileCandidates({
      cwd: tempRoot,
      rootStrategy: 'cwd',
      glob: ['**/*.mp3'],
    });
    expect(relList(candidates)).toEqual(['song.mp3']);
  });
});
