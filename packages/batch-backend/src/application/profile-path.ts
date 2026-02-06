import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveRepoPath } from './prompt-assembly.js';

export class ProfilePathError extends Error {
  code: string;

  constructor(message: string, code = 'invalid_profile_path') {
    super(message);
    this.name = 'ProfilePathError';
    this.code = code;
  }
}

export async function resolveProfileRoot(defaultProfilePath: string): Promise<string> {
  if (!defaultProfilePath) {
    throw new ProfilePathError(
      'Prompt profile root is not configured',
      'profile_path_root_missing',
    );
  }

  const repoRoot = await fs.realpath(resolveRepoPath());
  const candidate = path.isAbsolute(defaultProfilePath)
    ? defaultProfilePath
    : path.resolve(repoRoot, defaultProfilePath);
  const rootDir = path.dirname(candidate);

  try {
    return await fs.realpath(rootDir);
  } catch {
    throw new ProfilePathError('Prompt profile root does not exist', 'profile_path_root_missing');
  }
}

export async function resolveUserProfilePath(inputPath: string, rootDir: string): Promise<string> {
  if (!inputPath || inputPath.trim().length === 0) {
    throw new ProfilePathError('profilePath is required', 'profile_path_missing');
  }

  const resolvedRoot = await fs.realpath(rootDir);
  const candidate = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(resolvedRoot, inputPath);

  let resolved: string;
  try {
    resolved = await fs.realpath(candidate);
  } catch {
    throw new ProfilePathError('profilePath does not exist', 'profile_path_not_found');
  }

  if (!isWithinRoot(resolvedRoot, resolved)) {
    throw new ProfilePathError(
      'profilePath must resolve within the configured profile root',
      'profile_path_outside_root',
    );
  }

  return resolved;
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (!relative) return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}
