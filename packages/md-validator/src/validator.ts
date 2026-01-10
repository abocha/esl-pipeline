import matter from 'gray-matter';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

import type {
  PmdBlock,
  PmdDirectiveBlock,
  PmdDirectiveLeaf,
  PmdDocument,
  PmdHeading,
} from '@esl-pipeline/pmd';
import { findDirectiveBlocks, parsePmdDocument } from '@esl-pipeline/pmd';

export interface ValidateOptions {
  strict?: boolean;
  /**
   * Optional preloaded markdown content to avoid fs reads.
   */
  content?: string;
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
  speaker_profiles: z.array(z.record(z.string(), z.unknown())).optional(), // Already in fixtures, add for completeness
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

function normalizeNewlines(input: string): string {
  return input.replaceAll('\r\n', '\n');
}

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

function extractLegacyFence(input: string): string {
  const lines = input.split('\n');
  const opener = lines[0] ?? '';
  if (!opener.startsWith('```')) {
    throw new Error('Legacy fenced markdown must start with ``` at byte 0.');
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? '').trim() === '```') {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    throw new Error('Legacy fenced markdown must include a closing ``` fence.');
  }

  const after = lines.slice(closingIndex + 1);
  const hasExtraContent = after.some((line) => line.trim().length > 0);
  if (hasExtraContent) {
    throw new Error('Legacy fenced markdown must not include content outside the fence.');
  }

  return lines.slice(1, closingIndex).join('\n');
}

function resolveSource(markdown: string): { source: string; format: 'canonical' | 'legacy-fenced' } {
  const normalized = normalizeNewlines(markdown);
  if (normalized.startsWith('---')) {
    return { source: normalized, format: 'canonical' };
  }
  if (normalized.startsWith('```')) {
    return { source: extractLegacyFence(normalized), format: 'legacy-fenced' };
  }
  if (normalized.startsWith('\uFEFF')) {
    throw new Error('Frontmatter must start at byte 0 (no BOM).');
  }
  throw new Error('Expected YAML frontmatter at byte 0 or a legacy fenced block.');
}

function collectHeadings(body: PmdBlock[], depth: 2 | 3): PmdHeading[] {
  return body.filter((block) => block.type === 'heading' && block.depth === depth) as PmdHeading[];
}

function sectionSlice(body: PmdBlock[], startHeading: PmdHeading): PmdBlock[] {
  const idx = body.indexOf(startHeading);
  if (idx === -1) return [];
  const rel = body.slice(idx + 1).findIndex((n) => n.type === 'heading' && n.depth <= startHeading.depth);
  const endIdx = rel === -1 ? body.length : idx + 1 + rel;
  return body.slice(idx + 1, endIdx);
}

function collectDirectiveLeaves(blocks: PmdBlock[], out: PmdDirectiveLeaf[]): void {
  for (const block of blocks) {
    if (block.type === 'directive_leaf') {
      out.push(block);
      continue;
    }
    if (block.type === 'directive_block') {
      collectDirectiveLeaves(block.children, out);
      continue;
    }
    if (block.type === 'list') {
      for (const item of block.items) {
        collectDirectiveLeaves(item.children, out);
      }
      continue;
    }
    if (block.type === 'list_item') {
      collectDirectiveLeaves(block.children, out);
      continue;
    }
    if (block.type === 'blockquote') {
      collectDirectiveLeaves(block.children, out);
    }
  }
}

function findFirstDirective(blocks: PmdDirectiveBlock[]): PmdDirectiveBlock | null {
  if (blocks.length === 0) return null;
  const sorted = [...blocks].sort((a, b) => {
    const aLine = a.position?.start.line ?? 0;
    const bLine = b.position?.start.line ?? 0;
    return aLine - bLine;
  });
  return sorted[0] ?? null;
}

function normalizeLabel(value: string): string {
  return value.replaceAll(/[\u2018\u2019]/g, "'").trim().toLowerCase();
}

function directiveLabel(block: PmdDirectiveBlock, markerLine: string): string {
  if (block.label && block.label.trim().length > 0) {
    return block.label.trim();
  }
  const match = /^:::\S+\s+(.+)$/.exec(markerLine.trim());
  return match?.[1]?.trim() ?? '';
}

