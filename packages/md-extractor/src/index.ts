import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Frontmatter, StudyText, Section } from './types.js';

const NBSP = /\u00A0/g;
const ZWSP = /\u200B/g;
const BOM = /^\uFEFF/;

function normalize(md: string): string {
  return md.replace(BOM, '').replace(NBSP, ' ').replace(ZWSP, '').replace(/\r\n/g, '\n');
}

function findBlock(md: string, openerRegex: RegExp): string | null {
  const m = openerRegex.exec(md);
  if (!m) return null;
  const startIdx = m.index + m[0].length;
  // find the next line that equals ':::' at column start
  const rest = md.slice(startIdx);
  const close = rest.search(/\n:::\s*$/m);
  if (close === -1) return null;
  const inner = rest.slice(0, close);
  return inner.trim();
}

function isDialogueLine(line: string): boolean {
  // e.g., "A:", "Anna:", "[Teacher]:", "S1:"
  return /^[\s]*[\[\(]?[A-Za-zА-Яа-яЁё0-9 _.-]{1,32}[\]\)]?:\s+/.test(line);
}

export function extractFrontmatter(md: string): Frontmatter {
  const { data } = matter(normalize(md));
  // light runtime guard
  const fm = data as Frontmatter;
  return fm;
}

export function extractStudyText(md: string): StudyText {
  const n = normalize(md);
  const inner = findBlock(n, /(^|\n):::study-text[^\n]*\n/i);
  if (!inner) throw new Error('study-text block not found');
  const rawLines = inner.split('\n').map(s => s.trim());
  const lines = rawLines.filter(Boolean);
  const dialogueCount = lines.filter(isDialogueLine).length;
  const type: StudyText['type'] = dialogueCount >= 2 ? 'dialogue' : 'monologue';
  return { type, lines };
}

export function extractAnswerKey(md: string): string {
  const n = normalize(md);
  const block = findBlock(n, /(^|\n):::toggle-heading\s+Answer Key[^\n]*\n/i);
  if (!block) throw new Error('Answer Key toggle not found');
  return block;
}

export function extractTeacherNotes(md: string): string {
  const n = normalize(md);
  // match Teacher’s / Teacher's (curly or straight apostrophe)
  const block = findBlock(n, /(^|\n):::toggle-heading\s+Teacher[’']s\s+Follow-up\s+Plan[^\n]*\n/i);
  if (!block) throw new Error("Teacher's Follow-up Plan toggle not found");
  return block;
}

export function extractSections(md: string): Section[] {
  const n = normalize(md);
  const out: Section[] = [];

  // capture: 1) hashes (## or ###), 2) title text
  const headingRe = /^(#{2,3})\s+(.+)\s*$/gm;
  const positions: Array<{ depth: 2 | 3; title: string; start: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(n)) !== null) {
    const hashes = match[1] ?? '';      // TS-safe default
    const rawTitle = match[2] ?? '';
    if (!hashes || !rawTitle) continue; // skip malformed headings just in case

    const depth: 2 | 3 = (hashes.length === 2 ? 2 : 3);
    const title = rawTitle.trim();
    const start = headingRe.lastIndex;  // right after the heading line
    positions.push({ depth, title, start });
  }

  for (let i = 0; i < positions.length; i++) {
    const cur = positions[i]!;                  // we just populated these
    const next = positions[i + 1];
    const end = next ? next.start : n.length;
    const content = n.slice(cur.start, end).trim();
    out.push({ depth: cur.depth, title: cur.title, content });
  }
  return out;
}

export type { Frontmatter, StudyText, Section } from './types.js';
