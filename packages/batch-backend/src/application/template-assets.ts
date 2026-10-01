import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveRepoPath } from './prompt-assembly.js';

export interface TemplateAsset {
  id: string;
  absolutePath: string;
  label: string;
  content: string;
  hash: string;
}

export function resolveTemplateAssetRoot(templatePath: string): string {
  if (!templatePath.trim()) throw new Error('PROMPT_TEMPLATE_PATH must be configured.');
  return path.dirname(
    path.isAbsolute(templatePath) ? path.resolve(templatePath) : resolveRepoPath(templatePath),
  );
}

/** Same deployed files and exact UTF-8 hashing for bootstrap and admin inspection. */
export async function scanTemplateAssets(rootDir: string): Promise<TemplateAsset[]> {
  const root = path.resolve(rootDir);
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  const files = entries
    .filter(
      (entry) => entry.isFile() && ['.md', '.txt'].includes(path.extname(entry.name).toLowerCase()),
    )
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort((a, b) => a.localeCompare(b));
  return Promise.all(
    files.map(async (absolutePath) => {
      const content = await fs.readFile(absolutePath, 'utf8');
      if (content.includes('INSERT PROFILE HERE')) {
        throw new Error(
          `Template asset contains retired legacy marker INSERT PROFILE HERE: ${absolutePath}`,
        );
      }
      const id = path.relative(root, absolutePath).split(path.sep).join('/');
      const label = path.basename(id, path.extname(id)).replaceAll(/[_-]+/g, ' ').trim() || id;
      return {
        id,
        absolutePath,
        label,
        content,
        hash: createHash('sha256').update(content, 'utf8').digest('hex'),
      };
    }),
  );
}
