#!/usr/bin/env node
import { chmod, cp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function ensureExecutable(file) {
  try {
    await chmod(file, 0o755);
  } catch (error) {
    console.warn(`[postbuild] warning: could not mark ${file} executable`, error);
  }
}

async function copySharedConfigs() {
  const repoRoot = resolve(__dirname, '../../..');
  const source = resolve(repoRoot, 'configs');
  const target = resolve(__dirname, '../dist/configs');
  try {
    await cp(source, target, { recursive: true, force: true });
  } catch (error) {
    console.warn(`[postbuild] warning: unable to copy ${source} -> ${target}`, error);
  }
}

async function copyEnvExample() {
  const repoRoot = resolve(__dirname, '../../..');
  const source = resolve(repoRoot, '.env.example');
  const target = resolve(__dirname, '../dist/.env.example');
  try {
    await cp(source, target, { dereference: true });
  } catch (error) {
    console.warn(`[postbuild] warning: unable to copy ${source} -> ${target}`, error);
  }
}

await Promise.all([
  ensureExecutable(resolve(__dirname, '../dist/cli.js')),
  copyEnvExample(),
  copySharedConfigs(),
]);
