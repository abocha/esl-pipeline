import matter from 'gray-matter';
import type { Heading, Root, RootContent } from 'mdast';
import type { PhrasingContent } from 'mdast';
import { readFile } from 'node:fs/promises';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { z } from 'zod';

import { ValidationError } from '@esl-pipeline/contracts';

export interface ValidateOptions {
  strict?: boolean;
}

export interface ValidateResult {
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
}

const FrontSchema = z.object({
  title: z.string().min(1),
  student: z.string().min(1),
  level: z.string().min(1),
  // Topic is always a single string (preprocess arrays to join with commas)
  topic: z.string().min(1),
  input_type: z.string().min(1),
  speaker_labels: z.array(z.string().min(1)).optional(),
  // New fields for advanced Notion features
  icon: z.emoji().optional(),
  cover: z.url().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  speaker_profiles: z
    .array(z.record(z.string(), z.unknown()))
    .optional(), // Already in fixtures, add for completeness
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
].map((s) => normalizeHeadingText(s));

function normalizeHeadingText(s: string): string {
  // strip emoji
  const noEmoji = s.replaceAll(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');
  // strip zero-width: ZWSP, ZWNJ, ZWJ, WJ, VS15/VS16
  const noZW = noEmoji.replaceAll(/[\u200B\u200C\u200D\u2060\uFE0E\uFE0F]/g, '');
  // collapse any whitespace incl NBSP into a single space
  const oneSpace = noZW.replaceAll(/[\s\u00A0]+/g, ' ');
  return (
    oneSpace
      // keep letters/digits/space/._- quotes & colon; drop the rest
      .replaceAll(/[^\w\s\.\-’'&:]/g, '')
      .trim()
      .toLowerCase()
  );
}

function extractFirstCodeBlock(raw: string): { lang: string; content: string } {
  // matches ```lang?\n ... \n```
  const m = raw.match(/```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)```/m);
  if (!m)
    throw new ValidationError(
      'No fenced code block found. Output must be inside a single triple-backtick block.',
    );
  const [, lang, content] = m;
  return { lang: lang ?? '', content: content ?? '' };
}

function getTextFromNode(node: PhrasingContent): string {
  if ('value' in node) {
    return node.value;
  }
  if ('children' in node && Array.isArray(node.children)) {
    return (node.children as PhrasingContent[]).map((n) => getTextFromNode(n)).join('');
  }
  return '';
}

function textFromHeading(h: Heading): string {
  const txt = (h.children ?? []).map((n) => getTextFromNode(n)).join('');
  return normalizeHeadingText(txt);
}

type StudyTextSearch =
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ok'; body: string; markerLine: number; inlineAfterMarker: string };

function validateColumnLists(source: string, errors: string[]): void {
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const trimmed = raw.trim();
    if (!/^:::column-list\b/i.test(trimmed)) continue;

    const startLine = i + 1;
    let hasColumn = false;
    let depth = 1;
    let j = i + 1;

    for (; j < lines.length; j++) {
      const line = lines[j];
      if (line === undefined) break;
      const t = line.trim();

      if (/^:::column\b/i.test(t)) {
        hasColumn = true;
        depth++;
      } else if (/^:::(column-list|callout|toggle-|study-text|synced-block)/i.test(t)) {
        depth++;
      } else if (/^:::\s*$/.test(t)) {
        depth--;
        if (depth === 0) {
          j++; // move past the closing marker
          break;
        }
      }
    }

    if (depth > 0) {
      errors.push(
        `column-list starting at line ${startLine} is missing a closing ":::" after its contents.`,
      );
      break;
    }
    if (!hasColumn) {
      errors.push(
        `column-list starting at line ${startLine} must contain at least one ":::column" section.`,
      );
    }
    i = j - 1; // skip past processed block
  }
}

interface ExtractedDirective {
  content: string[];
  endIndex: number;
  closed: boolean;
}

function extractDirectiveContent(lines: string[], startIndex: number): ExtractedDirective {
  let idx = startIndex;
  const inner: string[] = [];
  let depth = 1;

  while (idx < lines.length) {
    const line = lines[idx];
    if (line === undefined) break;
    const t = line.trim();

    if (/^:::(column|callout|toggle-|study-text|synced-block|column-list)/i.test(t)) {
      depth++;
    } else if (/^:::\s*$/.test(t)) {
      depth--;
      if (depth === 0) {
        return { content: inner, endIndex: idx + 1, closed: true };
      }
    }

    inner.push(line);
    idx++;
  }

  return { content: inner, endIndex: lines.length, closed: false };
}

function validateAdvancedDirectives(source: string, errors: string[]): void {
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const trimmed = raw.trim();

    // callout
    const calloutMatch = /^:::callout\s*(.+)?$/i.exec(trimmed);
    if (calloutMatch) {
      const icon = calloutMatch[1]?.trim() ?? '';
      const { content, endIndex, closed } = extractDirectiveContent(lines, i + 1);
      if (!closed) {
        errors.push(
          `callout starting at line ${i + 1} is missing a closing ":::" after its content.`,
        );
        break;
      }
      if (!icon) {
        errors.push(
          `callout starting at line ${i + 1} must provide an emoji/icon after ":::callout".`,
        );
      }
      const hasContent = content.some((line) => line.trim().length > 0);
      if (!hasContent) {
        errors.push(
          `callout starting at line ${i + 1} must contain content before the closing ":::" marker.`,
        );
      }
      i = endIndex - 1;
      continue;
    }

    // column-list
    if (/^:::column-list\b/i.test(trimmed)) {
      const { content, endIndex, closed } = extractDirectiveContent(lines, i + 1);
      if (!closed) {
        errors.push(
          `column-list starting at line ${i + 1} is missing a closing ":::" after its contents.`,
        );
        break;
      }
      const columns: string[][] = [];
      let current: string[] = [];
      let inColumn = false;
      for (const line of content) {
        const t = line.trim();
        if (/^:::column\b/i.test(t)) {
          if (inColumn) {
            columns.push(current);
            current = [];
          }
          inColumn = true;
        } else if (/^:::\s*$/.test(t) && inColumn) {
          columns.push(current);
          current = [];
          inColumn = false;
        } else if (inColumn) {
          current.push(line);
        }
      }
      if (inColumn) columns.push(current);
      if (columns.length === 0) {
        errors.push(
          `column-list starting at line ${i + 1} must contain at least one ":::column" section with content.`,
        );
      } else {
        const emptyIdx = columns.findIndex((col) => col.every((ln) => ln.trim().length === 0));
        if (emptyIdx !== -1) {
          errors.push(
            `column-list starting at line ${i + 1} has an empty column #${emptyIdx + 1}; add content or remove it.`,
          );
        }
      }
      i = endIndex - 1;
      continue;
    }

    // synced-block
    const syncedMatch = /^:::synced-block(?:\s+(.+))?\s*$/i.exec(trimmed);
    if (syncedMatch) {
      const syncId = syncedMatch[1]?.trim();
      const { content, endIndex, closed } = extractDirectiveContent(lines, i + 1);
      if (!closed) {
        errors.push(
          `synced-block starting at line ${i + 1} is missing a closing ":::" after its contents.`,
        );
        break;
      }
      const hasContent = content.some((line) => line.trim().length > 0);
      if (!syncId && !hasContent) {
        errors.push(
          `synced-block starting at line ${i + 1} must include content when no source block id is provided.`,
        );
      }
      i = endIndex - 1;
      continue;
    }

    // audio / video
    const audioMatch = /^:::audio\s+(.+)$/i.exec(trimmed);
    if (audioMatch) {
      const audioUrl = audioMatch[1]?.trim() ?? '';
      if (!audioUrl) {
        errors.push(`Line ${i + 1}: audio directive requires a URL after ":::audio".`);
      }
      continue;
    }
    const videoMatch = /^:::video\s+(.+)$/i.exec(trimmed);
    if (videoMatch) {
      const videoUrl = videoMatch[1]?.trim() ?? '';
      if (!videoUrl) {
        errors.push(`Line ${i + 1}: video directive requires a URL after ":::video".`);
      }
      continue;
    }

    // table rows: ensure consistent cell counts and at least one data row
    if (trimmed.startsWith('|')) {
      const tableLines: string[] = [];
      let j = i;
      while (j < lines.length && (lines[j]?.trim().startsWith('|') ?? false)) {
        tableLines.push(lines[j]!.trim());
        j++;
      }

      if (tableLines.length > 0) {
        const parseRow = (line: string) => {
          const cells = line.split('|');
          if (cells[0] === '') cells.shift();
          if (cells.at(-1) === '') cells.pop();
          return cells.map((c) => c.trim());
        };

        const rows = tableLines.map((line) => parseRow(line));
        const width = rows[0]?.length ?? 0;
        if (width === 0) {
          errors.push(`Table starting at line ${i + 1} must have at least one column.`);
        }
        const ragged = rows.findIndex((r) => r.length !== width);
        if (ragged !== -1) {
          errors.push(
            `Table starting at line ${i + 1} has inconsistent column counts (row ${
              ragged + 1
            } differs). Make all rows the same length.`,
          );
        }
        const hasHeader = rows.length >= 2 && rows[1]!.every((cell) => /^[-:]+$/.test(cell));
        const dataRows = hasHeader ? rows.slice(2) : rows.slice(1);
        if ((hasHeader && dataRows.length === 0) || rows.length === 0) {
          errors.push(`Table starting at line ${i + 1} must include at least one data row.`);
        }
      }

      i = j - 1;
      continue;
    }
  }
}

function findStudyTextRegion(source: string): StudyTextSearch {
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const exactMatch = /^:::study-text\b(.*)$/i.exec(raw);
    if (exactMatch) {
      const inlineAfterMarker = exactMatch[1] ?? '';
      const inner: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const candidate = lines[j];
        if (candidate === undefined) break;
        if (/^\s+:::\s*$/.test(candidate)) {
          return {
            status: 'error',
            message: `Line ${j + 1}: study-text closing marker must be ":::" with no leading spaces.`,
          };
        }
        if (/^:::\s*$/.test(candidate)) break;
        inner.push(candidate);
        j++;
      }
      if (j >= lines.length || !/^:::\s*$/.test(lines[j] ?? '')) {
        return {
          status: 'error',
          message: `study-text block starting at line ${i + 1} is missing a closing ":::" on its own line.`,
        };
      }
      const body = inner.join('\n').trim();
      return { status: 'ok', body, markerLine: i + 1, inlineAfterMarker };
    }

    const containsMarker = raw.toLowerCase().includes(':::study-text');
    if (containsMarker) {
      if (/^\s+:::study-text\b/i.test(raw)) {
        return {
          status: 'error',
          message: `Line ${i + 1}: study-text marker must start at column 1 with ":::study-text".`,
        };
      }
      return {
        status: 'error',
        message: `Line ${i + 1}: malformed study-text marker. Use ":::study-text" (case-insensitive) on its own line.`,
      };
    }
  }
  return { status: 'missing' };
}

