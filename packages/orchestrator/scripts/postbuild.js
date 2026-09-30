#!/usr/bin/env node
import { access, cp, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

async function copySharedConfigs() {
  const source = resolve(import.meta.dirname, '../configs');
  const target = resolve(import.meta.dirname, '../dist/configs');
  try {
    await cp(source, target, { recursive: true, force: true });
  } catch (error) {
    console.warn(`[postbuild] warning: unable to copy ${source} -> ${target}`, error);
  }
}

const SOURCE_MAP_REPLACEMENTS = [
  ['/markdown-it-anchor/permalink.js', '/markdown-it-anchor/dist/markdownItAnchor.mjs'],
  ['/markdown-it-anchor/index.js', '/markdown-it-anchor/dist/markdownItAnchor.mjs'],
  [
    '/markdown-it-toc-done-right/index.js',
    '/markdown-it-toc-done-right/dist/markdownItTocDoneRight.mjs',
  ],
];

const pathExists = async (file) => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};

const maybeReplaceSourcemapSource = async (mapFile, source) => {
  for (const [fromSuffix, toSuffix] of SOURCE_MAP_REPLACEMENTS) {
    if (!source.endsWith(fromSuffix)) continue;
    const candidate = `${source.slice(0, -fromSuffix.length)}${toSuffix}`;
    const resolvedCandidate = resolve(dirname(mapFile), candidate);
    if (await pathExists(resolvedCandidate)) {
      return candidate;
    }
  }
  return source;
};

async function normalizeSourcemapSources(mapFile) {
  try {
    const raw = await readFile(mapFile, 'utf8');
    const map = JSON.parse(raw);
    if (!Array.isArray(map.sources)) return;

    const nextSources = [];
    let changed = false;
    for (const source of map.sources) {
      if (typeof source !== 'string' || source.startsWith('http')) {
        nextSources.push(source);
        continue;
      }
      const next = await maybeReplaceSourcemapSource(mapFile, source);
      nextSources.push(next);
      if (next !== source) changed = true;
    }

    if (!changed) return;

    map.sources = nextSources;
    await writeFile(mapFile, JSON.stringify(map));
  } catch (error) {
    console.warn(`[postbuild] warning: unable to normalize sourcemap ${mapFile}`, error);
  }
}

async function normalizeBuiltSourcemaps() {
  await normalizeSourcemapSources(resolve(import.meta.dirname, '../dist/index.js.map'));
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

await Promise.all([copySharedConfigs(), normalizeBuiltSourcemaps(), stripBuiltSourcemapComments()]);
