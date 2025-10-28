import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root, RootContent, Heading } from 'mdast';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';

export type ValidateOptions = {
  strict?: boolean;
};

export type ValidateResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  meta?: {
    title: string;
    student: string;
    level: string;
    topic: string | string[];
    input_type: string;
    speaker_labels?: string[];
  };
};

const FrontSchema = z.object({
  title: z.string().min(1),
  student: z.string().min(1),
  level: z.string().min(1),
  topic: z.union([z.string().min(1), z.array(z.string().min(1))]),
  input_type: z.string().min(1),
  speaker_labels: z.array(z.string().min(1)).optional(),
});

const EXPECTED_H2 = [
  "1. This Week's Mission Briefing",
  '2. Your Homework Roadmap',
  '3. Input Material: The Source',
  '4. Language Toolkit: Useful Language',
  '5. Practice & Pronunciation',
  '6. Your Turn: Complete the Mission!',
  '7. Why This Mission Helps You',
  '8. Answer Key & Sample Mission',
  "9. Teacher's Follow-up Plan",
].map(s => normalizeHeadingText(s));

function normalizeHeadingText(s: string): string {
  // strip emoji
  const noEmoji = s.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');
  // strip zero-width: ZWSP, ZWNJ, ZWJ, WJ, VS15/VS16
  const noZW = noEmoji.replace(/[\u200B\u200C\u200D\u2060\uFE0E\uFE0F]/g, '');
  // collapse any whitespace incl NBSP into a single space
  const oneSpace = noZW.replace(/[\s\u00A0]+/g, ' ');
  return (
    oneSpace
      // keep letters/digits/space/._- quotes & colon; drop the rest
      .replace(/[^\w\s\.\-’'&:]/g, '')
      .trim()
      .toLowerCase()
  );
}

function extractFirstCodeBlock(raw: string): { lang: string; content: string } {
  // matches ```lang?\n ... \n```
  const m = raw.match(/```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)```/m);
  if (!m)
    throw new Error(
      'No fenced code block found. Output must be inside a single triple-backtick block.'
    );
  const [, lang, content] = m;
  return { lang: lang ?? '', content: content ?? '' };
}

function textFromHeading(h: Heading): string {
  const txt = (h.children ?? [])
    .map(ch => {
      // @ts-ignore
      return ch.value ?? (ch.children ? ch.children.map((c: any) => c.value ?? '').join('') : '');
    })
    .join('');
  return normalizeHeadingText(txt);
}

function findStudyTextRegion(
  source: string
): {
  body: string;
  start: number;
  end: number;
  inlineAfterMarker: string;
  markerLine: number;
} | null {
  const startIdx = source.indexOf(':::study-text');
  if (startIdx === -1) return null;
  const endIdx = source.indexOf(':::', startIdx + ':::study-text'.length);
  if (endIdx === -1) return null;
  const markerEnd = startIdx + ':::study-text'.length;
  const lineEndIdxRaw = source.indexOf('\n', markerEnd);
  const lineEndIdx = lineEndIdxRaw === -1 ? endIdx : Math.min(lineEndIdxRaw, endIdx);
  const inlineAfterMarker = source.slice(markerEnd, lineEndIdx);
  const body = source.slice(markerEnd, endIdx).trim();
  const markerLine = source
    .slice(0, startIdx)
    .split(/\r?\n/).length; /* 1-based line number for error messaging */
  return { body, start: startIdx, end: endIdx + 3, inlineAfterMarker, markerLine };
}

function parseMarkdownAst(md: string): Root {
  return unified().use(remarkParse).parse(md) as Root;
}

function collectHeadings(root: Root, depth: 2 | 3): Heading[] {
  const out: Heading[] = [];
  const stack: RootContent[] = [...(root.children as RootContent[])];
  for (const node of stack) {
    if ((node as any).type === 'heading' && (node as any).depth === depth) {
      out.push(node as any);
    }
  }
  return out;
}

function sectionSlice(root: Root, startHeading: Heading): RootContent[] {
  // return nodes after startHeading until next heading with depth <= start.depth
  const ch = root.children as RootContent[];
  const idx = ch.indexOf(startHeading as unknown as RootContent);
  const rel = ch
    .slice(idx + 1)
    .findIndex((n: any) => n.type === 'heading' && n.depth <= (startHeading as any).depth);
  const endIdx = rel === -1 ? ch.length : idx + 1 + rel;
  return ch.slice(idx + 1, endIdx);
}

export async function validateMarkdownFile(
  rawFile: string,
  opts: ValidateOptions = {}
): Promise<ValidateResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const strict = opts?.strict ?? false;

  const content = await readFile(rawFile, 'utf8');

  // 1) get the single code block
  let block: { lang: string; content: string };
  try {
    block = extractFirstCodeBlock(content);
  } catch (e: any) {
    return { ok: false, errors: [e.message], warnings };
  }
  const inside = block.content.trim();

  // 2) front matter
  const fm = matter(inside);
  const metaParse = FrontSchema.safeParse(fm.data);
  if (!metaParse.success) {
    for (const issue of metaParse.error.issues) {
      errors.push(`Front matter: ${issue.path.join('.')} - ${issue.message}`);
    }
  }
  const meta = metaParse.success ? metaParse.data : undefined;

  // 3) AST for headings & sections
  const ast = parseMarkdownAst(fm.content);

  // a) H2 order check
  const h2 = collectHeadings(ast, 2).map(textFromHeading);
  if (h2.length !== 9) {
    errors.push(`Expected 9 H2 sections, found ${h2.length}.`);
  } else {
    for (let i = 0; i < 9; i++) {
      if (h2[i] !== EXPECTED_H2[i]) {
        errors.push(`H2 #${i + 1} mismatch. Found: "${h2[i]}"`);
      }
    }
  }

  // b) markers
  const hasAnswerKeyToggle = /:::toggle-heading\s+answer\s+key/i.test(fm.content);
  const hasTeacherPlanToggle = /:::toggle-heading\s+teacher[’']s\s+follow-up\s+plan/i.test(
    fm.content
  );
  if (!hasAnswerKeyToggle) errors.push('Missing marker: ":::toggle-heading Answer Key"');
  if (!hasTeacherPlanToggle)
    errors.push('Missing marker: ":::toggle-heading Teacher’s Follow-up Plan"');

  const study = findStudyTextRegion(fm.content);
  if (!study) {
    errors.push('Missing ":::study-text ... :::" block.');
  } else {
    let studyBody = study.body;
    if (study.inlineAfterMarker.trim().length > 0) {
      const newline = studyBody.indexOf('\n');
      studyBody = newline === -1 ? '' : studyBody.slice(newline + 1).trim();
    }

    // dialogue/monologue rules
    if (meta?.speaker_labels && meta.speaker_labels.length > 0) {
      const labelSet = new Set(meta.speaker_labels.map(s => s.trim().toLowerCase()));
      const lines = studyBody
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);
      for (const [i, line] of lines.entries()) {
        const m = line.match(/^\s*(?:\[([^\]]+)\]|([A-Za-zА-Яа-яЁё0-9 _.\-]{1,32}))\s*:\s+.+$/);
        if (!m) {
          errors.push(`study-text line ${i + 1}: expected "Speaker: text", got "${line}".`);
          continue;
        }
        const who = (m[1] ?? m[2] ?? '').trim();
        if (!who) {
          errors.push(`study-text line ${i + 1}: could not extract speaker from line: "${line}".`);
          continue;
        }
        if (!labelSet.has(who.toLowerCase())) {
          errors.push(
            `study-text line ${i + 1}: unknown speaker "${who}". Allowed: [${meta.speaker_labels.join(', ')}].`
          );
        }
      }
    } else {
      // monologue: soft check — at least 3 paragraphs or 10 short lines
      const paras = studyBody.split(/\n\s*\n/).filter(p => p.trim().length > 0);
      const lines = studyBody
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);
      if (paras.length < 3 && lines.length < 10) {
        warnings.push('study-text looks short. Aim for 3–5 paragraphs or 10–15 lines.');
      }
    }
  }

  // c) Controlled Practice item count (soft check)
  const h3 = collectHeadings(ast, 3);
  const h3Map = new Map<string, Heading>();
  for (const h of h3) {
    h3Map.set(textFromHeading(h), h);
  }
  const cp = h3Map.get(normalizeHeadingText('A. Controlled Practice'));
  if (cp) {
    const nodes = sectionSlice(ast, cp);
    // count list items or numbered lines
    let count = 0;
    for (const n of nodes as any[]) {
      if (n.type === 'list') count += n.children?.length ?? 0;
      if (n.type === 'paragraph') {
        const txt = (n.children ?? []).map((c: any) => c.value ?? '').join('');
        if (/^\s*\d+\)/.test(txt) || /^\s*-\s+/.test(txt) || /^\s*\*\s+/.test(txt)) count++;
      }
    }
    if (count && (count < 8 || count > 12)) {
      warnings.push(`Controlled Practice has ${count} items (recommended 8–10).`);
    }
  } else {
    warnings.push('No "### A. Controlled Practice" section found under H2 #5.');
  }

  // d) Comprehension Check items (soft check)
  const cc = h3Map.get(normalizeHeadingText('B. Comprehension Check'));
  if (cc) {
    const nodes = sectionSlice(ast, cc);
    let count = 0;
    for (const n of nodes as any[]) {
      if (n.type === 'list') count += n.children?.length ?? 0;
      if (n.type === 'paragraph') {
        const txt = (n.children ?? []).map((c: any) => c.value ?? '').join('');
        if (/^\s*\d+\)/.test(txt) || /^\s*-\s+/.test(txt) || /^\s*\*\s+/.test(txt)) count++;
      }
    }
    if (count && count < 2) {
      warnings.push(`Comprehension Check has ${count} item(s) (recommended 2–3).`);
    }
  }

  // e) no nested code blocks inside the doc
  const codeInside = (ast.children as any[]).some(n => n.type === 'code');
  if (codeInside) {
    errors.push('Found code block(s) inside the main document. Avoid nested ``` blocks.');
  }

  if (meta?.input_type && !['generate', 'authentic'].includes(meta.input_type)) {
    warnings.push(`input_type "${meta.input_type}" is not one of "generate"|"authentic".`);
  }

  const ok = errors.length === 0 && (!strict || warnings.length === 0);

  return { ok, errors, warnings, meta: meta as any };
}
