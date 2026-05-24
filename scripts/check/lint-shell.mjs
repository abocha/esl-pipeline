import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCRIPTS_DIR = join(ROOT, 'scripts');
const SHELL_FILE_PATTERN = /\.(?:sh|bash)$/;
const SHELLCHECK_ARG_CHUNK_SIZE = 100;

function collectShellFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectShellFiles(fullPath));
      continue;
    }

    if (entry.isFile() && SHELL_FILE_PATTERN.test(entry.name)) {
      files.push(relative(ROOT, fullPath));
    }
  }

  return files;
}

if (!statSync(SCRIPTS_DIR, { throwIfNoEntry: false })?.isDirectory()) {
  console.log('No scripts directory found; skipping shellcheck.');
  process.exit(0);
}

const shellFiles = collectShellFiles(SCRIPTS_DIR).sort();
if (shellFiles.length === 0) {
  console.log('No shell scripts found; skipping shellcheck.');
  process.exit(0);
}

for (let index = 0; index < shellFiles.length; index += SHELLCHECK_ARG_CHUNK_SIZE) {
  const chunk = shellFiles.slice(index, index + SHELLCHECK_ARG_CHUNK_SIZE);
  const result = spawnSync('shellcheck', chunk, {
    cwd: ROOT,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`Unable to run shellcheck: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
