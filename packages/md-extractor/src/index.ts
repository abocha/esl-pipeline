import matter from 'gray-matter';

import { ValidationError } from '@esl-pipeline/contracts';

import type { Frontmatter, Section, StudyText } from './types.js';

const NBSP = /\u00A0/g;
const ZWSP = /\u200B/g;
const BOM = /^\uFEFF/;

function normalize(md: string): string {
  return md.replace(BOM, '').replaceAll(NBSP, ' ').replaceAll(ZWSP, '').replaceAll('\r\n', '\n');
}

function findBlock(
  md: string,
  openerRegex: RegExp,
): { body: string; inlineLabel: string; markerLine: number } | null {
  const m = openerRegex.exec(md);
  if (!m) return null;
  const startIdx = m.index + m[0].length;
  // find the next line that equals ':::' at column start
  const rest = md.slice(startIdx);
  const close = rest.search(/\n[ \t]*:::\s*$/m);
  if (close === -1) return null;
  const inner = rest.slice(0, close);
  const body = inner.trim();
  const markerStart = m.index;
  const lineStart = md.lastIndexOf('\n', markerStart);
  const lineEnd = md.indexOf('\n', markerStart);
  const markerLine = md.slice(
    lineStart === -1 ? 0 : lineStart + 1,
    lineEnd === -1 ? md.length : lineEnd,
  );
  const inlineLabel = markerLine.replace(/^[ \t]*:::[^\s]+/i, '').trim();
  const markerLineNumber = md.slice(0, markerStart).split(/\r?\n/).length;
  return { body, inlineLabel, markerLine: markerLineNumber };
}

function isDialogueLine(line: string): boolean {
  // e.g., "A:", "Anna:", "[Teacher]:", "S1:", "**Teacher**:", "**Teacher:**"
  return /^\s*(?:\[([^\]]+)\]|(?:\*\*)?([A-Za-zА-Яа-яЁё0-9 _.\-]{1,32})(?:\*\*)?)\s*:(?:\*\*)?\s+/.test(
    line,
  );
}

export function extractFrontmatter(md: string): Frontmatter {
  const { data } = matter(normalize(md));
  // light runtime guard
  const fm = data as Frontmatter;
  return fm;
}

export function extractStudyText(md: string): StudyText {
  const n = normalize(md);
  const inner = findBlock(n, /(^|\n)[ \t]*:::study-text[^\n]*\n/i);
  if (!inner) throw new ValidationError('study-text block not found');
  const rawLines = inner.body.split('\n').map((s) => s.trim());
  if (inner.inlineLabel) {
    const first = rawLines[0];
    if (first && first.toLowerCase() === inner.inlineLabel.toLowerCase()) {
      rawLines.shift();
    }
  }
  const lines = rawLines.filter(Boolean);
  const dialogueCount = lines.filter((line) => isDialogueLine(line)).length;
  const type: StudyText['type'] = dialogueCount >= 2 ? 'dialogue' : 'monologue';
  return { type, lines };
}

export function extractAnswerKey(md: string): string {
  const n = normalize(md);
  const block = findBlock(n, /(^|\n)[ \t]*:::(toggle-heading|toggle-h2)\s+Answer Key[^\n]*\n/i);
  if (!block) throw new ValidationError('Answer Key toggle not found');
  return block.body;
}

export function extractTeacherNotes(md: string): string {
  const n = normalize(md);
  // Match Teacher's with any apostrophe variant: ' (U+0027), ' (U+2018), ' (U+2019)
  const block = findBlock(
    n,
    /(^|\n)[ \t]*:::(toggle-heading|toggle-h[23])\s+Teacher[\u0027\u2018\u2019]s\s+Follow-up\s+Plan[^\n]*\n/i,
  );
  if (!block) throw new ValidationError("Teacher's Follow-up Plan toggle not found");
  return block.body;
}

export function extractSections(md: string): Section[] {
  const n = normalize(md);
  const out: Section[] = [];

  // capture: 1) hashes (## or ###), 2) title text
  const headingRe = /^(#{2,3})\s+(.+)\s*$/gm;
  const positions: { depth: 2 | 3; title: string; start: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(n)) !== null) {
    const hashes = match[1] ?? ''; // TS-safe default
    const rawTitle = match[2] ?? '';
    if (!hashes || !rawTitle) continue; // skip malformed headings just in case

    const depth: 2 | 3 = hashes.length === 2 ? 2 : 3;
    const title = rawTitle.trim();
    const start = headingRe.lastIndex; // right after the heading line
    positions.push({ depth, title, start });
  }

  for (let i = 0; i < positions.length; i++) {
    const cur = positions[i]!; // we just populated these
    const next = positions[i + 1];
    const end = next ? next.start : n.length;
    const content = n.slice(cur.start, end).trim();
    out.push({ depth: cur.depth, title: cur.title, content });
  }
  return out;
}

export type { Frontmatter, StudyText, Section, SpeakerProfile } from './types.js';
