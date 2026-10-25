#!/usr/bin/env node
import { cp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function copySharedConfigs() {
  const source = resolve(import.meta.dirname, '../configs');
  const target = resolve(import.meta.dirname, '../dist/configs');
  await cp(source, target, { recursive: true, force: true });
}

async function stripSourcemapComment(file) {
  try {
    const source = await readFile(file, 'utf8');
    const hadTrailingNewline = source.endsWith('\n');
    const lines = source
      .split('\n')
      .filter((line) => !/^\s*\/\/[#@]\s*sourceMappingURL=/.test(line));
    const next = `${lines.join('\n')}${hadTrailingNewline ? '\n' : ''}`;
    if (next !== source) {
      await writeFile(file, next);
    }
  } catch (error) {
    console.warn(`[postbuild] warning: unable to strip sourcemap comment from ${file}`, error);
  }
}

async function stripBuiltSourcemapComments() {
  await stripSourcemapComment(resolve(import.meta.dirname, '../dist/index.js'));
}

await Promise.all([copySharedConfigs(), stripBuiltSourcemapComments()]);
