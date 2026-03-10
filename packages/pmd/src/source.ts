function normalizeNewlines(input: string): string {
  return input.replaceAll('\r\n', '\n');
}

export type MarkdownSourceFormat = 'canonical';

export interface NormalizedMarkdownSource {
  source: string;
  format: MarkdownSourceFormat;
}

export function normalizeMarkdownSource(markdown: string): NormalizedMarkdownSource {
  const normalized = normalizeNewlines(markdown);
  if (normalized.startsWith('\uFEFF')) {
    throw new Error('Frontmatter must start at byte 0 (no BOM).');
  }
  if (normalized.startsWith('---')) {
    return { source: normalized, format: 'canonical' };
  }
  throw new Error('Expected YAML frontmatter at byte 0.');
}
