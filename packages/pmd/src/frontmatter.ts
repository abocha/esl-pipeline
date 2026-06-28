import * as yaml from 'js-yaml';

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  content: string;
}

export function parseYamlFrontmatter(input: string): ParsedFrontmatter {
  const open = '---';
  if (!input.startsWith(open) || input.charAt(open.length) === '-') {
    return { frontmatter: {}, content: input };
  }

  let source = input.slice(open.length);
  const firstLineEnd = source.indexOf('\n');
  const firstLine = firstLineEnd === -1 ? source : source.slice(0, firstLineEnd);
  const language = firstLine.trim();

  if (language.length > 0) {
    if (language !== 'yaml' && language !== 'yml') {
      throw new Error(`Unsupported frontmatter language: ${language}`);
    }
    source = firstLineEnd === -1 ? '' : source.slice(firstLineEnd + 1);
  } else if (source.startsWith('\n')) {
    source = source.slice(1);
  }

  const close = '\n---';
  const closeIndex = source.indexOf(close);
  const rawFrontmatter = closeIndex === -1 ? source : source.slice(0, closeIndex);
  let content = closeIndex === -1 ? '' : source.slice(closeIndex + close.length);

  if (content.startsWith('\n')) {
    content = content.slice(1);
  }

  const parsed = rawFrontmatter.trim().length === 0 ? {} : yaml.load(rawFrontmatter);
  return {
    frontmatter: (parsed ?? {}) as Record<string, unknown>,
    content,
  };
}