function getDirectiveBounds(block: PmdDirectiveBlock, contentLines: string[]): {
  startLine: number;
  endLine: number;
  markerLine: string;
  closingLine: string;
  innerLines: string[];
} | null {
  const startLine = block.position?.start.line ?? 0;
  const endLine = block.position?.end.line ?? 0;
  if (!startLine || !endLine) return null;
  const markerLine = contentLines[startLine - 1] ?? '';
  const closingLine = contentLines[endLine - 1] ?? '';
  const innerLines = contentLines.slice(startLine, Math.max(startLine, endLine - 1));
  return { startLine, endLine, markerLine, closingLine, innerLines };
}

function hasNonEmptyLine(lines: string[]): boolean {
  return lines.some((line) => line.trim().length > 0);
}

function hasCodeBlocks(blocks: PmdBlock[]): boolean {
  for (const block of blocks) {
    if (block.type === 'code_block') return true;
    if (block.type === 'directive_block' && hasCodeBlocks(block.children)) return true;
    if (block.type === 'list') {
      for (const item of block.items) {
        if (hasCodeBlocks(item.children)) return true;
      }
    }
    if (block.type === 'list_item' && hasCodeBlocks(block.children)) return true;
    if (block.type === 'blockquote' && hasCodeBlocks(block.children)) return true;
  }
  return false;
}

function countListItems(blocks: PmdBlock[]): number {
  let count = 0;
  for (const block of blocks) {
    if (block.type === 'list') {
      count += block.items.length;
      continue;
    }
    if (block.type === 'paragraph') {
      const txt = block.text;
      if (/^\s*\d+\)/.test(txt) || /^\s*-\s+/.test(txt) || /^\s*\*\s+/.test(txt)) {
        count += 1;
      }
    }
  }
  return count;
}

