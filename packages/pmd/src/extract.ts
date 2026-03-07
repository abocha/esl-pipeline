import { ValidationError } from '@esl-pipeline/contracts';

import { findDirectiveBlocks } from './query.js';
import type {
  Frontmatter,
  ParsedMarkdownContext,
  PmdBlock,
  PmdDirectiveBlock,
  PmdHeading,
  PronunciationShadowFocus,
  PronunciationShadowIssue,
  PronunciationShadowWord,
  Section,
  StudyText,
} from './types.js';

const NBSP = /\u00A0/g;
const ZWSP = /\u200B/g;
const BOM = /^\uFEFF/;

function cleanLine(input: string): string {
  return input.replace(BOM, '').replaceAll(NBSP, ' ').replaceAll(ZWSP, '');
}

function getDirectiveBounds(
  block: PmdDirectiveBlock,
  contentLines: string[],
): {
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

function directiveLabel(block: PmdDirectiveBlock, markerLine: string): string {
  if (block.label && block.label.trim().length > 0) {
    return block.label.trim();
  }
  const match = /^:::\S+\s+(.+)$/.exec(markerLine.trim());
  return match?.[1]?.trim() ?? '';
}

function normalizeLabel(value: string): string {
  return value
    .replaceAll(/[\u2018\u2019]/g, "'")
    .trim()
      .toLowerCase();
}

function normalizeHeadingText(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^\w\s]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
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

function getStudyTextLines(block: PmdDirectiveBlock, contentLines: string[]): string[] {
  const bounds = getDirectiveBounds(block, contentLines);
  if (!bounds) return [];
  if (bounds.closingLine.trim() !== ':::') return [];
  const rawLines = bounds.innerLines.map((line) => cleanLine(line).trim());

  const markerLabel = directiveLabel(block, bounds.markerLine);
  if (markerLabel) {
    const first = rawLines[0];
    if (first && first.toLowerCase() === markerLabel.toLowerCase()) {
      rawLines.shift();
    }
  }

  return rawLines.filter(Boolean);
}

function collectHeadings(body: PmdBlock[], depth: 2 | 3): PmdHeading[] {
  return body.filter((block) => block.type === 'heading' && block.depth === depth) as PmdHeading[];
}

export function extractFrontmatter(md: ParsedMarkdownContext): Frontmatter {
  return md.document.frontmatter as Frontmatter;
}

function isDialogueLine(line: string): boolean {
  // e.g., "A:", "Anna:", "[Teacher]:", "S1:", "**Teacher**:", "**Teacher:**"
  return /^\s*(?:\[([^\]]+)\]|(?:\*\*)?([A-Za-zА-Яа-яЁё0-9 _.\-]{1,32})(?:\*\*)?)\s*:(?:\*\*)?\s+/.test(
    line,
  );
}

export function extractStudyText(md: ParsedMarkdownContext): StudyText {
  const contentLines = md.contentLines;
  const doc = md.document;
  const block = findFirstDirective(findDirectiveBlocks(doc, 'study-text'));
  if (!block) throw new ValidationError('study-text block not found');

  const lines = getStudyTextLines(block, contentLines);
  if (lines.length === 0) throw new ValidationError('study-text block not found');

  const dialogueCount = lines.filter((line) => isDialogueLine(line)).length;
  const type: StudyText['type'] = dialogueCount >= 2 ? 'dialogue' : 'monologue';
  return { type, lines };
}

export function extractAnswerKey(md: ParsedMarkdownContext): string {
  const doc = md.document;
  const contentLines = md.contentLines;
  const toggles = [
    ...findDirectiveBlocks(doc, 'toggle'),
    ...findDirectiveBlocks(doc, 'toggle-heading'),
    ...findDirectiveBlocks(doc, 'toggle-h2'),
  ];

  const match = toggles.find((block) => {
    const bounds = getDirectiveBounds(block, contentLines);
    const label = bounds ? directiveLabel(block, bounds.markerLine) : (block.label ?? '');
    return normalizeLabel(label) === 'answer key';
  });

  if (!match) throw new ValidationError('Answer Key toggle not found');
  const bounds = getDirectiveBounds(match, contentLines);
  if (!bounds) throw new ValidationError('Answer Key toggle not found');
  return bounds.innerLines.join('\n').trim();
}

export function extractTeacherNotes(md: ParsedMarkdownContext): string {
  const doc = md.document;
  const contentLines = md.contentLines;
  const toggles = [
    ...findDirectiveBlocks(doc, 'toggle'),
    ...findDirectiveBlocks(doc, 'toggle-heading'),
    ...findDirectiveBlocks(doc, 'toggle-h2'),
    ...findDirectiveBlocks(doc, 'toggle-h3'),
  ];

  const match = toggles.find((block) => {
    const bounds = getDirectiveBounds(block, contentLines);
    const label = bounds ? directiveLabel(block, bounds.markerLine) : (block.label ?? '');
    return normalizeLabel(label) === "teacher's follow-up plan";
  });

  if (!match) throw new ValidationError("Teacher's Follow-up Plan toggle not found");
  const bounds = getDirectiveBounds(match, contentLines);
  if (!bounds) throw new ValidationError("Teacher's Follow-up Plan toggle not found");
  return bounds.innerLines.join('\n').trim();
}

export function extractSections(md: ParsedMarkdownContext): Section[] {
  const doc = md.document;
  const contentLines = md.contentLines;
  const headings = [...collectHeadings(doc.body, 2), ...collectHeadings(doc.body, 3)].sort(
    (a, b) => {
      return (a.position?.start.line ?? 0) - (b.position?.start.line ?? 0);
    },
  );

  return headings.map((heading, idx) => {
    const startLine = heading.position?.start.line ?? 0;
    const endLine = headings[idx + 1]?.position?.start.line ?? contentLines.length + 1;
    const slice =
      startLine > 0 ? contentLines.slice(startLine, Math.max(startLine, endLine - 1)) : [];
    return {
      depth: heading.depth as 2 | 3,
      title: heading.text,
      content: slice.join('\n').trim(),
    };
  });
}

