import { readFile, stat } from 'node:fs/promises';

interface CachedMarkdown {
  content: string;
  mtimeMs: number;
  size: number;
}

const markdownCache = new Map<string, CachedMarkdown>();

export async function readMarkdownCached(mdPath: string): Promise<string> {
  try {
    const stats = await stat(mdPath);
    const cached = markdownCache.get(mdPath);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.content;
    }
    const content = await readFile(mdPath, 'utf8');
    markdownCache.set(mdPath, { content, mtimeMs: stats.mtimeMs, size: stats.size });
    return content;
  } catch {
    const content = await readFile(mdPath, 'utf8');
    markdownCache.set(mdPath, { content, mtimeMs: 0, size: content.length });
    return content;
  }
}

export function resetMarkdownCache(): void {
  markdownCache.clear();
}
