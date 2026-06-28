import { parseYamlFrontmatter } from './frontmatter.js';
import { type ParseOptions, parsePmdDocument } from './parser.js';
import { normalizeMarkdownSource } from './source.js';
import type { ParsedMarkdownContext } from './types.js';

function normalizeNewlines(input: string): string {
  return input.replaceAll('\r\n', '\n');
}

function findContentLineOffset(rawLines: string[], contentLines: string[]): number {
  if (contentLines.length === 0) return 0;
  const maxStart = rawLines.length - contentLines.length;
  for (let start = 0; start <= maxStart; start += 1) {
    if (rawLines[start] !== contentLines[0]) continue;
    let matches = true;
    for (let i = 1; i < contentLines.length; i += 1) {
      if (rawLines[start + i] !== contentLines[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return start;
  }
  return 0;
}

export function parseMarkdownContext(
  markdown: string,
  opts: ParseOptions = {},
): ParsedMarkdownContext {
  const rawMarkdown = normalizeNewlines(markdown);
  const rawLines = rawMarkdown.split('\n');
  const normalized = normalizeMarkdownSource(rawMarkdown);
  const parsed = parseYamlFrontmatter(normalized.source);
  const content = normalizeNewlines(parsed.content);
  const contentLines = content.split('\n');
  const document = parsePmdDocument(rawMarkdown, opts);
  return {
    rawMarkdown,
    normalized,
    document,
    content,
    contentLines,
    rawLines,
    contentLineOffset: findContentLineOffset(rawLines, contentLines),
  };
}