function parseMarkdownAst(md: string): Root {
  return unified().use(remarkParse).parse(md) as Root;
}

function collectHeadings(root: Root, depth: 2 | 3): Heading[] {
  const out: Heading[] = [];
  for (const node of root.children) {
    if (node.type === 'heading' && node.depth === depth) {
      out.push(node);
    }
  }
  return out;
}

function sectionSlice(root: Root, startHeading: Heading): RootContent[] {
  // return nodes after startHeading until next heading with depth <= start.depth
  const ch = root.children;
  const idx = ch.indexOf(startHeading);
  const rel = ch
    .slice(idx + 1)
    .findIndex((n) => n.type === 'heading' && n.depth <= startHeading.depth);
  const endIdx = rel === -1 ? ch.length : idx + 1 + rel;
  return ch.slice(idx + 1, endIdx);
}

export async function validateMarkdownFile(
  rawFile: string,
  opts: ValidateOptions = {},
): Promise<ValidateResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const strict = opts?.strict ?? false;

  const content = await readFile(rawFile, 'utf8');

  // 1) get the single code block
  let block: { lang: string; content: string };
  try {
    block = extractFirstCodeBlock(content);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [msg], warnings };
  }
  const inside = block.content.trim();

  // 2) front matter
  const fm = matter(inside);
  // Normalize topic: if it's an array (from unquoted YAML like "topic: Grammar, Speaking"),
  // join it into a single string. Topic should always be a single value.
  if (fm.data.topic && Array.isArray(fm.data.topic)) {
    fm.data.topic = fm.data.topic.join(', ');
  }
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
  const h2 = collectHeadings(ast, 2).map((heading) => textFromHeading(heading));
  if (h2.length === 9) {
    for (let i = 0; i < 9; i++) {
      const expected = EXPECTED_H2[i];
      const actual = h2[i];
      // Relaxed check: if expected is "3. input material...", allow actual to just start with it
      // This handles "3. Input Material: The Story of Zaika"
      if (i === 2) {
        if (!actual?.startsWith('3. input material')) {
          errors.push(
            `H2 #3 mismatch. Expected to start with "3. input material", found: "${actual}"`,
          );
        }
      } else if (actual !== expected) {
        errors.push(`H2 #${i + 1} mismatch. Found: "${actual}"`);
      }
    }
  } else {
    errors.push(`Expected 9 H2 sections, found ${h2.length}.`);
  }

  // b) markers
  const hasAnswerKeyToggle = /:::(toggle-heading|toggle-h2)\s+answer\s+key/i.test(fm.content);
  // Match Teacher's with any apostrophe variant: ' (U+0027), ' (U+2018), ' (U+2019)
  const hasTeacherPlanToggle =
    /:::(toggle-heading|toggle-h[23])\s+teacher[\u0027\u2018\u2019]s\s+follow-up\s+plan/i.test(
      fm.content,
    );
  if (!hasAnswerKeyToggle)
    errors.push('Missing marker: ":::toggle-heading Answer Key" or ":::toggle-h2 Answer Key"');
  if (!hasTeacherPlanToggle)
    errors.push(
      'Missing marker: ":::toggle-heading Teacher\'s Follow-up Plan" or ":::toggle-h2/h3 Teacher\'s Follow-up Plan"',
    );

  const study = findStudyTextRegion(fm.content);
  if (study.status === 'missing') {
    errors.push('Missing ":::study-text ... :::" block.');
  } else if (study.status === 'error') {
    errors.push(study.message);
  } else {
    const studyBody = study.body;

    // dialogue/monologue rules
    const hasSpeakerLabels = Boolean(meta?.speaker_labels && meta.speaker_labels.length > 0);
    let enforceExplicitSpeakers = false;
    if (hasSpeakerLabels) {
      const labelSet = new Set(meta!.speaker_labels!.map((s) => s.trim().toLowerCase()));
      const onlyNarrator = labelSet.size === 1 && labelSet.has('narrator');
      if (!onlyNarrator) {
        enforceExplicitSpeakers = true;
        const rawLines = studyBody.split(/\r?\n/);
        let currentSpeaker: string | null = null;
        for (const [i, raw] of rawLines.entries()) {
          const line = raw.trim();
          if (!line) continue;
          // Relaxed regex: allow markdown like **Name**: or [Name]: or **Name:**
          const m = line.match(
            /^\s*(?:\[([^\]]+)\]|(?:\*\*)?([A-Za-zА-Яа-яЁё0-9 _.\-]{1,32})(?:\*\*)?)\s*:(?:\*\*)?\s+.+$/,
          );
          if (m) {
            const who = (m[1] ?? m[2] ?? '').trim();
            if (!who) {
              errors.push(
                `study-text line ${i + 1}: could not extract speaker from line: "${line}".`,
              );
              currentSpeaker = null;
              continue;
            }
            // Strip markdown from the extracted name for validation
            const cleanWho = who.replaceAll('**', '').trim();
            if (!labelSet.has(cleanWho.toLowerCase())) {
              errors.push(
                `study-text line ${i + 1}: unknown speaker "${cleanWho}". Allowed: [${meta!.speaker_labels!.join(
                  ', ',
                )}].`,
              );
            }
            currentSpeaker = cleanWho;
            continue;
          }
          if (!currentSpeaker) {
            errors.push(
              `study-text line ${i + 1}: expected "Speaker: text" or continuation, got "${line}".`,
            );
          }
        }
      }
    }

    if (!enforceExplicitSpeakers) {
      // monologue: soft check — at least 3 paragraphs or 10 short lines
      const paras = studyBody.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
      const lines = studyBody
        .split(/\r?\n/)
        .map((s) => s.trim())
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
    for (const n of nodes) {
      if (n.type === 'list') count += n.children?.length ?? 0;
      if (n.type === 'paragraph') {
        const txt = (n.children ?? [])
          .map((c) => getTextFromNode(c as PhrasingContent))
          .join('');
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
    for (const n of nodes) {
      if (n.type === 'list') count += n.children?.length ?? 0;
      if (n.type === 'paragraph') {
        const txt = (n.children ?? [])
          .map((c) => getTextFromNode(c as PhrasingContent))
          .join('');
        if (/^\s*\d+\)/.test(txt) || /^\s*-\s+/.test(txt) || /^\s*\*\s+/.test(txt)) count++;
      }
    }
    if (count && count < 2) {
      warnings.push(`Comprehension Check has ${count} item(s) (recommended 2–3).`);
    }
  }

  // e) no nested code blocks inside the doc
  const codeInside = ast.children.some((n) => n.type === 'code');
  if (codeInside) {
    warnings.push('Found code block(s) inside the main document. Avoid nested ``` blocks.');
  }

  // f) column-list blocks must contain at least one column and have a closing marker
  validateColumnLists(fm.content, errors);
  // g) advanced directives sanity checks (callout, audio/video, synced-block, tables)
  validateAdvancedDirectives(fm.content, errors);

  if (meta?.input_type && !['generate', 'authentic'].includes(meta.input_type)) {
    warnings.push(`input_type "${meta.input_type}" is not one of "generate"|"authentic".`);
  }

  // In strict mode, warnings should surface to callers that expect actionable feedback.
  if (strict && warnings.length > 0 && errors.length === 0) {
    errors.push(...warnings);
  }

  const ok = errors.length === 0 && (!strict || warnings.length === 0);

  return { ok, errors, warnings, meta };
}
