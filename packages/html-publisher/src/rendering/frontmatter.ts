export interface Frontmatter {
  title?: string;
  icon?: string;
  student?: string;
  topic?: string;
}

export function extractFrontmatter(markdown: string): Frontmatter {
  const match = markdown.match(/^---\n[\s\S]*?\n---\n/);
  if (!match) return {};
  const block = match[0];
  const lines = block.split('\n').slice(1, -1);
  const result: Frontmatter = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(trimmed);
    if (!kv) continue;
    const key = kv[1] ?? '';
    const rawValue = kv[2] ?? '';
    const value = normalizeFrontmatterValue(rawValue);
    if (key === 'title') result.title = value;
    if (key === 'icon') result.icon = value;
    if (key === 'student') result.student = value;
    if (key === 'topic') result.topic = value;
  }

  return result;
}

export function normalizeFrontmatterValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replaceAll(/^['"]|['"]$/g, ''))
      .filter(Boolean)
      .join(', ');
  }
  return trimmed.replaceAll(/^['"]|['"]$/g, '');
}

export function extractFrontmatterTitle(markdown: string): string | null {
  const match = markdown.match(/^---\n[\s\S]*?\n---\n/);
  if (!match) return null;
  const titleMatch = match[0].match(/^\s*title:\s*(.+)\s*$/m);
  if (!titleMatch) return null;
  const raw = titleMatch[1] ? titleMatch[1].trim() : '';
  if (!raw) return null;
  return raw.replaceAll(/^['"]|['"]$/g, '');
}

export function resolveTitle(
  markdown: string,
  explicitTitle?: string,
  frontmatter?: Frontmatter,
): string {
  if (explicitTitle && explicitTitle.trim().length > 0) {
    return explicitTitle.trim();
  }
  const frontmatterTitle = frontmatter?.title ?? extractFrontmatterTitle(markdown);
  return frontmatterTitle ?? 'Untitled';
}

export function formatCurrentDate(): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());
}
