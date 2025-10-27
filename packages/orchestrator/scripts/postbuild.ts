import { chmod } from 'node:fs/promises';
import { resolve } from 'node:path';

async function ensureExecutable(file: string) {
  try {
    await chmod(file, 0o755);
  } catch (error) {
    console.warn(`[postbuild] warning: could not mark ${file} executable`, error);
  }
}

const cliPath = resolve('dist', 'bin', 'cli.js');
await ensureExecutable(cliPath);