function findFirstPronunciationHeading(body: PmdBlock[]): PmdHeading | null {
  const headings = collectHeadings(body, 3).sort((a, b) => {
    const aLine = a.position?.start.line ?? 0;
    const bLine = b.position?.start.line ?? 0;
    return aLine - bLine;
  });
  for (const heading of headings) {
    const normalized = normalizeHeadingText(heading.text);
    if (
      normalized.includes('pronunciation') &&
      normalized.includes('micro') &&
      normalized.includes('focus')
    ) {
      return heading;
    }
  }
  return null;
}

function parseMarkedField(
  line: string,
  marker: 'mode' | 'shadow sentence',
): string | null {
  const withoutBullet = line.replace(/^\s*(?:[-*]\s+)?/, '').trim();
  const normalizedLine = /^`[^`]+`$/.test(withoutBullet)
    ? withoutBullet.slice(1, -1).trim()
    : withoutBullet;
  const regex = new RegExp(
    String.raw`^(?:\*\*)?${marker}\s*:\s*(?:\*\*)?\s*(.+?)\s*$`,
    'i',
  );
  const match = regex.exec(normalizedLine);
  if (!match?.[1]) return null;
  const value = match[1].trim();
  if (/^`[^`]+`$/.test(value)) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function parsePronunciationWordLine(
  line: string,
  lineNumber: number,
): { word?: PronunciationShadowWord; issue?: PronunciationShadowIssue } | null {
  const numberedItem = /^\s*(?:[-*]\s+)?\d+\.\s+/.test(line);
  if (!numberedItem) return null;

  const itemContent = line.replace(/^\s*(?:[-*]\s+)?\d+\.\s*/, '').trim();
  if (!itemContent) {
    return {
      issue: {
        code: 'invalid_word_item_format',
        message:
          'Word drill line must use "1. word — /transcription/" or "1. word /transcription/" format.',
        line: lineNumber,
      },
    };
  }

  const transcriptionTailMatch = /(\/[^/\n]+\/)(?:\s+(.+))?$/.exec(itemContent);
  if (!transcriptionTailMatch?.[1]) {
    const dashedSplit = /^(.+?)\s*[—-]\s*(.+?)\s*$/.exec(itemContent);
    if (dashedSplit?.[2]) {
      return {
        issue: {
          code: 'invalid_word_transcription',
          message:
            'Word transcription must be wrapped in forward slashes, e.g. /wɜːd/.',
          line: lineNumber,
        },
      };
    }

    return {
      issue: {
        code: 'invalid_word_item_format',
        message:
          'Word drill line must use "1. word — /transcription/" or "1. word /transcription/" format.',
        line: lineNumber,
      },
    };
  }

  const rawTextPart = itemContent.slice(0, transcriptionTailMatch.index).trimEnd();
  const text = rawTextPart
    .replace(/[—-]\s*$/, '')
    .replaceAll('**', '')
    .replaceAll('`', '')
    .trim();
  if (!text) {
    return {
      issue: {
        code: 'invalid_word_item_format',
        message:
          'Word drill line must use "1. word — /transcription/" or "1. word /transcription/" format.',
        line: lineNumber,
      },
    };
  }
  const transcription = transcriptionTailMatch[1].trim();
  return {
    word: {
      text,
      transcription,
      line: lineNumber,
    },
  };
}

export function extractPronunciationShadowFocus(
  md: ParsedMarkdownContext,
): PronunciationShadowFocus | null {
  const heading = findFirstPronunciationHeading(md.document.body);
  if (!heading) return null;
  const sectionStartLine = heading.position?.start.line ?? 0;
  if (sectionStartLine <= 0) return null;

  const sortedHeadings = [
    ...collectHeadings(md.document.body, 2),
    ...collectHeadings(md.document.body, 3),
  ]
    .sort((a, b) => {
      const aLine = a.position?.start.line ?? 0;
      const bLine = b.position?.start.line ?? 0;
      return aLine - bLine;
    });
  const nextHeading = sortedHeadings.find((candidate) => {
    const line = candidate.position?.start.line ?? 0;
    if (line <= sectionStartLine) return false;
    return candidate.depth <= 3;
  });
  const endLineExclusive = nextHeading?.position?.start.line ?? md.contentLines.length + 1;
  const sectionLines = md.contentLines.slice(sectionStartLine, Math.max(sectionStartLine, endLineExclusive - 1));

  let modeValue: string | null = null;
  let shadowSentence: string | undefined;
  const words: PronunciationShadowWord[] = [];
  const issues: PronunciationShadowIssue[] = [];

  for (const [index, rawLine] of sectionLines.entries()) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed === ':::') continue;

    const mode = parseMarkedField(trimmed, 'mode');
    if (mode) {
      modeValue = mode.toLowerCase();
      continue;
    }

    const sentence = parseMarkedField(trimmed, 'shadow sentence');
    if (sentence) {
      shadowSentence = sentence;
      continue;
    }

    const parsedWord = parsePronunciationWordLine(trimmed, sectionStartLine + index + 1);
    if (parsedWord?.word) {
      words.push(parsedWord.word);
      continue;
    }
    if (parsedWord?.issue) {
      issues.push(parsedWord.issue);
    }
  }

  if (modeValue !== 'shadow_sentence') return null;

  return {
    mode: 'shadow_sentence',
    shadowSentence,
    words,
    sectionStartLine,
    issues,
  };
}
