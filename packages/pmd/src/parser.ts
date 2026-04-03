import { readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import remarkDirective from 'remark-directive';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { normalizeMarkdownSource } from './source.js';
import type {
  PmdBlock,
  PmdDirectiveBlock,
  PmdDirectiveLeaf,
  PmdDocument,
  PmdListItem,
  PmdPosition,
  PmdWarning,
} from './types.js';

export interface ParseOptions {
  includePositions?: boolean;
}

const LEAF_DIRECTIVES = new Set(['toc', 'audio', 'video']);

interface MdastNode {
  type: string;
  value?: string;
  depth?: number;
  ordered?: boolean;
  start?: number;
  checked?: boolean | null;
  lang?: string | null;
  align?: ('left' | 'center' | 'right' | null)[];
  url?: string;
  name?: string;
  label?: string;
  attributes?: Record<string, unknown>;
  children?: MdastNode[];
  position?: PmdPosition;
}

function parseFrontmatter(input: string): {
  frontmatter: Record<string, unknown>;
  content: string;
} {
  const parsed = matter(input);
  return { frontmatter: parsed.data as Record<string, unknown>, content: parsed.content };
}

function preprocessDirectives(input: string): string {
  const lines = input.split('\n');
  let inFence = false;
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;

    const match = /^(\s*):::(\S+)(.*)$/.exec(line);
    if (!match) return line;

    const indent = match[1] ?? '';
    const name = match[2] ?? '';
    const rest = match[3] ?? '';
    const restTrim = rest.trim();
    const nameLower = name.toLowerCase();

    if (LEAF_DIRECTIVES.has(nameLower)) {
      if (!restTrim) {
        return `${indent}::${name}`;
      }
      if (restTrim.startsWith('[') || restTrim.startsWith('{')) {
        return `${indent}::${name}${rest}`;
      }
      return `${indent}::${name}[${restTrim}]`;
    }

    if (!restTrim || restTrim.startsWith('[') || restTrim.startsWith('{')) {
      return line;
    }

    return `${indent}:::${name}[${restTrim}]`;
  });

  return out.join('\n');
}

function toText(node: MdastNode): string {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  if (Array.isArray(node.children)) {
    return node.children.map((child) => toText(child)).join('');
  }
  return '';
}

function pickAttributes(
  input?: Record<string, unknown>,
): Record<string, string | number | boolean> | undefined {
  if (!input) return undefined;
  const entries = Object.entries(input).filter(([, value]) => {
    return ['string', 'number', 'boolean'].includes(typeof value);
  });
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as Record<string, string | number | boolean>;
}

function mapPosition(node: MdastNode, includePositions: boolean): PmdPosition | undefined {
  if (!includePositions) return undefined;
  const position = node.position;
  if (!position) return undefined;
  return {
    start: {
      line: position.start.line,
      column: position.start.column,
      offset: position.start.offset,
    },
    end: {
      line: position.end.line,
      column: position.end.column,
      offset: position.end.offset,
    },
  };
}

function mapDirectiveBlock(node: MdastNode, includePositions: boolean): PmdDirectiveBlock {
  return {
    type: 'directive_block',
    name: (node.name ?? '').toLowerCase(),
    label: typeof node.label === 'string' ? node.label : undefined,
    attributes: pickAttributes(node.attributes),
    children: mapBlocks(node.children ?? [], includePositions),
    position: mapPosition(node, includePositions),
  };
}

function mapDirectiveLeaf(node: MdastNode, includePositions: boolean): PmdDirectiveLeaf {
  return {
    type: 'directive_leaf',
    name: (node.name ?? '').toLowerCase(),
    label: typeof node.label === 'string' ? node.label : undefined,
    attributes: pickAttributes(node.attributes),
    position: mapPosition(node, includePositions),
  };
}

function mapBlocks(nodes: MdastNode[], includePositions: boolean): PmdBlock[] {
  return nodes.map((node) => {
    switch (node.type) {
      case 'heading': {
        return {
          type: 'heading',
          depth: node.depth ?? 1,
          text: toText(node),
          position: mapPosition(node, includePositions),
        };
      }
      case 'paragraph': {
        return {
          type: 'paragraph',
          text: toText(node),
          position: mapPosition(node, includePositions),
        };
      }
      case 'list': {
        return {
          type: 'list',
          ordered: Boolean(node.ordered),
          start: node.start,
          items: mapBlocks(
            (node.children ?? []).filter((child) => child.type === 'listItem'),
            includePositions,
          ).filter((child): child is PmdListItem => child.type === 'list_item'),
          position: mapPosition(node, includePositions),
        };
      }
      case 'listItem': {
        return {
          type: 'list_item',
          checked: node.checked ?? null,
          children: mapBlocks(node.children ?? [], includePositions),
          position: mapPosition(node, includePositions),
        };
      }
      case 'code': {
        return {
          type: 'code_block',
          lang: node.lang ?? null,
          value: node.value ?? '',
          position: mapPosition(node, includePositions),
        };
      }
      case 'blockquote': {
        return {
          type: 'blockquote',
          children: mapBlocks(node.children ?? [], includePositions),
          position: mapPosition(node, includePositions),
        };
      }
      case 'thematicBreak': {
        return {
          type: 'thematic_break',
          position: mapPosition(node, includePositions),
        };
      }
      case 'table': {
        return {
          type: 'table',
          align: node.align,
          rows: (node.children ?? [])
            .filter((row) => row.type === 'tableRow')
            .map((row) =>
              (row.children ?? [])
                .filter((cell) => cell.type === 'tableCell')
                .map((cell) => toText(cell)),
            ),
          position: mapPosition(node, includePositions),
        };
      }
      case 'containerDirective': {
        return mapDirectiveBlock(node, includePositions);
      }
      case 'leafDirective':
      case 'textDirective': {
        return mapDirectiveLeaf(node, includePositions);
      }
      default: {
        return {
          type: 'unknown',
          originalType: node.type ?? 'unknown',
          value: node.value,
          position: mapPosition(node, includePositions),
        };
      }
    }
  });
}

export function parsePmdDocument(markdown: string, opts: ParseOptions = {}): PmdDocument {
  const includePositions = opts.includePositions ?? true;
  const warnings: PmdWarning[] = [];
  const normalized = normalizeMarkdownSource(markdown);
  const source = normalized.source;
  const format = normalized.format;

  const { frontmatter, content } = parseFrontmatter(source);
  const preprocessed = preprocessDirectives(content);

  const tree = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkDirective)
    .use(remarkGfm)
    .parse(preprocessed) as MdastNode;

  const body = mapBlocks(tree.children ?? [], includePositions);

  return {
    type: 'document',
    frontmatter,
    body,
    warnings,
    meta: { format },
  };
}

export async function parsePmdFromFile(
  path: string,
  opts: ParseOptions = {},
): Promise<PmdDocument> {
  const input = await readFile(path, 'utf8');
  return parsePmdDocument(input, opts);
}