export async function validateMarkdownFile(
  rawFile: string,
  opts: ValidateOptions = {},
): Promise<ValidateResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const strict = opts?.strict ?? false;

  const content = opts.content ?? (await readFile(rawFile, 'utf8'));

  let doc: PmdDocument;
  let contentLines: string[] = [];
  try {
    doc = parsePmdDocument(content);
    warnings.push(...doc.warnings.map((warning) => warning.message));
    const resolved = resolveSource(content);
    const parsed = matter(resolved.source);
    contentLines = normalizeNewlines(parsed.content).split('\n');
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [msg], warnings };
  }

  const frontmatter = { ...doc.frontmatter } as Record<string, unknown>;
  if (frontmatter.topic && Array.isArray(frontmatter.topic)) {
    frontmatter.topic = frontmatter.topic.join(', ');
  }
  const metaParse = FrontSchema.safeParse(frontmatter);
  if (!metaParse.success) {
    for (const issue of metaParse.error.issues) {
      errors.push(`Front matter: ${issue.path.join('.')} - ${issue.message}`);
    }
  }
  const meta = metaParse.success ? metaParse.data : undefined;

  // a) H2 order check
  const h2 = collectHeadings(doc.body, 2).map((heading) => normalizeHeadingText(heading.text));
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
  const toggles = [
    ...findDirectiveBlocks(doc, 'toggle-heading'),
    ...findDirectiveBlocks(doc, 'toggle-h2'),
    ...findDirectiveBlocks(doc, 'toggle-h3'),
  ];

  const hasAnswerKeyToggle = toggles.some((block) => {
    const bounds = getDirectiveBounds(block, contentLines);
    const label = bounds ? directiveLabel(block, bounds.markerLine) : block.label ?? '';
    return normalizeLabel(label) === 'answer key';
  });

  const hasTeacherPlanToggle = toggles.some((block) => {
    const bounds = getDirectiveBounds(block, contentLines);
    const label = bounds ? directiveLabel(block, bounds.markerLine) : block.label ?? '';
    return normalizeLabel(label) === "teacher's follow-up plan";
  });

  if (!hasAnswerKeyToggle) {
    errors.push('Missing marker: ":::toggle-heading Answer Key" or ":::toggle-h2 Answer Key"');
  }
  if (!hasTeacherPlanToggle) {
    errors.push(
      'Missing marker: ":::toggle-heading Teacher\'s Follow-up Plan" or ":::toggle-h2/h3 Teacher\'s Follow-up Plan"',
    );
  }

  const studyBlock = findFirstDirective(findDirectiveBlocks(doc, 'study-text'));
  if (!studyBlock) {
    const markerIdx = contentLines.findIndex((line) => line.toLowerCase().includes(':::study-text'));
    if (markerIdx !== -1) {
      const raw = contentLines[markerIdx] ?? '';
      if (/^\s+:::study-text\b/i.test(raw)) {
        errors.push(
          `Line ${markerIdx + 1}: study-text marker must start at column 1 with ":::study-text".`,
        );
      } else {
        errors.push(
          `Line ${markerIdx + 1}: malformed study-text marker. Use ":::study-text" (case-insensitive) on its own line.`,
        );
      }
    } else {
      errors.push('Missing ":::study-text ... :::" block.');
    }
  } else {
    const bounds = getDirectiveBounds(studyBlock, contentLines);
    if (!bounds) {
      errors.push('Missing ":::study-text ... :::" block.');
    } else {
      const { startLine, markerLine, closingLine, innerLines } = bounds;
      let studyOk = true;
      if (!markerLine.startsWith(':::study-text')) {
        errors.push(
          `Line ${startLine}: study-text marker must start at column 1 with ":::study-text".`,
        );
        studyOk = false;
      }

      if (closingLine.trim() !== ':::') {
        errors.push(
          `study-text block starting at line ${startLine} is missing a closing ":::" on its own line.`,
        );
        studyOk = false;
      } else if (closingLine !== ':::') {
        errors.push(
          `Line ${bounds.endLine}: study-text closing marker must be ":::" with no leading spaces.`,
        );
        studyOk = false;
      }

      if (studyOk) {
        const rawLines = innerLines.map((line) => line.trim());
        const lines = rawLines.filter(Boolean);

        const hasSpeakerLabels = Boolean(meta?.speaker_labels && meta.speaker_labels.length > 0);
        let enforceExplicitSpeakers = false;
        if (hasSpeakerLabels) {
          const labelSet = new Set(meta!.speaker_labels!.map((s) => s.trim().toLowerCase()));
          const onlyNarrator = labelSet.size === 1 && labelSet.has('narrator');
          if (!onlyNarrator) {
            enforceExplicitSpeakers = true;
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
          const paras = innerLines
            .join('\n')
            .split(/\n\s*\n/)
            .filter((p) => p.trim().length > 0);
          const lineCount = lines.length;
          if (paras.length < 3 && lineCount < 10) {
            warnings.push('study-text looks short. Aim for 3–5 paragraphs or 10–15 lines.');
          }
        }
      }
    }
  }

  // c) Controlled Practice item count (soft check)
  const h3 = collectHeadings(doc.body, 3);
  const h3Map = new Map<string, PmdHeading>();
  for (const h of h3) {
    h3Map.set(normalizeHeadingText(h.text), h);
  }
  const cp = h3Map.get(normalizeHeadingText('A. Controlled Practice'));
  if (cp) {
    const nodes = sectionSlice(doc.body, cp);
    const count = countListItems(nodes);
    if (count && (count < 8 || count > 12)) {
      warnings.push(`Controlled Practice has ${count} items (recommended 8–10).`);
    }
  } else {
    warnings.push('No "### A. Controlled Practice" section found under H2 #5.');
  }

  // d) Comprehension Check items (soft check)
  const cc = h3Map.get(normalizeHeadingText('B. Comprehension Check'));
  if (cc) {
    const nodes = sectionSlice(doc.body, cc);
    const count = countListItems(nodes);
    if (count && count < 2) {
      warnings.push(`Comprehension Check has ${count} item(s) (recommended 2–3).`);
    }
  }

  // e) no nested code blocks inside the doc
  if (hasCodeBlocks(doc.body)) {
    warnings.push('Found code block(s) inside the main document. Avoid nested ``` blocks.');
  }

  // f) advanced directives sanity checks (callout, audio/video, synced-block, tables)
  for (const callout of findDirectiveBlocks(doc, 'callout')) {
    const bounds = getDirectiveBounds(callout, contentLines);
    if (!bounds) continue;
    if (bounds.closingLine.trim() !== ':::') {
      errors.push(
        `callout starting at line ${bounds.startLine} is missing a closing ":::" after its content.`,
      );
      continue;
    }
    const icon = directiveLabel(callout, bounds.markerLine).trim();
    if (!icon) {
      errors.push(
        `callout starting at line ${bounds.startLine} must provide an emoji/icon after ":::callout".`,
      );
    }
    if (!hasNonEmptyLine(bounds.innerLines)) {
      errors.push(
        `callout starting at line ${bounds.startLine} must contain content before the closing ":::" marker.`,
      );
    }
  }

  for (const columnList of findDirectiveBlocks(doc, 'column-list')) {
    const bounds = getDirectiveBounds(columnList, contentLines);
    if (!bounds) continue;
    if (bounds.closingLine.trim() !== ':::') {
      errors.push(
        `column-list starting at line ${bounds.startLine} is missing a closing ":::" after its contents.`,
      );
      continue;
    }
    const columns = columnList.children.filter(
      (child) => child.type === 'directive_block' && child.name === 'column',
    ) as PmdDirectiveBlock[];
    if (columns.length === 0) {
      errors.push(
        `column-list starting at line ${bounds.startLine} must contain at least one ":::column" section with content.`,
      );
      continue;
    }
    const emptyIdx = columns.findIndex((col) => {
      const colBounds = getDirectiveBounds(col, contentLines);
      if (!colBounds) return true;
      return !hasNonEmptyLine(colBounds.innerLines);
    });
    if (emptyIdx !== -1) {
      errors.push(
        `column-list starting at line ${bounds.startLine} has an empty column #${emptyIdx + 1}; add content or remove it.`,
      );
    }
  }

  for (const syncedBlock of findDirectiveBlocks(doc, 'synced-block')) {
    const bounds = getDirectiveBounds(syncedBlock, contentLines);
    if (!bounds) continue;
    if (bounds.closingLine.trim() !== ':::') {
      errors.push(
        `synced-block starting at line ${bounds.startLine} is missing a closing ":::" after its contents.`,
      );
      continue;
    }
    const syncId = directiveLabel(syncedBlock, bounds.markerLine).trim();
    if (!syncId && !hasNonEmptyLine(bounds.innerLines)) {
      errors.push(
        `synced-block starting at line ${bounds.startLine} must include content when no source block id is provided.`,
      );
    }
  }

  const leafs: PmdDirectiveLeaf[] = [];
  collectDirectiveLeaves(doc.body, leafs);
  for (const leaf of leafs) {
    if (leaf.name !== 'audio' && leaf.name !== 'video') continue;
    const label = leaf.label?.trim() ?? '';
    if (!label) {
      const line = leaf.position?.start.line ?? 0;
      if (leaf.name === 'audio') {
        errors.push(`Line ${line}: audio directive requires a URL after ":::audio".`);
      } else {
        errors.push(`Line ${line}: video directive requires a URL after ":::video".`);
      }
    }
  }

  for (const table of doc.body) {
    if (table.type !== 'table') continue;
    const rows = table.rows;
    if (rows.length === 0) {
      errors.push(`Table starting at line ${table.position?.start.line ?? 1} must have at least one column.`);
      continue;
    }
    const width = rows[0]?.length ?? 0;
    if (width === 0) {
      errors.push(`Table starting at line ${table.position?.start.line ?? 1} must have at least one column.`);
      continue;
    }
    const ragged = rows.findIndex((row) => row.length !== width);
    if (ragged !== -1) {
      errors.push(
        `Table starting at line ${table.position?.start.line ?? 1} has inconsistent column counts (row ${
          ragged + 1
        } differs). Make all rows the same length.`,
      );
    }
    if (rows.length < 2) {
      errors.push(`Table starting at line ${table.position?.start.line ?? 1} must include at least one data row.`);
    }
  }

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
